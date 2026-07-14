from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from fly_setting_api.data_packages import import_safety
from fly_setting_api.data_packages.errors import DataPackageError
from fly_setting_api.data_packages.import_safety import copy_import_tree
from fly_setting_api.data_packages.service import DataPackageLimits, DataPackageService

from .conftest import create_data_package


def _directory_symlink_or_skip(link: Path, target: Path) -> None:
    try:
        link.symlink_to(target, target_is_directory=True)
    except (NotImplementedError, OSError) as error:
        if os.name != "nt":
            pytest.skip(f"directory links are unavailable: {error}")
        link_literal = str(link).replace("'", "''")
        target_literal = str(target).replace("'", "''")
        script = (
            f"New-Item -ItemType Junction -Path '{link_literal}' "
            f"-Target '{target_literal}' | Out-Null"
        )
        command = [
            "powershell",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ]
        completed = subprocess.run(command, check=False, capture_output=True, text=True)
        if completed.returncode != 0:
            pytest.skip(f"directory links are unavailable: {completed.stderr.strip()}")


def test_source_and_storage_must_not_overlap(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    service = DataPackageService(source / "store")

    with pytest.raises(DataPackageError, match="overlap") as captured:
        service.install(str(source))

    assert captured.value.code == "SOURCE_STORAGE_OVERLAP"
    assert not (source / "store").exists()


def test_import_enforces_file_count_single_file_total_size_and_depth(tmp_path: Path) -> None:
    cases = [
        (DataPackageLimits(max_files=1), "PACKAGE_FILE_COUNT_EXCEEDED"),
        (DataPackageLimits(max_single_file_bytes=8), "PACKAGE_FILE_TOO_LARGE"),
        (DataPackageLimits(max_total_bytes=16), "PACKAGE_TOTAL_SIZE_EXCEEDED"),
        (DataPackageLimits(max_depth=2), "PACKAGE_DEPTH_EXCEEDED"),
    ]
    for index, (limits, expected_code) in enumerate(cases):
        source = create_data_package(tmp_path / f"incoming-{index}")
        service = DataPackageService(tmp_path / f"store-{index}", limits=limits)

        with pytest.raises(DataPackageError) as captured:
            service.install(str(source))

        assert captured.value.code == expected_code


def test_limited_copy_rejects_file_replaced_between_lstat_and_open(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source"
    destination = tmp_path / "destination"
    source.mkdir()
    victim = source / "payload.bin"
    victim.write_bytes(b"original")
    real_open = os.open
    replaced = False

    def replace_before_open(path: os.PathLike[str] | str, flags: int, mode: int = 0o777) -> int:
        nonlocal replaced
        if not replaced and Path(path) == victim:
            replaced = True
            victim.unlink()
            victim.write_bytes(b"attacker")
        return real_open(path, flags, mode)

    monkeypatch.setattr(import_safety.os, "open", replace_before_open)

    with pytest.raises(DataPackageError) as captured:
        copy_import_tree(source, destination, DataPackageLimits())

    assert captured.value.code == "PACKAGE_SOURCE_CHANGED"
    assert replaced


def test_limited_copy_rejects_file_growth_during_copy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source"
    destination = tmp_path / "destination"
    source.mkdir()
    victim = source / "payload.bin"
    victim.write_bytes(b"stable")
    real_read = os.read
    grew = False

    def grow_after_first_read(file_descriptor: int, length: int) -> bytes:
        nonlocal grew
        chunk = real_read(file_descriptor, length)
        if chunk and not grew:
            grew = True
            with victim.open("ab") as stream:
                stream.write(b"changed")
        return chunk

    monkeypatch.setattr(import_safety.os, "read", grow_after_first_read)

    with pytest.raises(DataPackageError) as captured:
        copy_import_tree(source, destination, DataPackageLimits())

    assert captured.value.code == "PACKAGE_SOURCE_CHANGED"
    assert grew


def test_limited_copy_stops_before_writing_bytes_over_total_limit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source"
    destination = tmp_path / "destination"
    source.mkdir()
    victim = source / "payload.bin"
    victim.write_bytes(b"1234")
    real_read = os.read
    real_write = os.write
    grew = False
    written = 0

    def grow_after_first_read(file_descriptor: int, length: int) -> bytes:
        nonlocal grew
        chunk = real_read(file_descriptor, length)
        if chunk and not grew:
            grew = True
            with victim.open("ab") as stream:
                stream.write(b"5")
        return chunk

    def count_written(file_descriptor: int, payload: bytes) -> int:
        nonlocal written
        count = real_write(file_descriptor, payload)
        written += count
        return count

    monkeypatch.setattr(import_safety.os, "read", grow_after_first_read)
    monkeypatch.setattr(import_safety.os, "write", count_written)

    with pytest.raises(DataPackageError) as captured:
        copy_import_tree(
            source,
            destination,
            DataPackageLimits(max_total_bytes=4, max_single_file_bytes=16),
        )

    assert captured.value.code == "PACKAGE_TOTAL_SIZE_EXCEEDED"
    assert written == 4


@pytest.mark.parametrize("at_root", [True, False], ids=["root", "nested"])
def test_limited_copy_rejects_reparse_points(tmp_path: Path, at_root: bool) -> None:
    target = tmp_path / "target"
    target.mkdir()
    (target / "payload.bin").write_bytes(b"outside")
    source = tmp_path / "source"
    if at_root:
        _directory_symlink_or_skip(source, target)
    else:
        source.mkdir()
        _directory_symlink_or_skip(source / "linked", target)

    with pytest.raises(DataPackageError) as captured:
        copy_import_tree(source, tmp_path / "destination", DataPackageLimits())

    assert captured.value.code == "PACKAGE_REPARSE_POINT_FORBIDDEN"


def test_tampered_active_reference_cannot_escape_packages_root(tmp_path: Path) -> None:
    service = DataPackageService(tmp_path / "store")
    service.storage_root.mkdir(parents=True)
    service.active_path.write_text(
        json.dumps({"id": "..", "version": "outside", "obscurationMode": "bare-earth"}),
        encoding="utf-8",
    )

    manifest = service.map_manifest()

    assert manifest["status"] == "invalid"
    assert manifest["errors"][0]["code"] == "ACTIVE_REFERENCE_INVALID"


def test_resource_requests_reuse_verified_index_instead_of_rehashing_package(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = create_data_package(tmp_path / "incoming")
    service = DataPackageService(tmp_path / "store")
    service.install(str(source))
    service.activate("hubei-demo", "2026.07.0", "surface")

    def unexpected_validation(_: Path) -> None:
        raise AssertionError("resource requests must not revalidate the entire package")

    monkeypatch.setattr(
        "fly_setting_api.data_packages.service.validate_package", unexpected_validation
    )

    service.map_manifest()
    service.xyz_resource("hubei-demo", "2026.07.0", 0, 0, 0, "png")
    service.terrain_resource("hubei-demo", "2026.07.0", "layer.json")
    service.road_tile_resource("hubei-demo", "2026.07.0", 8, 207, 104)


def test_live_resource_tampering_is_rejected_without_rehashing_other_files(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    service = DataPackageService(tmp_path / "store")
    service.install(str(source))
    service.activate("hubei-demo", "2026.07.0", "surface")
    installed_tile = (
        tmp_path
        / "store"
        / "packages"
        / "hubei-demo"
        / "2026.07.0"
        / "imagery"
        / "0"
        / "0"
        / "0.png"
    )
    installed_tile.write_bytes(b"tampered")

    with pytest.raises(DataPackageError) as captured:
        service.xyz_resource("hubei-demo", "2026.07.0", 0, 0, 0, "png")

    assert captured.value.code == "CHECKSUM_MISMATCH"
