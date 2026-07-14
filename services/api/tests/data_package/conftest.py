from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import os
import struct
import zlib
from pathlib import Path
from typing import Any

import numpy as np
from mapbox_vector_tile import encode as encode_vector_tile

_rasterio_spec = importlib.util.find_spec("rasterio")
assert _rasterio_spec is not None and _rasterio_spec.submodule_search_locations is not None
_rasterio_root = Path(next(iter(_rasterio_spec.submodule_search_locations)))
os.environ["GDAL_DATA"] = str(_rasterio_root / "gdal_data")
os.environ["PROJ_LIB"] = str(_rasterio_root / "proj_data")
rasterio = importlib.import_module("rasterio")
from_origin = importlib.import_module("rasterio.transform").from_origin
transform_bounds = importlib.import_module("rasterio.warp").transform_bounds
transform_coordinates = importlib.import_module("rasterio.warp").transform


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    checksum = zlib.crc32(kind + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", checksum)


def _synthetic_png(size: int = 256) -> bytes:
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            grid = x % 32 < 2 or y % 32 < 2
            rows.extend((28, 92, 125, 255) if grid else (42, 72 + y // 8, 88 + x // 6, 255))
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", header)
        + _png_chunk(b"IDAT", zlib.compress(bytes(rows), level=9))
        + _png_chunk(b"IEND", b"")
    )


def _zigzag_delta(values: list[int]) -> list[int]:
    encoded: list[int] = []
    previous = 0
    for value in values:
        delta = value - previous
        encoded.append((delta << 1) ^ (delta >> 31))
        previous = value
    return encoded


def _flat_quantized_mesh() -> bytes:
    header = struct.pack(
        "<dddffddddddd",
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        6_378_137.0,
        0.0,
        0.0,
        0.0,
    )
    u_values = _zigzag_delta([0, 32767, 0, 32767])
    v_values = _zigzag_delta([0, 0, 32767, 32767])
    height_values = _zigzag_delta([0, 0, 0, 0])
    vertices = struct.pack("<I", 4) + struct.pack("<12H", *(u_values + v_values + height_values))
    triangles = struct.pack("<I6H", 2, 0, 0, 0, 2, 0, 2)
    edges = b"".join(
        struct.pack("<I2H", 2, *indices)
        for indices in ([0, 2], [1, 3], [0, 1], [2, 3])
    )
    return header + vertices + triangles + edges


def _web_mercator_tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    tiles = 2**z
    west = x / tiles * 360.0 - 180.0
    east = (x + 1) / tiles * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / tiles))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / tiles))))
    return west, south, east, north


