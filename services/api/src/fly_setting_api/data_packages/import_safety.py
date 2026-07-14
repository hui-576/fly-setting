from __future__ import annotations

import os
import stat
from dataclasses import dataclass
from pathlib import Path

from fly_setting_api.data_packages.errors import DataPackageError


@dataclass(frozen=True, slots=True)
class DataPackageLimits:
    """Bound local imports before any bytes are copied into managed storage."""

    max_files: int = 250_000
    max_single_file_bytes: int = 8 * 1024**3
    max_total_bytes: int = 512 * 1024**3
    max_depth: int = 32


@dataclass(slots=True)
class _CopyState:
    limits: DataPackageLimits
    files: int = 0
    total_bytes: int = 0


_COPY_BUFFER_BYTES = 1024 * 1024


def paths_overlap(source: Path, storage_root: Path) -> bool:
    """Return whether either tree contains the other."""

    return (
        source == storage_root
        or source.is_relative_to(storage_root)
        or storage_root.is_relative_to(source)
    )


def _is_reparse_stat(metadata: os.stat_result) -> bool:
    attributes = getattr(metadata, "st_file_attributes", 0)
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return bool(attributes & reparse_flag)


def _entry_signature(metadata: os.stat_result) -> tuple[int, int, int]:
    return (
        stat.S_IFMT(metadata.st_mode),
        metadata.st_size,
        metadata.st_mtime_ns,
    )


def _assert_unchanged(before: os.stat_result, after: os.stat_result) -> None:
    before_identity = (before.st_dev, before.st_ino)
    after_identity = (after.st_dev, after.st_ino)
    identity_changed = (
        all(before_identity) and all(after_identity) and before_identity != after_identity
    )
    if identity_changed or _entry_signature(before) != _entry_signature(after):
        raise DataPackageError(
            "PACKAGE_SOURCE_CHANGED", "The package source changed during import"
        )


def _source_lstat(path: Path) -> os.stat_result:
    try:
        return path.lstat()
    except OSError as error:
        raise DataPackageError(
            "PACKAGE_SOURCE_UNREADABLE", "The package source cannot be read"
        ) from error


def _reject_reparse(metadata: os.stat_result) -> None:
    if stat.S_ISLNK(metadata.st_mode) or _is_reparse_stat(metadata):
        raise DataPackageError("PACKAGE_REPARSE_POINT_FORBIDDEN", "Package links are forbidden")


def _source_open_flags() -> int:
    flags = os.O_RDONLY
    flags |= getattr(os, "O_BINARY", 0)
    flags |= getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    return flags


def _destination_open_flags() -> int:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    flags |= getattr(os, "O_BINARY", 0)
    flags |= getattr(os, "O_CLOEXEC", 0)
    return flags


def _write_all(file_descriptor: int, payload: bytes) -> None:
    offset = 0
    while offset < len(payload):
        written = os.write(file_descriptor, payload[offset:])
        if written <= 0:
            raise OSError("destination write made no progress")
        offset += written


def _copy_file_bytes(
    source_descriptor: int,
    destination_descriptor: int,
    state: _CopyState,
) -> None:
    copied = 0
    while True:
        file_remaining = state.limits.max_single_file_bytes - copied
        total_remaining = state.limits.max_total_bytes - state.total_bytes
        allowed = min(file_remaining, total_remaining)
        read_size = min(_COPY_BUFFER_BYTES, allowed + 1)
        chunk = os.read(source_descriptor, max(1, read_size))
        if not chunk:
            return
        if len(chunk) > allowed:
            if file_remaining <= total_remaining:
                raise DataPackageError(
                    "PACKAGE_FILE_TOO_LARGE",
                    "A package file exceeds the per-file size limit",
                )
            raise DataPackageError(
                "PACKAGE_TOTAL_SIZE_EXCEEDED",
                "Package total size exceeds the import limit",
            )
        _write_all(destination_descriptor, chunk)
        copied += len(chunk)
        state.total_bytes += len(chunk)


