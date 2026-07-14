from __future__ import annotations

import math
import struct
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO

_HEADER = struct.Struct("<dddffddddddd")
_UINT32 = struct.Struct("<I")
_INDEX_CHUNK_COUNT = 12_288
_MAX_VERTICES = 20_000_000


def _read_exact(stream: BinaryIO, size: int, *, label: str) -> bytes:
    payload = stream.read(size)
    if len(payload) != size:
        raise ValueError(f"truncated {label}")
    return payload


def _read_uint32(stream: BinaryIO, *, label: str) -> int:
    return int(_UINT32.unpack(_read_exact(stream, _UINT32.size, label=label))[0])


def _skip_exact(stream: BinaryIO, size: int, file_size: int, *, label: str) -> None:
    if size < 0 or stream.tell() + size > file_size:
        raise ValueError(f"truncated {label}")
    stream.seek(size, 1)


def _iter_indices(
    stream: BinaryIO, count: int, index_size: int, *, label: str
) -> Iterator[int]:
    format_code = "H" if index_size == 2 else "I"
    remaining = count
    while remaining:
        chunk_count = min(remaining, _INDEX_CHUNK_COUNT)
        payload = _read_exact(
            stream, chunk_count * index_size, label=label
        )
        yield from (value[0] for value in struct.iter_unpack(f"<{format_code}", payload))
        remaining -= chunk_count


def _validate_triangle_indices(
    stream: BinaryIO, triangle_count: int, vertex_count: int, index_size: int
) -> None:
    highest = 0
    triangle: list[int] = []
    for encoded in _iter_indices(
        stream, triangle_count * 3, index_size, label="triangle indices"
    ):
        if encoded > highest:
            raise ValueError("invalid high-water-mark triangle index")
        index = highest - encoded
        if encoded == 0:
            highest += 1
        if index >= vertex_count or highest > vertex_count:
            raise ValueError("triangle index is outside the vertex array")
        triangle.append(index)
        if len(triangle) == 3:
            if len(set(triangle)) != 3:
                raise ValueError("degenerate triangle")
            triangle.clear()


def _validate_vertex_array(stream: BinaryIO, vertex_count: int, *, label: str) -> None:
    value = 0
    for encoded in _iter_indices(stream, vertex_count, 2, label=label):
        delta = (encoded >> 1) ^ -(encoded & 1)
        value += delta
        if not 0 <= value <= 32_767:
            raise ValueError(f"{label} contains an out-of-range delta")


def _validate_edge_indices(
    stream: BinaryIO, edge_count: int, vertex_count: int, index_size: int
) -> None:
    if edge_count > vertex_count:
        raise ValueError("edge list is larger than the vertex array")
    for index in _iter_indices(stream, edge_count, index_size, label="edge indices"):
        if index >= vertex_count:
            raise ValueError("edge index is outside the vertex array")


def validate_quantized_mesh(path: Path) -> None:
    """Stream and semantically validate one Quantized Mesh 1.0 tile."""

    file_size = path.stat().st_size
    with path.open("rb") as stream:
        header = _HEADER.unpack(_read_exact(stream, _HEADER.size, label="header"))
        if not all(math.isfinite(value) for value in header):
            raise ValueError("non-finite header value")
        if header[3] > header[4]:
            raise ValueError("minimum height exceeds maximum height")
        if header[8] <= 0:
            raise ValueError("bounding sphere radius must be positive")

        vertex_count = _read_uint32(stream, label="vertex count")
        if not 3 <= vertex_count <= _MAX_VERTICES:
            raise ValueError("invalid vertex count")
        if stream.tell() + vertex_count * 3 * 2 > file_size:
            raise ValueError("truncated vertices")
        _validate_vertex_array(stream, vertex_count, label="u vertices")
        _validate_vertex_array(stream, vertex_count, label="v vertices")
        _validate_vertex_array(stream, vertex_count, label="height vertices")

        triangle_count = _read_uint32(stream, label="triangle count")
        if not 1 <= triangle_count <= vertex_count * 2:
            raise ValueError("invalid triangle count")
        index_size = 2 if vertex_count <= 65_536 else 4
        _validate_triangle_indices(stream, triangle_count, vertex_count, index_size)

        for _ in range(4):
            edge_count = _read_uint32(stream, label="edge count")
            _validate_edge_indices(stream, edge_count, vertex_count, index_size)

        while stream.tell() < file_size:
            _read_exact(stream, 1, label="extension id")
            extension_length = _read_uint32(stream, label="extension length")
            _skip_exact(stream, extension_length, file_size, label="extension payload")
        if stream.tell() != file_size:
            raise ValueError("invalid trailing data")
