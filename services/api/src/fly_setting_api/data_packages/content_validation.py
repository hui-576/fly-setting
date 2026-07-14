from __future__ import annotations

import json
import math
import re
import struct
from pathlib import Path, PurePosixPath
from typing import Any

import rasterio
from google.protobuf.message import DecodeError
from mapbox_vector_tile import decode as decode_vector_tile
from PIL import Image, UnidentifiedImageError
from shapely.geometry.base import BaseGeometry

from fly_setting_api.data_packages.errors import DataPackageError
from fly_setting_api.data_packages.gis_runtime import rasterio_environment
from fly_setting_api.data_packages.models import DataPackageManifest
from fly_setting_api.data_packages.mvt_budget_validation import (
    RoadGeometryBudget,
    RoadGeometryLimits,
    inspect_vector_tile,
)
from fly_setting_api.data_packages.quantized_mesh_validation import (
    validate_quantized_mesh,
)
from fly_setting_api.data_packages.road_source_validation import (
    RoadSourceMatcher,
    decoded_road_geometries,
)
from fly_setting_api.data_packages.tile_pyramid_validation import (
    parse_terrain_inventory,
    require_pyramid_coverage,
    require_tms_pyramid_coverage,
    validate_terrain_availability,
)

_TERRAIN_TEMPLATE = "{z}/{x}/{y}.terrain?v={version}"
_ROAD_TILE_PATTERN = re.compile(r"^(?P<z>\d+)/(?P<x>\d+)/(?P<y>\d+)\.mvt$")
_MIB = 1024 * 1024
_MAX_BASEMAP_TILE_BYTES = 32 * _MIB
_MAX_TERRAIN_METADATA_BYTES = _MIB
_MAX_TERRAIN_TILE_BYTES = 32 * _MIB
_MAX_ROAD_TILE_BYTES = 16 * _MIB
_MAX_ROAD_GEOJSON_BYTES = 64 * _MIB
_MAX_RASTER_WIDTH = 262_144
_MAX_RASTER_HEIGHT = 262_144
_MAX_RASTER_PIXELS = 4_000_000_000
_MAX_RASTER_BLOCK_PIXELS = 4_194_304
_ROAD_GEOMETRY_LIMITS = RoadGeometryLimits()


def _close_bounds(left: tuple[float, ...], right: tuple[float, ...]) -> bool:
    return all(
        math.isclose(a, b, rel_tol=0, abs_tol=1e-5)
        for a, b in zip(left, right, strict=True)
    )


def _validate_raster_size_limits(root: Path, manifest: DataPackageManifest) -> None:
    raster_assets = [manifest.assets.dtm]
    if manifest.assets.dsm is not None:
        raster_assets.append(manifest.assets.dsm)
    with rasterio_environment():
        for relative in raster_assets:
            path = root.joinpath(*PurePosixPath(relative).parts)
            with rasterio.open(path) as dataset:
                if dataset.width > _MAX_RASTER_WIDTH or dataset.height > _MAX_RASTER_HEIGHT:
                    raise DataPackageError(
                        "RASTER_DIMENSIONS_TOO_LARGE",
                        f"Raster dimensions exceed 262144 pixels per axis: {relative}",
                    )
                if dataset.width * dataset.height > _MAX_RASTER_PIXELS:
                    raise DataPackageError(
                        "RASTER_PIXEL_COUNT_TOO_LARGE",
                        f"Raster exceeds 4000000000 pixels: {relative}",
                    )
                if any(
                    block_height * block_width > _MAX_RASTER_BLOCK_PIXELS
                    for block_height, block_width in dataset.block_shapes
                ):
                    raise DataPackageError(
                        "RASTER_BLOCK_TOO_LARGE",
                        f"Raster block exceeds 4194304 pixels: {relative}",
                    )