def _copy_regular_file(
    source: Path,
    destination: Path,
    expected: os.stat_result,
    state: _CopyState,
) -> None:
    before = _source_lstat(source)
    _reject_reparse(before)
    _assert_unchanged(expected, before)
    if not stat.S_ISREG(before.st_mode):
        raise DataPackageError(
            "PACKAGE_SOURCE_ENTRY_INVALID", "Package entries must be regular files or directories"
        )

    state.files += 1
    if state.files > state.limits.max_files:
        raise DataPackageError(
            "PACKAGE_FILE_COUNT_EXCEEDED", "Package file count exceeds the import limit"
        )
    if before.st_size > state.limits.max_single_file_bytes:
        raise DataPackageError(
            "PACKAGE_FILE_TOO_LARGE", "A package file exceeds the per-file size limit"
        )
    if state.total_bytes + before.st_size > state.limits.max_total_bytes:
        raise DataPackageError(
            "PACKAGE_TOTAL_SIZE_EXCEEDED", "Package total size exceeds the import limit"
        )

    source_descriptor = -1
    destination_descriptor = -1
    try:
        source_descriptor = os.open(source, _source_open_flags())
        opened = os.fstat(source_descriptor)
        _reject_reparse(opened)
        _assert_unchanged(before, opened)
        destination_descriptor = os.open(destination, _destination_open_flags(), 0o600)
        _copy_file_bytes(source_descriptor, destination_descriptor, state)
        completed = os.fstat(source_descriptor)
        _assert_unchanged(opened, completed)
    except DataPackageError:
        raise
    except OSError as error:
        raise DataPackageError(
            "PACKAGE_SOURCE_UNREADABLE", "The package source cannot be copied safely"
        ) from error
    finally:
        if destination_descriptor >= 0:
            os.close(destination_descriptor)
        if source_descriptor >= 0:
            os.close(source_descriptor)

    after = _source_lstat(source)
    _reject_reparse(after)
    _assert_unchanged(before, after)


def _copy_directory(
    source: Path,
    destination: Path,
    expected: os.stat_result,
    depth: int,
    state: _CopyState,
) -> None:
    before = _source_lstat(source)
    _reject_reparse(before)
    _assert_unchanged(expected, before)
    if not stat.S_ISDIR(before.st_mode):
        raise DataPackageError(
            "PACKAGE_SOURCE_ENTRY_INVALID", "Package entries must be regular files or directories"
        )
    if depth > state.limits.max_depth:
        raise DataPackageError(
            "PACKAGE_DEPTH_EXCEEDED", "Package directory depth exceeds the import limit"
        )
    destination.mkdir()
    try:
        entries = os.scandir(source)
        _assert_unchanged(before, _source_lstat(source))
        with entries:
            for entry in entries:
                _assert_unchanged(before, _source_lstat(source))
                source_entry = source / entry.name
                destination_entry = destination / entry.name
                discovered = entry.stat(follow_symlinks=False)
                _reject_reparse(discovered)
                metadata = _source_lstat(source_entry)
                _reject_reparse(metadata)
                if stat.S_ISDIR(metadata.st_mode):
                    _copy_directory(
                        source_entry,
                        destination_entry,
                        metadata,
                        depth + 1,
                        state,
                    )
                elif stat.S_ISREG(metadata.st_mode):
                    _copy_regular_file(source_entry, destination_entry, metadata, state)
                else:
                    raise DataPackageError(
                        "PACKAGE_SOURCE_ENTRY_INVALID",
                        "Package entries must be regular files or directories",
                    )
    except DataPackageError:
        raise
    except OSError as error:
        raise DataPackageError(
            "PACKAGE_SOURCE_UNREADABLE", "The package source cannot be read"
        ) from error
    after = _source_lstat(source)
    _reject_reparse(after)
    _assert_unchanged(before, after)


def copy_import_tree(source: Path, destination: Path, limits: DataPackageLimits) -> None:
    """Copy an untrusted package once without following links or exceeding byte limits."""

    root = _source_lstat(source)
    _reject_reparse(root)
    if not stat.S_ISDIR(root.st_mode):
        raise DataPackageError(
            "PACKAGE_SOURCE_UNREADABLE", "The import source must be an existing directory"
        )
    try:
        _copy_directory(source, destination, root, 0, _CopyState(limits))
    except FileExistsError as error:
        raise DataPackageError(
            "PACKAGE_DESTINATION_EXISTS", "The package staging destination already exists"
        ) from error
