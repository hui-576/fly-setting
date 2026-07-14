from __future__ import annotations

import json
import os
import threading
import uuid
from pathlib import Path
from typing import Any, Literal

from pydantic import ValidationError

from fly_setting_api.data_packages.errors import DataPackageError
from fly_setting_api.data_packages.import_safety import (
    DataPackageLimits,
    copy_import_tree,
    paths_overlap,
)
from fly_setting_api.data_packages.license_trust import (
    LicenseTrustStore,
    load_license_trust_store,
)
from fly_setting_api.data_packages.models import ActivePackageReference
from fly_setting_api.data_packages.package_storage import (
    cleanup_staging,
    prepare_storage,
    read_active_reference,
)
from fly_setting_api.data_packages.presentation import (
    package_descriptor,
    ready_map_manifest,
    supported_modes,
)
from fly_setting_api.data_packages.resource_access import (
    VerifiedPackage,
    index_package,
)
from fly_setting_api.data_packages.resource_access import (
    elevation_raster as resolve_elevation_raster,
)
from fly_setting_api.data_packages.resource_access import (
    road_tile_resource as resolve_road_tile_resource,
)
from fly_setting_api.data_packages.resource_access import (
    terrain_resource as resolve_terrain_resource,
)
from fly_setting_api.data_packages.resource_access import (
    xyz_resource as resolve_xyz_resource,
)
from fly_setting_api.data_packages.validation import validate_package

__all__ = ["DataPackageLimits", "DataPackageService"]


