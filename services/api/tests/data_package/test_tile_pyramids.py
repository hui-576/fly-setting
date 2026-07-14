from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from mapbox_vector_tile import encode as encode_vector_tile

from fly_setting_api.app import create_app
from fly_setting_api.settings import ApiSettings

from .conftest import _web_mercator_tile_bounds, create_data_package


def _document(source: Path) -> dict[str, Any]:
    return json.loads((source / "manifest.json").read_text(encoding="utf-8"))


def _write_document(source: Path, document: dict[str, Any]) -> None:
    (source / "manifest.json").write_text(
        json.dumps(document, ensure_ascii=False), encoding="utf-8"
    )


def _refresh_checksum(source: Path, relative: str) -> None:
    document = _document(source)
    digest = hashlib.sha256((source / relative).read_bytes()).hexdigest()
    next(entry for entry in document["files"] if entry["path"] == relative)[
        "sha256"
    ] = digest
    _write_document(source, document)


def _remove_file(source: Path, relative: str) -> None:
    (source / relative).unlink()
    document = _document(source)
    document["files"] = [
        entry for entry in document["files"] if entry["path"] != relative
    ]
    _write_document(source, document)


def _install(tmp_path: Path, source: Path) -> Any:
    client = TestClient(create_app(ApiSettings(data_package_root=tmp_path / "store")))
    return client.post(
        "/api/v1/data-packages/install", json={"sourceDirectory": str(source)}
    )


def _assert_rejected(tmp_path: Path, response: Any, code: str) -> None:
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code
    assert not (tmp_path / "store" / "packages" / "hubei-demo").exists()


def test_xyz_pyramid_must_cover_declared_bounds_at_every_level(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _document(source)
    document["assets"]["basemapMaximumLevel"] = 1
    _write_document(source, document)

    response = _install(tmp_path, source)

    _assert_rejected(tmp_path, response, "BASEMAP_PYRAMID_INCOMPLETE")


def test_road_tile_pyramid_must_cover_declared_bounds(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    _remove_file(source, "roads/tiles/8/207/104.mvt")

    response = _install(tmp_path, source)

    _assert_rejected(tmp_path, response, "ROAD_TILE_PYRAMID_INCOMPLETE")


def test_rendered_road_tiles_must_match_authoritative_geojson(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    relative = "roads/tiles/8/207/104.mvt"
    (source / relative).write_bytes(
        encode_vector_tile(
            {
                "name": "roads",
                "features": [
                    {
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[111.2, 31.2], [111.3, 31.3]],
                        },
                        "properties": {"name": "unrelated road"},
                    }
                ],
            },
            default_options={
                "quantize_bounds": _web_mercator_tile_bounds(8, 207, 104)
            },
        )
    )
    _refresh_checksum(source, relative)

    response = _install(tmp_path, source)

    _assert_rejected(tmp_path, response, "ROAD_TILE_SOURCE_MISMATCH")


def test_terrain_tile_path_must_be_strict_tms_coordinates(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    old_relative = "terrain/0/0/0.terrain"
    new_relative = "terrain/0/0/1.terrain"
    target = source / new_relative
    target.parent.mkdir(parents=True, exist_ok=True)
    (source / old_relative).replace(target)
    document = _document(source)
    entry = next(item for item in document["files"] if item["path"] == old_relative)
    entry["path"] = new_relative
    _write_document(source, document)

    response = _install(tmp_path, source)

    _assert_rejected(tmp_path, response, "TERRAIN_TILE_INVALID")


def test_terrain_availability_must_exactly_match_inventory(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    layer = source / "terrain" / "layer.json"
    document = json.loads(layer.read_text(encoding="utf-8"))
    document["available"] = [[]]
    layer.write_text(json.dumps(document), encoding="utf-8")
    _refresh_checksum(source, "terrain/layer.json")

    response = _install(tmp_path, source)

    _assert_rejected(tmp_path, response, "TERRAIN_AVAILABILITY_MISMATCH")


def test_terrain_pyramid_must_cover_declared_bounds_in_tms_coordinates(
    tmp_path: Path,
) -> None:
    source = create_data_package(tmp_path / "incoming")
    old_relative = "terrain/0/0/0.terrain"
    new_relative = "terrain/8/0/0.terrain"
    target = source / new_relative
    target.parent.mkdir(parents=True, exist_ok=True)
    (source / old_relative).replace(target)
    layer = source / "terrain" / "layer.json"
    layer_document = json.loads(layer.read_text(encoding="utf-8"))
    layer_document["minzoom"] = 8
    layer_document["maxzoom"] = 8
    layer_document["available"] = [
        *([[]] * 8),
        [{"startX": 0, "startY": 0, "endX": 0, "endY": 0}],
    ]
    layer.write_text(json.dumps(layer_document), encoding="utf-8")
    document = _document(source)
    entry = next(item for item in document["files"] if item["path"] == old_relative)
    entry["path"] = new_relative
    entry["sha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
    next(item for item in document["files"] if item["path"] == "terrain/layer.json")[
        "sha256"
    ] = hashlib.sha256(layer.read_bytes()).hexdigest()
    _write_document(source, document)

    response = _install(tmp_path, source)

    _assert_rejected(tmp_path, response, "TERRAIN_PYRAMID_INCOMPLETE")


def test_quantized_mesh_rejects_out_of_range_vertex_delta(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    relative = "terrain/0/0/0.terrain"
    path = source / relative
    payload = bytearray(path.read_bytes())
    struct.pack_into("<H", payload, 92, 0xFFFF)
    path.write_bytes(payload)
    _refresh_checksum(source, relative)

    response = _install(tmp_path, source)

    _assert_rejected(tmp_path, response, "TERRAIN_TILE_INVALID")


def test_quantized_mesh_rejects_invalid_high_water_mark_index(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    relative = "terrain/0/0/0.terrain"
    path = source / relative
    payload = bytearray(path.read_bytes())
    struct.pack_into("<H", payload, 120, 1)
    path.write_bytes(payload)
    _refresh_checksum(source, relative)

    response = _install(tmp_path, source)

    _assert_rejected(tmp_path, response, "TERRAIN_TILE_INVALID")


def test_quantized_mesh_rejects_zero_triangle_count(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    relative = "terrain/0/0/0.terrain"
    path = source / relative
    payload = bytearray(path.read_bytes())
    struct.pack_into("<I", payload, 116, 0)
    path.write_bytes(payload)
    _refresh_checksum(source, relative)

    response = _install(tmp_path, source)

    _assert_rejected(tmp_path, response, "TERRAIN_TILE_INVALID")


def test_quantized_mesh_rejects_out_of_range_edge_index(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    relative = "terrain/0/0/0.terrain"
    path = source / relative
    payload = bytearray(path.read_bytes())
    struct.pack_into("<H", payload, 136, 999)
    path.write_bytes(payload)
    _refresh_checksum(source, relative)

    response = _install(tmp_path, source)

    _assert_rejected(tmp_path, response, "TERRAIN_TILE_INVALID")


def test_quantized_mesh_rejects_non_positive_bounding_sphere(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    relative = "terrain/0/0/0.terrain"
    path = source / relative
    payload = bytearray(path.read_bytes())
    struct.pack_into("<d", payload, 56, 0.0)
    path.write_bytes(payload)
    _refresh_checksum(source, relative)

    response = _install(tmp_path, source)

    _assert_rejected(tmp_path, response, "TERRAIN_TILE_INVALID")
