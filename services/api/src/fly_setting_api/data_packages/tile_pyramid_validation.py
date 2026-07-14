from __future__ import annotations

import math
import re
from collections.abc import Iterable
from pathlib import PurePosixPath
from typing import Any

from fly_setting_api.data_packages.errors import DataPackageError

_MAX_DECLARED_TILES = 250_000
_WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066
_TERRAIN_TILE_PATTERN = re.compile(
    r"^(?P<z>0|[1-9]\d*)/(?P<x>0|[1-9]\d*)/(?P<y>0|[1-9]\d*)\.terrain$"
)

TileCoordinate = tuple[int, int, int]


def _mercator_y(latitude: float, tile_count: int) -> float:
    latitude = min(max(latitude, -_WEB_MERCATOR_MAX_LATITUDE), _WEB_MERCATOR_MAX_LATITUDE)
    radians = math.radians(latitude)
    return (1 - math.asinh(math.tan(radians)) / math.pi) / 2 * tile_count


def required_web_mercator_tiles(
    bounds: tuple[float, float, float, float], minimum: int, maximum: int
) -> set[TileCoordinate]:
    """Return every XYZ tile intersecting the non-empty declared bounds."""

    west, south, east, north = bounds
    required: set[TileCoordinate] = set()
    for zoom in range(minimum, maximum + 1):
        tile_count = 2**zoom
        west_x = (west + 180.0) / 360.0 * tile_count
        east_x = (east + 180.0) / 360.0 * tile_count
        north_y = _mercator_y(north, tile_count)
        south_y = _mercator_y(south, tile_count)
        x_min = min(tile_count - 1, max(0, math.floor(west_x)))
        x_max = min(
            tile_count - 1,
            max(0, math.floor(math.nextafter(east_x, -math.inf))),
        )
        y_min = min(tile_count - 1, max(0, math.floor(north_y)))
        y_max = min(
            tile_count - 1,
            max(0, math.floor(math.nextafter(south_y, -math.inf))),
        )
        count = (x_max - x_min + 1) * (y_max - y_min + 1)
        if count < 1 or len(required) + count > _MAX_DECLARED_TILES:
            raise DataPackageError(
                "TILE_PYRAMID_TOO_LARGE",
                "The declared bounds and zoom levels exceed the package tile limit",
            )
        required.update(
            (zoom, x, y)
            for x in range(x_min, x_max + 1)
            for y in range(y_min, y_max + 1)
        )
    return required


def require_pyramid_coverage(
    inventory: set[TileCoordinate],
    bounds: tuple[float, float, float, float],
    minimum: int,
    maximum: int,
    *,
    error_code: str,
    label: str,
) -> None:
    """Reject a Web Mercator pyramid that omits any tile required by its bounds."""

    missing = required_web_mercator_tiles(bounds, minimum, maximum) - inventory
    if missing:
        raise DataPackageError(
            error_code,
            f"{label} does not cover every declared bounds tile",
            details={"missing": [f"{z}/{x}/{y}" for z, x, y in sorted(missing)[:100]]},
        )


def require_tms_pyramid_coverage(
    inventory: set[TileCoordinate],
    bounds: tuple[float, float, float, float],
    minimum: int,
    maximum: int,
) -> None:
    """Reject a TMS terrain pyramid missing any tile required by its bounds."""

    xyz_required = required_web_mercator_tiles(bounds, minimum, maximum)
    required = {
        (zoom, x, 2**zoom - 1 - xyz_y) for zoom, x, xyz_y in xyz_required
    }
    missing = required - inventory
    if missing:
        raise DataPackageError(
            "TERRAIN_PYRAMID_INCOMPLETE",
            "Quantized Mesh terrain does not cover every declared bounds tile",
            details={"missing": [f"{z}/{x}/{y}" for z, x, y in sorted(missing)[:100]]},
        )