def validate_basemap_tiles(
    root: Path, manifest: DataPackageManifest, files: set[PurePosixPath]
) -> None:
    """Decode every declared XYZ tile and enforce its declared coordinate pyramid."""

    _validate_raster_size_limits(root, manifest)
    asset = manifest.assets
    tile_root = PurePosixPath(asset.basemap_root)
    suffix = f".{asset.basemap_extension}"
    tiles = [path for path in files if path.is_relative_to(tile_root) and path.suffix == suffix]
    if not tiles:
        raise DataPackageError("BASEMAP_MISSING", "The XYZ basemap has no matching tiles")
    inventory: set[tuple[int, int, int]] = set()
    for relative in tiles:
        parts = relative.relative_to(tile_root).parts
        if len(parts) != 3:
            raise DataPackageError("BASEMAP_TILE_INVALID", f"Invalid XYZ tile path: {relative}")
        try:
            z, x = (int(parts[0]), int(parts[1]))
            y = int(PurePosixPath(parts[2]).stem)
        except ValueError as error:
            raise DataPackageError(
                "BASEMAP_TILE_INVALID", f"Invalid XYZ tile path: {relative}"
            ) from error
        if not (
            asset.basemap_minimum_level <= z <= asset.basemap_maximum_level
            and 0 <= x < 2**z
            and 0 <= y < 2**z
        ):
            raise DataPackageError("BASEMAP_TILE_INVALID", f"XYZ tile is out of range: {relative}")
        inventory.add((z, x, y))
        tile_path = root.joinpath(*relative.parts)
        if tile_path.stat().st_size > _MAX_BASEMAP_TILE_BYTES:
            raise DataPackageError(
                "BASEMAP_TILE_TOO_LARGE",
                f"XYZ basemap tile exceeds 32 MiB: {relative}",
            )
        try:
            with Image.open(tile_path) as image:
                image.verify()
                if image.width < 1 or image.height < 1 or image.width > 8192 or image.height > 8192:
                    raise ValueError("unsupported tile dimensions")
        except (OSError, UnidentifiedImageError, ValueError) as error:
            raise DataPackageError(
                "BASEMAP_TILE_INVALID", f"XYZ tile cannot be decoded: {relative}"
            ) from error
    require_pyramid_coverage(
        inventory,
        manifest.geographic_bounds,
        asset.basemap_minimum_level,
        asset.basemap_maximum_level,
        error_code="BASEMAP_PYRAMID_INCOMPLETE",
        label="XYZ basemap",
    )