def create_data_package(
    root: Path,
    *,
    package_id: str = "hubei-demo",
    version: str = "2026.07.0",
    include_dsm: bool = True,
) -> Path:
    """Create a complete synthetic package with real raster metadata."""

    source = root / f"{package_id}-{version}"
    elevation = source / "elevation"
    imagery = source / "imagery" / "0" / "0"
    terrain = source / "terrain" / "0" / "0"
    roads = source / "roads"
    road_tile_level = 8
    road_tile_x = 207
    road_tile_y = 104
    road_tiles = roads / "tiles" / str(road_tile_level) / str(road_tile_x)
    for directory in (elevation, imagery, terrain, roads, road_tiles):
        directory.mkdir(parents=True, exist_ok=True)

    projected_x, projected_y = transform_coordinates(
        "EPSG:4326", "EPSG:3857", [112.295], [30.905]
    )
    transform = from_origin(projected_x[0], projected_y[0], 10.0, 10.0)
    raster_profile: dict[str, Any] = {
        "driver": "GTiff",
        "height": 100,
        "width": 100,
        "count": 1,
        "dtype": "float32",
        "crs": "EPSG:3857",
        "transform": transform,
        "nodata": -9999.0,
    }
    dtm = elevation / "dtm.tif"
    with rasterio.open(dtm, "w", **raster_profile) as dataset:
        dataset.write(np.full((1, 100, 100), 100.0, dtype=np.float32))
        dataset.update_tags(VERTICAL_UNIT="m")

    dsm = elevation / "dsm.tif"
    if include_dsm:
        with rasterio.open(dsm, "w", **raster_profile) as dataset:
            dataset.write(np.full((1, 100, 100), 105.0, dtype=np.float32))
            dataset.update_tags(VERTICAL_UNIT="m")

    projected_extent = [
        transform.c,
        transform.f - 1_000.0,
        transform.c + 1_000.0,
        transform.f,
    ]
    geographic_bounds = list(
        transform_bounds("EPSG:3857", "EPSG:4326", *projected_extent)
    )

    (imagery / "0.png").write_bytes(_synthetic_png())
    (terrain / "0.terrain").write_bytes(_flat_quantized_mesh())
    (source / "terrain" / "layer.json").write_text(
        json.dumps(
            {
                "tilejson": "2.1.0",
                "format": "quantized-mesh-1.0",
                "version": "1.0.0",
                "scheme": "tms",
                "tiles": ["{z}/{x}/{y}.terrain?v={version}"],
                "minzoom": 0,
                "maxzoom": 0,
                "bounds": geographic_bounds,
                "available": [[{"startX": 0, "startY": 0, "endX": 0, "endY": 0}]],
            }
        ),
        encoding="utf-8",
    )
    (roads / "roads.geojson").write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"name": "synthetic road"},
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[112.297, 30.899], [112.302, 30.903]],
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    road_tile_files: list[str] = []
    for tile_x in range(203, 212):
        for tile_y in range(102, 106):
            tile_directory = roads / "tiles" / str(road_tile_level) / str(tile_x)
            tile_directory.mkdir(parents=True, exist_ok=True)
            features = []
            if (tile_x, tile_y) == (road_tile_x, road_tile_y):
                features = [
                    {
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[112.297, 30.899], [112.302, 30.903]],
                        },
                        "properties": {"name": "synthetic road"},
                    }
                ]
            relative = f"roads/tiles/{road_tile_level}/{tile_x}/{tile_y}.mvt"
            (source / relative).write_bytes(
                encode_vector_tile(
                    {"name": "roads", "features": features},
                    default_options={
                        "quantize_bounds": _web_mercator_tile_bounds(
                            road_tile_level, tile_x, tile_y
                        )
                    },
                )
            )
            road_tile_files.append(relative)

    relative_files = [
        "elevation/dtm.tif",
        *(["elevation/dsm.tif"] if include_dsm else []),
        "imagery/0/0/0.png",
        "terrain/layer.json",
        "terrain/0/0/0.terrain",
        "roads/roads.geojson",
        *road_tile_files,
    ]
    manifest = {
        "schemaVersion": 1,
        "id": package_id,
        "version": version,
        "displayName": "Synthetic Hubei data",
        "crs": "EPSG:3857",
        "extent": projected_extent,
        "geographicBounds": geographic_bounds,
        "pixelSize": [10.0, 10.0],
        "noData": -9999.0,
        "verticalUnit": "m",
        "accuracyHint": "Synthetic fixture; not for operational use",
        "license": {
            "name": "Synthetic Test Data",
            "spdxId": "CC0-1.0",
            "source": "generated:test-suite",
            "offlineUseApproved": True,
            "attribution": "Generated by the automated test suite",
            "notice": "No external redistribution restrictions",
        },
        "assets": {
            "dtm": "elevation/dtm.tif",
            "dsm": "elevation/dsm.tif" if include_dsm else None,
            "basemapRoot": "imagery",
            "basemapExtension": "png",
            "basemapMinimumLevel": 0,
            "basemapMaximumLevel": 0,
            "terrainRoot": "terrain",
            "roads": "roads/roads.geojson",
            "roadsCrs": "EPSG:4326",
            "roadTilesRoot": "roads/tiles",
            "roadTilesLayer": "roads",
            "roadTilesMinimumLevel": road_tile_level,
            "roadTilesMaximumLevel": road_tile_level,
        },
        "files": [
            {"path": relative, "sha256": _sha256(source / relative)}
            for relative in relative_files
        ],
    }
    (source / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return source
