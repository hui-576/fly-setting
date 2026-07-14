from __future__ import annotations

from dataclasses import dataclass

from fly_setting_api.data_packages.errors import DataPackageError


@dataclass(frozen=True, slots=True)
class RoadGeometryLimits:
    """Bound decoded MVT objects per tile and across one package."""

    max_features_per_tile: int = 5_000
    max_coordinates_per_tile: int = 50_000
    max_features_per_package: int = 500_000
    max_coordinates_per_package: int = 10_000_000
    max_metadata_entries_per_tile: int = 250_000


@dataclass(frozen=True, slots=True)
class RoadTileStats:
    features: int = 0
    coordinates: int = 0
    metadata_entries: int = 0

    def __add__(self, other: RoadTileStats) -> RoadTileStats:
        return RoadTileStats(
            self.features + other.features,
            self.coordinates + other.coordinates,
            self.metadata_entries + other.metadata_entries,
        )


@dataclass(slots=True)
class RoadGeometryBudget:
    limits: RoadGeometryLimits
    features: int = 0
    coordinates: int = 0

    def consume(self, stats: RoadTileStats) -> None:
        checks = (
            (stats.features, self.limits.max_features_per_tile, "ROAD_TILE_FEATURE_LIMIT_EXCEEDED"),
            (
                stats.coordinates,
                self.limits.max_coordinates_per_tile,
                "ROAD_TILE_COORDINATE_LIMIT_EXCEEDED",
            ),
            (
                stats.metadata_entries,
                self.limits.max_metadata_entries_per_tile,
                "ROAD_TILE_METADATA_LIMIT_EXCEEDED",
            ),
        )
        for value, maximum, code in checks:
            if value > maximum:
                raise DataPackageError(code, "Road vector tile exceeds its geometry budget")
        if self.features + stats.features > self.limits.max_features_per_package:
            raise DataPackageError(
                "ROAD_PACKAGE_FEATURE_LIMIT_EXCEEDED",
                "Road vector tiles exceed the package feature budget",
            )
        if self.coordinates + stats.coordinates > self.limits.max_coordinates_per_package:
            raise DataPackageError(
                "ROAD_PACKAGE_COORDINATE_LIMIT_EXCEEDED",
                "Road vector tiles exceed the package coordinate budget",
            )
        self.features += stats.features
        self.coordinates += stats.coordinates


def _read_varint(payload: memoryview, offset: int, end: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while offset < end and shift < 70:
        byte = payload[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, offset
        shift += 7
    raise ValueError("invalid protobuf varint")


def _length_delimited(payload: memoryview, offset: int, end: int) -> tuple[int, int, int]:
    length, start = _read_varint(payload, offset, end)
    item_end = start + length
    if item_end > end:
        raise ValueError("truncated protobuf field")
    return start, item_end, item_end


def _skip_field(payload: memoryview, offset: int, end: int, wire_type: int) -> int:
    if wire_type == 0:
        return _read_varint(payload, offset, end)[1]
    if wire_type == 1:
        next_offset = offset + 8
    elif wire_type == 2:
        return _length_delimited(payload, offset, end)[2]
    elif wire_type == 5:
        next_offset = offset + 4
    else:
        raise ValueError("unsupported protobuf wire type")
    if next_offset > end:
        raise ValueError("truncated protobuf field")
    return next_offset


def _geometry_coordinate_count(payload: memoryview, start: int, end: int) -> int:
    coordinates = 0
    offset = start
    while offset < end:
        command, offset = _read_varint(payload, offset, end)
        command_id = command & 0x7
        count = command >> 3
        if count < 1 or command_id not in {1, 2, 7}:
            raise ValueError("invalid MVT geometry command")
        if command_id == 7:
            continue
        coordinates += count
        for _ in range(count * 2):
            _, offset = _read_varint(payload, offset, end)
    return coordinates


def _inspect_feature(payload: memoryview, start: int, end: int) -> RoadTileStats:
    offset = start
    coordinates = 0
    metadata_entries = 0
    while offset < end:
        key, offset = _read_varint(payload, offset, end)
        field, wire_type = key >> 3, key & 0x7
        if field in {2, 4} and wire_type == 2:
            item_start, item_end, offset = _length_delimited(payload, offset, end)
            if field == 4:
                coordinates += _geometry_coordinate_count(payload, item_start, item_end)
            else:
                cursor = item_start
                while cursor < item_end:
                    _, cursor = _read_varint(payload, cursor, item_end)
                    metadata_entries += 1
        else:
            offset = _skip_field(payload, offset, end, wire_type)
    return RoadTileStats(1, coordinates, metadata_entries)


def _inspect_layer(payload: memoryview, start: int, end: int) -> RoadTileStats:
    offset = start
    stats = RoadTileStats()
    while offset < end:
        key, offset = _read_varint(payload, offset, end)
        field, wire_type = key >> 3, key & 0x7
        if field == 2 and wire_type == 2:
            item_start, item_end, offset = _length_delimited(payload, offset, end)
            stats += _inspect_feature(payload, item_start, item_end)
        elif field in {3, 4} and wire_type == 2:
            _, _, offset = _length_delimited(payload, offset, end)
            stats += RoadTileStats(metadata_entries=1)
        else:
            offset = _skip_field(payload, offset, end, wire_type)
    return stats


def inspect_vector_tile(payload: bytes, budget: RoadGeometryBudget) -> RoadTileStats:
    """Preflight protobuf counts before allocating the decoded MVT object graph."""

    view = memoryview(payload)
    offset = 0
    stats = RoadTileStats()
    try:
        while offset < len(view):
            key, offset = _read_varint(view, offset, len(view))
            field, wire_type = key >> 3, key & 0x7
            if field == 3 and wire_type == 2:
                start, end, offset = _length_delimited(view, offset, len(view))
                stats += _inspect_layer(view, start, end)
            else:
                offset = _skip_field(view, offset, len(view), wire_type)
    except ValueError as error:
        raise DataPackageError(
            "ROAD_TILE_INVALID", "Road vector tile protobuf is invalid"
        ) from error
    budget.consume(stats)
    return stats