def validate_terrain(
    root: Path, manifest: DataPackageManifest, files: set[PurePosixPath]
) -> None:
    """Validate offline-only TileJSON metadata and Quantized Mesh tile structure."""

    terrain_root = PurePosixPath(manifest.assets.terrain_root)
    layer_path = terrain_root / "layer.json"
    if layer_path not in files:
        raise DataPackageError("TERRAIN_MISSING", "Quantized Mesh layer.json is required")
    metadata_path = root.joinpath(*layer_path.parts)
    if metadata_path.stat().st_size > _MAX_TERRAIN_METADATA_BYTES:
        raise DataPackageError(
            "TERRAIN_METADATA_TOO_LARGE",
            "Quantized Mesh layer.json exceeds 1 MiB",
        )
    try:
        document: Any = json.loads(metadata_path.read_text(encoding="utf-8"))
        if document.get("format") != "quantized-mesh-1.0" or document.get("scheme") != "tms":
            raise ValueError("unsupported metadata")
        if document.get("tiles") != [_TERRAIN_TEMPLATE]:
            raise ValueError("terrain tiles must use the controlled relative template")
        bounds = tuple(float(value) for value in document["bounds"])
        if len(bounds) != 4 or not _close_bounds(bounds, manifest.geographic_bounds):
            raise DataPackageError(
                "TERRAIN_BOUNDS_MISMATCH", "Quantized Mesh bounds do not match the package"
            )
        minimum = int(document["minzoom"])
        maximum = int(document["maxzoom"])
        if minimum < 0 or maximum < minimum or maximum > 30:
            raise ValueError("invalid terrain levels")
    except DataPackageError:
        raise
    except (KeyError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DataPackageError("TERRAIN_INVALID", "Quantized Mesh layer.json is invalid") from error
    terrain_tiles = [
        path for path in files if path.is_relative_to(terrain_root) and path.suffix == ".terrain"
    ]
    if not terrain_tiles:
        raise DataPackageError("TERRAIN_MISSING", "Quantized Mesh has no tiles")
    inventory = parse_terrain_inventory(terrain_root, files, minimum, maximum)
    validate_terrain_availability(document.get("available"), inventory, minimum, maximum)
    require_tms_pyramid_coverage(
        inventory, manifest.geographic_bounds, minimum, maximum
    )
    for relative in terrain_tiles:
        tile_path = root.joinpath(*relative.parts)
        if tile_path.stat().st_size > _MAX_TERRAIN_TILE_BYTES:
            raise DataPackageError(
                "TERRAIN_TILE_TOO_LARGE",
                f"Quantized Mesh tile exceeds 32 MiB: {relative}",
            )
        try:
            validate_quantized_mesh(tile_path)
        except (OSError, ValueError, struct.error) as error:
            raise DataPackageError(
                "TERRAIN_TILE_INVALID", f"Quantized Mesh tile is invalid: {relative}"
            ) from error


def _decode_road_tile(
    tile_path: Path,
    layer_name: str,
    z: int,
    x: int,
    y: int,
    relative: PurePosixPath,
    budget: RoadGeometryBudget,
) -> tuple[list[BaseGeometry], float]:
    if tile_path.stat().st_size > _MAX_ROAD_TILE_BYTES:
        raise DataPackageError(
            "ROAD_TILE_TOO_LARGE",
            f"Road vector tile exceeds 16 MiB: {relative}",
    )
    try:
        payload = tile_path.read_bytes()
        inspect_vector_tile(payload, budget)
        decoded = decode_vector_tile(payload)
        layer = decoded.get(layer_name)
        if layer is None:
            return [], 0.0
        return decoded_road_geometries(layer, z, x, y)
    except (DecodeError, KeyError, TypeError, ValueError, OSError, struct.error) as error:
        raise DataPackageError(
            "ROAD_TILE_INVALID", f"Road vector tile is invalid: {relative}"
        ) from error


def validate_road_tiles(
    root: Path, manifest: DataPackageManifest, files: set[PurePosixPath]
) -> None:
    """Decode declared Mapbox Vector Tiles and require a non-empty line layer."""

    asset = manifest.assets
    roads_path = PurePosixPath(asset.roads)
    if root.joinpath(*roads_path.parts).stat().st_size > _MAX_ROAD_GEOJSON_BYTES:
        raise DataPackageError(
            "ROADS_TOO_LARGE",
            "Authoritative road GeoJSON exceeds 64 MiB",
        )
    tile_root = PurePosixPath(asset.road_tiles_root)
    tiles = [path for path in files if path.is_relative_to(tile_root) and path.suffix == ".mvt"]
    if not tiles:
        raise DataPackageError("ROAD_TILES_MISSING", "Road vector tiles are required")
    try:
        source_document = json.loads(
            root.joinpath(*roads_path.parts).read_text(encoding="utf-8")
        )
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DataPackageError("ROADS_INVALID", "Road data is invalid") from error
    source_matcher = RoadSourceMatcher.from_document(
        source_document, _ROAD_GEOMETRY_LIMITS
    )
    has_line_features = False
    geometry_budget = RoadGeometryBudget(_ROAD_GEOMETRY_LIMITS)
    inventory: set[tuple[int, int, int]] = set()
    for relative in tiles:
        match = _ROAD_TILE_PATTERN.fullmatch(relative.relative_to(tile_root).as_posix())
        if match is None:
            raise DataPackageError("ROAD_TILE_INVALID", f"Invalid road tile path: {relative}")
        z, x, y = (int(match.group(name)) for name in ("z", "x", "y"))
        if not (
            asset.road_tiles_minimum_level <= z <= asset.road_tiles_maximum_level
            and 0 <= x < 2**z
            and 0 <= y < 2**z
        ):
            raise DataPackageError("ROAD_TILE_INVALID", f"Road tile is out of range: {relative}")
        inventory.add((z, x, y))
        tile_path = root.joinpath(*relative.parts)
        geometries, tile_tolerance = _decode_road_tile(
            tile_path, asset.road_tiles_layer, z, x, y, relative, geometry_budget
        )
        source_matcher.match_tile(geometries, tile_tolerance)
        has_line_features = has_line_features or bool(geometries)
    require_pyramid_coverage(
        inventory,
        manifest.geographic_bounds,
        asset.road_tiles_minimum_level,
        asset.road_tiles_maximum_level,
        error_code="ROAD_TILE_PYRAMID_INCOMPLETE",
        label="Road vector tile pyramid",
    )
    if not has_line_features:
        raise DataPackageError("ROAD_TILE_INVALID", "Road vector tiles contain no line features")
    source_matcher.finish()
