from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath
from typing import Any

import numpy as np
import rasterio
from pydantic import ValidationError
from rasterio.warp import transform_bounds
from shapely import union_all
from shapely.geometry import box

from fly_setting_api.data_packages.content_validation import (
    validate_basemap_tiles,
    validate_road_tiles,
    validate_terrain,
)
from fly_setting_api.data_packages.errors import DataPackageError
from fly_setting_api.data_packages.gis_runtime import rasterio_environment
from fly_setting_api.data_packages.license_trust import LicenseTrustStore
from fly_setting_api.data_packages.license_validation import validate_license
from fly_setting_api.data_packages.models import DataPackageManifest
from fly_setting_api.data_packages.road_source_validation import bounded_source_geometries

_MANIFEST_LIMIT = 1024 * 1024
_MAX_ROAD_GEOJSON_BYTES = 64 * 1024 * 1024
_HUBEI_BOUNDS = box(108.3, 29.0, 116.2, 33.3)


def safe_relative_path(value: str, *, field: str) -> PurePosixPath:
    """Validate one manifest path using platform-independent POSIX semantics."""

    if not value or "\\" in value or ":" in value:
        raise DataPackageError("MANIFEST_PATH_INVALID", f"{field} is not a safe relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise DataPackageError("MANIFEST_PATH_INVALID", f"{field} is not a safe relative path")
    return path


def _load_manifest(package_root: Path) -> DataPackageManifest:
    manifest_path = package_root / "manifest.json"
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise DataPackageError("MANIFEST_MISSING", "manifest.json is required")
    if manifest_path.stat().st_size > _MANIFEST_LIMIT:
        raise DataPackageError("MANIFEST_TOO_LARGE", "manifest.json exceeds 1 MiB")
    try:
        document: Any = json.loads(manifest_path.read_text(encoding="utf-8"))
        return DataPackageManifest.model_validate(document)
    except (UnicodeDecodeError, json.JSONDecodeError, ValidationError) as error:
        raise DataPackageError(
            "MANIFEST_INVALID",
            "manifest.json does not satisfy schema version 1",
            details={"reason": str(error)},
        ) from error


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_file_inventory(root: Path, manifest: DataPackageManifest) -> None:
    declared: dict[PurePosixPath, str] = {}
    for entry in manifest.files:
        relative = safe_relative_path(entry.path, field="files.path")
        declared[relative] = entry.sha256
    actual: set[PurePosixPath] = set()
    for path in root.rglob("*"):
        is_junction = getattr(path, "is_junction", lambda: False)
        if path.is_symlink() or is_junction():
            raise DataPackageError("PACKAGE_SYMLINK_FORBIDDEN", "Package symlinks are forbidden")
        if path.is_file() and path.name != "manifest.json":
            actual.add(PurePosixPath(path.relative_to(root).as_posix()))
    if actual != set(declared):
        raise DataPackageError(
            "FILE_INVENTORY_MISMATCH",
            "Package files must exactly match the manifest inventory",
            details={
                "missing": sorted(str(path) for path in set(declared) - actual),
                "undeclared": sorted(str(path) for path in actual - set(declared)),
            },
        )
    for relative, expected_hash in declared.items():
        if _hash_file(root.joinpath(*relative.parts)) != expected_hash:
            raise DataPackageError(
                "CHECKSUM_MISMATCH", f"SHA-256 mismatch for {relative}"
            )


def _validate_asset_references(
    root: Path, manifest: DataPackageManifest
) -> set[PurePosixPath]:
    files = {PurePosixPath(entry.path) for entry in manifest.files}
    for field, value in (
        ("assets.dtm", manifest.assets.dtm),
        ("assets.roads", manifest.assets.roads),
    ):
        if safe_relative_path(value, field=field) not in files:
            raise DataPackageError("ASSET_MISSING", f"{field} is not present in files")
    if manifest.assets.dsm is not None:
        dsm = safe_relative_path(manifest.assets.dsm, field="assets.dsm")
        if dsm not in files:
            raise DataPackageError("ASSET_MISSING", "assets.dsm is not present in files")
    basemap_root = safe_relative_path(manifest.assets.basemap_root, field="assets.basemapRoot")
    terrain_root = safe_relative_path(manifest.assets.terrain_root, field="assets.terrainRoot")
    road_tiles_root = safe_relative_path(
        manifest.assets.road_tiles_root, field="assets.roadTilesRoot"
    )
    if not any(path.is_relative_to(basemap_root) for path in files):
        raise DataPackageError("BASEMAP_MISSING", "The XYZ basemap has no declared files")
    if not any(path.is_relative_to(terrain_root) for path in files):
        raise DataPackageError("TERRAIN_MISSING", "Quantized Mesh has no declared files")
    if not any(path.is_relative_to(road_tiles_root) for path in files):
        raise DataPackageError("ROAD_TILES_MISSING", "Road vector tiles are required")
    for relative in (basemap_root, terrain_root, road_tiles_root):
        if not root.joinpath(*relative.parts).is_dir():
            raise DataPackageError("ASSET_MISSING", f"Asset directory {relative} is missing")
    validate_basemap_tiles(root, manifest, files)
    validate_terrain(root, manifest, files)
    return files


def _open_raster(root: Path, relative: str) -> rasterio.DatasetReader:
    path = safe_relative_path(relative, field="raster asset")
    return rasterio.open(root.joinpath(*path.parts))


def _validate_raster(root: Path, manifest: DataPackageManifest, relative: str) -> None:
    with _open_raster(root, relative) as dataset:
        if dataset.crs is None or not dataset.crs.is_projected:
            raise DataPackageError("CRS_INVALID", "Elevation CRS must be projected")
        if dataset.crs != rasterio.crs.CRS.from_user_input(manifest.crs):
            raise DataPackageError("CRS_MISMATCH", f"CRS mismatch for {relative}")
        if not np.allclose(dataset.bounds, manifest.extent, rtol=0, atol=1e-6):
            raise DataPackageError("EXTENT_MISMATCH", f"Extent mismatch for {relative}")
        if not np.allclose(dataset.res, manifest.pixel_size, rtol=0, atol=1e-9):
            raise DataPackageError("PIXEL_SIZE_MISMATCH", f"Pixel size mismatch for {relative}")
        if dataset.nodata is None or not np.isclose(dataset.nodata, manifest.no_data):
            raise DataPackageError("NODATA_MISMATCH", f"NoData mismatch for {relative}")
        if dataset.tags().get("VERTICAL_UNIT") != manifest.vertical_unit:
            raise DataPackageError(
                "VERTICAL_UNIT_MISMATCH", f"Vertical unit mismatch for {relative}"
            )
        if dataset.count != 1:
            raise DataPackageError("ELEVATION_BAND_COUNT_INVALID", "Elevation must be single-band")
        geographic_bounds = transform_bounds(dataset.crs, "EPSG:4326", *dataset.bounds)
        if not np.allclose(
            geographic_bounds, manifest.geographic_bounds, rtol=0, atol=1e-5
        ):
            raise DataPackageError(
                "GEOGRAPHIC_BOUNDS_MISMATCH", f"Geographic bounds mismatch for {relative}"
            )
        if not _HUBEI_BOUNDS.intersects(box(*geographic_bounds)):
            raise DataPackageError(
                "ELEVATION_OUTSIDE_HUBEI", f"Elevation does not intersect Hubei for {relative}"
            )
        has_valid_data = False
        for _, window in dataset.block_windows(1):
            values = dataset.read(1, window=window, masked=True)
            if np.ma.count(values):
                has_valid_data = True
                break
        if not has_valid_data:
            raise DataPackageError(
                "ELEVATION_HAS_NO_VALID_DATA", f"Elevation contains no valid cells for {relative}"
            )


def _validate_alignment(root: Path, manifest: DataPackageManifest) -> None:
    if manifest.assets.dsm is None:
        return
    with _open_raster(root, manifest.assets.dtm) as dtm, _open_raster(
        root, manifest.assets.dsm
    ) as dsm:
        if (
            dtm.shape != dsm.shape
            or dtm.crs != dsm.crs
            or dtm.transform != dsm.transform
            or dtm.nodata != dsm.nodata
        ):
            raise DataPackageError("ELEVATION_ALIGNMENT_MISMATCH", "DTM and DSM are not aligned")


def _validate_roads(root: Path, manifest: DataPackageManifest) -> None:
    relative = safe_relative_path(manifest.assets.roads, field="assets.roads")
    road_path = root.joinpath(*relative.parts)
    if road_path.stat().st_size > _MAX_ROAD_GEOJSON_BYTES:
        raise DataPackageError(
            "ROADS_TOO_LARGE", "Authoritative road GeoJSON exceeds 64 MiB"
        )
    try:
        document = json.loads(road_path.read_text(encoding="utf-8"))
        if "crs" in document:
            raise ValueError("RFC 7946 GeoJSON must not declare a custom CRS")
        features = document["features"]
        if (
            document["type"] != "FeatureCollection"
            or not isinstance(features, list)
            or not features
        ):
            raise ValueError("roads must be a non-empty FeatureCollection")
        geometries = bounded_source_geometries(document)
        fingerprints: set[bytes] = set()
        elevation_bounds = box(*manifest.geographic_bounds)
        for geometry in geometries:
            if geometry.geom_type not in {"LineString", "MultiLineString"}:
                raise ValueError("road geometry must contain lines")
            if geometry.is_empty or not geometry.is_valid:
                raise ValueError("road geometry must be non-empty and valid")
            min_x, min_y, max_x, max_y = geometry.bounds
            if min_x < -180 or min_y < -90 or max_x > 180 or max_y > 90:
                raise ValueError("road geometry must use WGS84 longitude and latitude")
            if not _HUBEI_BOUNDS.covers(geometry):
                raise ValueError("road geometry must be inside the Hubei data region")
            if not elevation_bounds.covers(geometry):
                raise DataPackageError(
                    "ROADS_OUTSIDE_ELEVATION_EXTENT",
                    "Road data is outside the elevation coverage",
                )
            fingerprint = geometry.normalize().wkb
            if fingerprint in fingerprints:
                raise ValueError("road data contains duplicate geometry")
            fingerprints.add(fingerprint)
        network = union_all(geometries)
        if network.is_empty or not network.is_valid:
            raise ValueError("road network topology is invalid")
    except DataPackageError:
        raise
    except (KeyError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DataPackageError(
            "ROADS_INVALID", "Road data is invalid", details={"reason": str(error)}
        ) from error


def validate_package(
    root: Path, *, license_trust_store: LicenseTrustStore | None = None
) -> DataPackageManifest:
    """Validate a package directory completely before it can be published."""

    try:
        manifest = _load_manifest(root)
        _validate_file_inventory(root, manifest)
        validate_license(root, manifest, license_trust_store)
        files = _validate_asset_references(root, manifest)
        with rasterio_environment():
            _validate_raster(root, manifest, manifest.assets.dtm)
            if manifest.assets.dsm is not None:
                _validate_raster(root, manifest, manifest.assets.dsm)
            _validate_alignment(root, manifest)
        _validate_roads(root, manifest)
        validate_road_tiles(root, manifest, files)
        return manifest
    except DataPackageError:
        raise
    except (OSError, rasterio.errors.RasterioError, ValueError) as error:
        raise DataPackageError(
            "PACKAGE_CONTENT_UNREADABLE", "Package content cannot be safely validated"
        ) from error
