from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Literal

from fly_setting_api.data_packages.errors import DataPackageError
from fly_setting_api.data_packages.models import DataPackageManifest
from fly_setting_api.data_packages.validation import safe_relative_path


@dataclass(frozen=True, slots=True)
class VerifiedPackage:
    """Immutable in-process index built only after complete package validation."""

    root: Path
    manifest: DataPackageManifest
    declared_files: Mapping[str, str]


def index_package(root: Path, manifest: DataPackageManifest) -> VerifiedPackage:
    """Build an immutable resource index from a fully validated manifest."""

    return VerifiedPackage(
        root=root,
        manifest=manifest,
        declared_files=MappingProxyType(
            {entry.path: entry.sha256 for entry in manifest.files}
        ),
    )


def declared_resource(package: VerifiedPackage, path: str) -> Path:
    """Resolve and re-hash one declared immutable package resource."""

    relative = safe_relative_path(path, field="map resource path")
    expected_hash = package.declared_files.get(relative.as_posix())
    if expected_hash is None:
        raise DataPackageError("MAP_RESOURCE_NOT_FOUND", "Map resource was not found", 404)
    resource = package.root.joinpath(*relative.parts)
    resolved = resource.resolve()
    if not resolved.is_relative_to(package.root) or not resource.is_file():
        raise DataPackageError("MAP_RESOURCE_NOT_FOUND", "Map resource was not found", 404)
    digest = hashlib.sha256()
    with resource.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected_hash:
        raise DataPackageError(
            "CHECKSUM_MISMATCH", "Map resource integrity check failed", 409
        )
    return resource


def xyz_resource(
    package: VerifiedPackage, z: int, x: int, y: int, extension: str
) -> Path:
    asset = package.manifest.assets
    if not (
        asset.basemap_minimum_level <= z <= asset.basemap_maximum_level
        and 0 <= x < 2**z
        and 0 <= y < 2**z
    ):
        raise DataPackageError("TILE_COORDINATE_INVALID", "XYZ coordinate is out of range", 400)
    if extension != asset.basemap_extension:
        raise DataPackageError("MAP_RESOURCE_NOT_FOUND", "Map resource was not found", 404)
    return declared_resource(package, f"{asset.basemap_root}/{z}/{x}/{y}.{extension}")


def terrain_resource(package: VerifiedPackage, resource_path: str) -> Path:
    requested = safe_relative_path(resource_path, field="terrain path")
    return declared_resource(
        package, f"{package.manifest.assets.terrain_root}/{requested.as_posix()}"
    )


def road_tile_resource(package: VerifiedPackage, z: int, x: int, y: int) -> Path:
    asset = package.manifest.assets
    if not (
        asset.road_tiles_minimum_level <= z <= asset.road_tiles_maximum_level
        and 0 <= x < 2**z
        and 0 <= y < 2**z
    ):
        raise DataPackageError("TILE_COORDINATE_INVALID", "Road tile is out of range", 400)
    return declared_resource(package, f"{asset.road_tiles_root}/{z}/{x}/{y}.mvt")


def elevation_raster(
    package: VerifiedPackage,
    obscuration_mode: Literal["bare-earth", "surface"],
) -> Path:
    relative = package.manifest.assets.dtm
    if obscuration_mode == "surface":
        if package.manifest.assets.dsm is None:
            raise DataPackageError(
                "OBSCURATION_MODE_UNAVAILABLE",
                "Surface mode requires a DSM, but this package only supports bare-earth mode",
                409,
                details={"supportedObscurationModes": ["bare-earth"]},
            )
        relative = package.manifest.assets.dsm
    return declared_resource(package, relative)