def parse_terrain_inventory(
    terrain_root: PurePosixPath,
    files: Iterable[PurePosixPath],
    minimum: int,
    maximum: int,
) -> set[TileCoordinate]:
    """Parse and range-check strict z/x/y.terrain paths using TMS coordinates."""

    inventory: set[TileCoordinate] = set()
    for relative in files:
        if not relative.is_relative_to(terrain_root) or relative.suffix != ".terrain":
            continue
        match = _TERRAIN_TILE_PATTERN.fullmatch(
            relative.relative_to(terrain_root).as_posix()
        )
        if match is None:
            raise DataPackageError(
                "TERRAIN_TILE_INVALID", f"Invalid Quantized Mesh tile path: {relative}"
            )
        coordinate = (
            int(match.group("z")),
            int(match.group("x")),
            int(match.group("y")),
        )
        zoom, x, y = coordinate
        if not (minimum <= zoom <= maximum and 0 <= x < 2**zoom and 0 <= y < 2**zoom):
            raise DataPackageError(
                "TERRAIN_TILE_INVALID", f"Quantized Mesh tile is out of range: {relative}"
            )
        inventory.add(coordinate)
    return inventory


def _availability_range(
    zoom: int,
    tile_range: Any,
    minimum: int,
    maximum: int,
) -> tuple[range, range]:
    required_fields = {"startX", "startY", "endX", "endY"}
    if not isinstance(tile_range, dict) or set(tile_range) != required_fields:
        raise DataPackageError(
            "TERRAIN_AVAILABILITY_MISMATCH",
            "Quantized Mesh availability range is invalid",
        )
    values = tuple(
        tile_range[name] for name in ("startX", "startY", "endX", "endY")
    )
    if any(isinstance(value, bool) or not isinstance(value, int) for value in values):
        raise DataPackageError(
            "TERRAIN_AVAILABILITY_MISMATCH",
            "Quantized Mesh availability coordinates must be integers",
        )
    start_x, start_y, end_x, end_y = values
    if not (
        minimum <= zoom <= maximum
        and 0 <= start_x <= end_x < 2**zoom
        and 0 <= start_y <= end_y < 2**zoom
    ):
        raise DataPackageError(
            "TERRAIN_AVAILABILITY_MISMATCH",
            "Quantized Mesh availability coordinates are out of range",
        )
    return range(start_x, end_x + 1), range(start_y, end_y + 1)


def validate_terrain_availability(
    available: Any,
    inventory: set[TileCoordinate],
    minimum: int,
    maximum: int,
) -> None:
    """Require layer.json availability ranges to exactly describe tile inventory."""

    if not isinstance(available, list) or len(available) != maximum + 1:
        raise DataPackageError(
            "TERRAIN_AVAILABILITY_MISMATCH",
            "Quantized Mesh availability must contain one entry per zoom level",
        )
    declared: set[TileCoordinate] = set()
    for zoom, ranges in enumerate(available):
        if not isinstance(ranges, list) or (zoom < minimum and ranges):
            raise DataPackageError(
                "TERRAIN_AVAILABILITY_MISMATCH",
                "Quantized Mesh availability contains an invalid zoom entry",
            )
        for tile_range in ranges:
            x_range, y_range = _availability_range(
                zoom, tile_range, minimum, maximum
            )
            count = len(x_range) * len(y_range)
            if len(declared) + count > _MAX_DECLARED_TILES:
                raise DataPackageError(
                    "TERRAIN_AVAILABILITY_MISMATCH",
                    "Quantized Mesh availability exceeds the package tile limit",
                )
            coordinates = {
                (zoom, x, y) for x in x_range for y in y_range
            }
            if declared.intersection(coordinates):
                raise DataPackageError(
                    "TERRAIN_AVAILABILITY_MISMATCH",
                    "Quantized Mesh availability ranges overlap",
                )
            declared.update(coordinates)
    if declared != inventory:
        raise DataPackageError(
            "TERRAIN_AVAILABILITY_MISMATCH",
            "Quantized Mesh availability does not match the tile inventory",
            details={
                "missing": [f"{z}/{x}/{y}" for z, x, y in sorted(declared - inventory)[:100]],
                "undeclared": [
                    f"{z}/{x}/{y}" for z, x, y in sorted(inventory - declared)[:100]
                ],
            },
        )