class DataPackageService:
    """Install, activate and serve immutable geographic data-package versions."""

    def __init__(
        self,
        storage_root: Path,
        *,
        limits: DataPackageLimits | None = None,
        license_trust_store_path: Path | None = None,
    ) -> None:
        self.storage_root = storage_root.resolve()
        self.packages_root = self.storage_root / "packages"
        self.staging_root = self.storage_root / ".staging"
        self.active_path = self.storage_root / "active.json"
        self.limits = limits or DataPackageLimits()
        self.license_trust_store: LicenseTrustStore | None = load_license_trust_store(
            license_trust_store_path
        )
        if (
            self.license_trust_store is not None
            and self.license_trust_store.source_path.is_relative_to(self.storage_root)
        ):
            raise DataPackageError(
                "LICENSE_TRUST_STORE_INVALID",
                "The license trust store must be outside managed package storage",
            )
        self._mutation_lock = threading.RLock()
        self._verified: dict[tuple[str, str], VerifiedPackage] = {}

    def _package_root(self, package_id: str, version: str) -> Path:
        try:
            identity = ActivePackageReference.model_validate(
                {"id": package_id, "version": version, "obscurationMode": "bare-earth"}
            )
        except ValidationError as error:
            raise DataPackageError(
                "PACKAGE_IDENTITY_INVALID", "The package id or version is invalid", 400
            ) from error
        candidate = self.packages_root / identity.package_id / identity.version
        resolved = candidate.resolve()
        if not resolved.is_relative_to(self.packages_root.resolve()):
            raise DataPackageError("PACKAGE_PATH_INVALID", "The package path is outside storage")
        return resolved

    def _verified_package(self, package_id: str, version: str) -> VerifiedPackage:
        key = (package_id, version)
        with self._mutation_lock:
            cached = self._verified.get(key)
            if cached is not None:
                return cached
            root = self._package_root(package_id, version)
            if not root.is_dir():
                raise DataPackageError(
                    "PACKAGE_NOT_FOUND", "The requested package version is not installed", 404
                )
            manifest = validate_package(
                root, license_trust_store=self.license_trust_store
            )
            if (manifest.package_id, manifest.version) != key:
                raise DataPackageError(
                    "PACKAGE_IDENTITY_MISMATCH",
                    "The package manifest does not match its storage identity",
                )
            verified = index_package(root, manifest)
            self._verified[key] = verified
            return verified

    def install(self, source_directory: str) -> dict[str, Any]:
        """Copy, validate, and atomically publish one immutable package version."""

        source = Path(os.path.abspath(Path(source_directory).expanduser()))
        if not source.is_dir():
            raise DataPackageError(
                "SOURCE_DIRECTORY_NOT_FOUND", "The import source must be an existing directory", 404
            )
        try:
            resolved_source = source.resolve(strict=True)
        except OSError as error:
            raise DataPackageError(
                "SOURCE_DIRECTORY_NOT_FOUND",
                "The import source must be an existing directory",
                404,
            ) from error
        if paths_overlap(resolved_source, self.storage_root):
            raise DataPackageError(
                "SOURCE_STORAGE_OVERLAP", "Package source and managed storage must not overlap"
            )
        if (
            self.license_trust_store is not None
            and self.license_trust_store.source_path.is_relative_to(resolved_source)
        ):
            raise DataPackageError(
                "LICENSE_TRUST_STORE_INSIDE_PACKAGE",
                "The license trust store must not be supplied by the imported package",
            )
        with self._mutation_lock:
            prepare_storage(self.packages_root, self.staging_root)
            staging = self.staging_root / uuid.uuid4().hex
            try:
                copy_import_tree(source, staging, self.limits)
                manifest = validate_package(
                    staging, license_trust_store=self.license_trust_store
                )
                destination = self._package_root(manifest.package_id, manifest.version)
                if destination.exists():
                    raise DataPackageError(
                        "PACKAGE_VERSION_EXISTS",
                        "The package id and version are already installed",
                        409,
                    )
                destination.parent.mkdir(parents=True, exist_ok=True)
                os.replace(staging, destination)
                self._verified[(manifest.package_id, manifest.version)] = index_package(
                    destination, manifest
                )
                return package_descriptor(manifest, active=False)
            except BaseException as error:
                cleanup_staging(staging, error)
                raise
            finally:
                cleanup_staging(staging)

    def list_packages(self) -> list[dict[str, Any]]:
        """Return installed package versions with integrity status."""

        try:
            active = read_active_reference(self.active_path)
            active_key = None if active is None else (active.package_id, active.version)
        except DataPackageError:
            active = None
            active_key = None
        if not self.packages_root.is_dir():
            return []
        descriptors: list[dict[str, Any]] = []
        for manifest_path in sorted(self.packages_root.glob("*/*/manifest.json")):
            package_root = manifest_path.parent
            key = (package_root.parent.name, package_root.name)
            try:
                package = self._verified_package(*key)
                descriptors.append(
                    package_descriptor(
                        package.manifest,
                        active=active_key == key,
                        obscuration_mode=(
                            active.obscuration_mode
                            if active is not None and active_key == key
                            else None
                        ),
                    )
                )
            except DataPackageError:
                descriptors.append(
                    {
                        "id": key[0],
                        "version": key[1],
                        "displayName": key[0],
                        "status": "invalid",
                        "active": False,
                        "obscurationMode": None,
                        "supportedObscurationModes": [],
                        "dtm": {"available": False},
                        "dsm": {"available": False},
                    }
                )
        return descriptors

    def activate(
        self, package_id: str, version: str, obscuration_mode: str
    ) -> dict[str, Any]:
        """Validate and atomically switch the current package reference."""

        with self._mutation_lock:
            package = self._verified_package(package_id, version)
            manifest = package.manifest
            if obscuration_mode not in supported_modes(manifest):
                raise DataPackageError(
                    "OBSCURATION_MODE_UNAVAILABLE",
                    "Surface mode requires a DSM, but this package only supports bare-earth mode",
                    409,
                    details={"supportedObscurationModes": ["bare-earth"]},
                )
            self.storage_root.mkdir(parents=True, exist_ok=True)
            temporary = self.storage_root / f".active-{uuid.uuid4().hex}.tmp"
            try:
                with temporary.open("w", encoding="utf-8", newline="\n") as stream:
                    json.dump(
                        {
                            "id": manifest.package_id,
                            "version": manifest.version,
                            "obscurationMode": obscuration_mode,
                        },
                        stream,
                    )
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, self.active_path)
            finally:
                temporary.unlink(missing_ok=True)
            return package_descriptor(
                manifest, active=True, obscuration_mode=obscuration_mode
            )

    def map_manifest(self) -> dict[str, Any]:
        """Build same-origin, versioned map configuration for the active package."""

        try:
            active = read_active_reference(self.active_path)
            if active is None:
                return {
                    "status": "missing",
                    "package": None,
                    "layers": None,
                    "errors": [
                        {"code": "ACTIVE_PACKAGE_MISSING", "message": "No data package is active"}
                    ],
                }
            package = self._verified_package(active.package_id, active.version)
        except DataPackageError as error:
            return {
                "status": "invalid",
                "package": None,
                "layers": None,
                "errors": [{"code": error.code, "message": error.message}],
            }
        return ready_map_manifest(package.manifest, active)

    def xyz_resource(
        self, package_id: str, version: str, z: int, x: int, y: int, extension: str
    ) -> Path:
        package = self._verified_package(package_id, version)
        return resolve_xyz_resource(package, z, x, y, extension)

    def terrain_resource(self, package_id: str, version: str, resource_path: str) -> Path:
        package = self._verified_package(package_id, version)
        return resolve_terrain_resource(package, resource_path)

    def road_tile_resource(
        self, package_id: str, version: str, z: int, x: int, y: int
    ) -> Path:
        package = self._verified_package(package_id, version)
        return resolve_road_tile_resource(package, z, x, y)

    def elevation_raster(
        self, obscuration_mode: Literal["bare-earth", "surface"]
    ) -> Path:
        """Resolve the authoritative DTM or DSM for the active analysis mode."""

        active = read_active_reference(self.active_path)
        if active is None:
            raise DataPackageError("ACTIVE_PACKAGE_MISSING", "No data package is active", 503)
        package = self._verified_package(active.package_id, active.version)
        return resolve_elevation_raster(package, obscuration_mode)
