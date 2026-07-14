from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from shapely import union_all
from shapely.geometry import LineString, MultiLineString, shape
from shapely.geometry.base import BaseGeometry

from fly_setting_api.data_packages.errors import DataPackageError
from fly_setting_api.data_packages.mvt_budget_validation import RoadGeometryLimits


def _coordinate_pair_count(value: Any, maximum: int) -> int:
    stack = [value]
    coordinates = 0
    while stack:
        current = stack.pop()
        if not isinstance(current, Sequence) or isinstance(current, (str, bytes)):
            raise ValueError("road coordinates are invalid")
        if (
            len(current) == 2
            and all(
                isinstance(item, (int, float)) and not isinstance(item, bool)
                for item in current
            )
        ):
            coordinates += 1
            if coordinates > maximum:
                return coordinates
            continue
        stack.extend(reversed(current))
    return coordinates


def bounded_source_geometries(
    document: Mapping[str, Any], limits: RoadGeometryLimits | None = None
) -> list[BaseGeometry]:
    """Bound authoritative GeoJSON before allocating Shapely geometries."""

    resolved_limits = limits or RoadGeometryLimits()
    features = document.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("road source features are invalid")
    if len(features) > resolved_limits.max_features_per_package:
        raise DataPackageError(
            "ROAD_PACKAGE_FEATURE_LIMIT_EXCEEDED",
            "Authoritative roads exceed the package feature budget",
        )
    geometries: list[BaseGeometry] = []
    coordinates = 0
    for feature in features:
        if not isinstance(feature, Mapping) or not isinstance(feature.get("geometry"), Mapping):
            raise ValueError("road source geometry is invalid")
        geometry_document = feature["geometry"]
        if geometry_document.get("type") not in {"LineString", "MultiLineString"}:
            raise ValueError("road geometry must contain lines")
        remaining = resolved_limits.max_coordinates_per_package - coordinates
        coordinates += _coordinate_pair_count(geometry_document.get("coordinates"), remaining)
        if coordinates > resolved_limits.max_coordinates_per_package:
            raise DataPackageError(
                "ROAD_PACKAGE_COORDINATE_LIMIT_EXCEEDED",
                "Authoritative roads exceed the package coordinate budget",
            )
        geometries.append(shape(geometry_document))
    return geometries


@dataclass(slots=True)
class RoadSourceMatcher:
    """Match each rendered tile immediately while tracking uncovered source lines."""

    source_network: BaseGeometry
    uncovered_source: BaseGeometry

    @classmethod
    def from_document(
        cls,
        document: Mapping[str, Any],
        limits: RoadGeometryLimits | None = None,
    ) -> RoadSourceMatcher:
        resolved_limits = limits or RoadGeometryLimits()
        try:
            features = document["features"]
            if not isinstance(features, list) or not features:
                raise ValueError("road source features are invalid")
            if len(features) > resolved_limits.max_features_per_package:
                raise DataPackageError(
                    "ROAD_PACKAGE_FEATURE_LIMIT_EXCEEDED",
                    "Authoritative roads exceed the package feature budget",
                )
            geometries = bounded_source_geometries(document, resolved_limits)
            source_network = union_all(geometries)
            if source_network.is_empty:
                raise ValueError("road source network is empty")
            return cls(source_network, source_network)
        except DataPackageError:
            raise
        except (KeyError, TypeError, ValueError) as error:
            raise DataPackageError(
                "ROAD_TILE_SOURCE_MISMATCH",
                "Authoritative roads cannot be matched to vector tiles",
            ) from error

    def match_tile(
        self, geometries: list[BaseGeometry], tolerance_degrees: float
    ) -> None:
        if not geometries:
            return
        rendered_network = union_all(geometries)
        permitted = self.source_network.buffer(tolerance_degrees)
        if not rendered_network.difference(permitted).is_empty:
            raise DataPackageError(
                "ROAD_TILE_SOURCE_MISMATCH",
                "Road vector tiles do not match the authoritative road GeoJSON",
            )
        covered = rendered_network.buffer(tolerance_degrees)
        self.uncovered_source = self.uncovered_source.difference(covered)

    def finish(self) -> None:
        if not self.uncovered_source.is_empty:
            raise DataPackageError(
                "ROAD_TILE_SOURCE_MISMATCH",
                "Road vector tiles do not cover the authoritative road GeoJSON",
            )


def _local_to_wgs84(
    x: float, y: float, zoom: int, tile_x: int, tile_y: int, extent: int
) -> tuple[float, float]:
    tile_count = 2**zoom
    longitude = (tile_x + x / extent) / tile_count * 360.0 - 180.0
    normalized_y = (tile_y + 1.0 - y / extent) / tile_count
    latitude = math.degrees(
        math.atan(math.sinh(math.pi * (1.0 - 2.0 * normalized_y)))
    )
    return longitude, latitude


def decoded_road_geometries(
    layer: Mapping[str, Any], zoom: int, tile_x: int, tile_y: int
) -> tuple[list[BaseGeometry], float]:
    """Convert decoded MVT line features from tile coordinates to WGS84."""

    extent = layer.get("extent")
    features = layer.get("features")
    if (
        isinstance(extent, bool)
        or not isinstance(extent, int)
        or not 1 <= extent <= 65_536
        or not isinstance(features, list)
    ):
        raise ValueError("road layer metadata is invalid")
    geometries: list[BaseGeometry] = []
    for feature in features:
        geometry = feature.get("geometry")
        if not isinstance(geometry, Mapping):
            raise ValueError("road feature geometry is invalid")
        geometry_type = geometry.get("type")
        coordinates = geometry.get("coordinates")
        if geometry_type == "LineString":
            geometries.append(
                LineString(
                    _line_coordinates(coordinates, zoom, tile_x, tile_y, extent)
                )
            )
        elif geometry_type == "MultiLineString" and isinstance(coordinates, Sequence):
            geometries.append(
                MultiLineString(
                    _line_coordinates(line, zoom, tile_x, tile_y, extent)
                    for line in coordinates
                )
            )
        else:
            raise ValueError("road layer must contain line features")
    # Quantization, clipping and inverse Web Mercator projection can compound
    # to several tile units at low zoom levels.
    tolerance = 4.0 * 360.0 / (2**zoom * extent)
    return geometries, tolerance


def _line_coordinates(
    coordinates: Any, zoom: int, tile_x: int, tile_y: int, extent: int
) -> list[tuple[float, float]]:
    if not isinstance(coordinates, Sequence) or len(coordinates) < 2:
        raise ValueError("road line must contain at least two coordinates")
    converted: list[tuple[float, float]] = []
    for coordinate in coordinates:
        if not isinstance(coordinate, Sequence) or len(coordinate) != 2:
            raise ValueError("road coordinate is invalid")
        x, y = coordinate
        if isinstance(x, bool) or isinstance(y, bool):
            raise ValueError("road coordinate is invalid")
        converted.append(
            _local_to_wgs84(float(x), float(y), zoom, tile_x, tile_y, extent)
        )
    return converted
