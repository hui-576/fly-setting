from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

from fly_setting_api.app import create_app
from fly_setting_api.settings import ApiSettings

from .conftest import create_data_package


def _document(source: Path) -> dict[str, Any]:
    return json.loads((source / "manifest.json").read_text(encoding="utf-8"))


def _write_document(source: Path, document: dict[str, Any]) -> None:
    (source / "manifest.json").write_text(
        json.dumps(document, ensure_ascii=False), encoding="utf-8"
    )


def _refresh_checksum(source: Path, relative: str) -> None:
    document = _document(source)
    digest = hashlib.sha256((source / relative).read_bytes()).hexdigest()
    next(entry for entry in document["files"] if entry["path"] == relative)["sha256"] = digest
    _write_document(source, document)


def _install(tmp_path: Path, source: Path) -> tuple[TestClient, Any]:
    client = TestClient(create_app(ApiSettings(data_package_root=tmp_path / "store")))
    response = client.post(
        "/api/v1/data-packages/install", json={"sourceDirectory": str(source)}
    )
    return client, response


def _assert_clean_failure(tmp_path: Path, response: Any, code: str) -> None:
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code
    assert not (tmp_path / "store" / "packages" / "hubei-demo").exists()
    assert list((tmp_path / "store" / ".staging").iterdir()) == []


def test_strict_manifest_rejects_unknown_fields_without_partial_install(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _document(source)
    document["unreviewedField"] = True
    _write_document(source, document)

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "MANIFEST_INVALID")


def test_sha256_mismatch_rejects_package_without_partial_install(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    (source / "imagery" / "0" / "0" / "0.png").write_bytes(b"corrupted")

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "CHECKSUM_MISMATCH")


def test_manifest_crs_must_match_dtm_metadata(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _document(source)
    document["crs"] = "EPSG:32649"
    _write_document(source, document)

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "CRS_MISMATCH")


def test_manifest_extent_must_match_dtm_bounds(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _document(source)
    document["extent"][2] += 10
    _write_document(source, document)

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "EXTENT_MISMATCH")


def test_manifest_pixel_size_must_match_dtm_metadata(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _document(source)
    document["pixelSize"] = [20, 20]
    _write_document(source, document)

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "PIXEL_SIZE_MISMATCH")


def test_manifest_nodata_must_match_dtm_metadata(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _document(source)
    document["noData"] = -32768
    _write_document(source, document)

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "NODATA_MISMATCH")


def test_raster_vertical_unit_must_be_metres(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    with rasterio.open(source / "elevation" / "dtm.tif", "r+") as dataset:
        dataset.update_tags(VERTICAL_UNIT="ft")
    _refresh_checksum(source, "elevation/dtm.tif")

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "VERTICAL_UNIT_MISMATCH")


def test_dtm_and_dsm_must_use_the_same_grid(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    dsm_path = source / "elevation" / "dsm.tif"
    with rasterio.open(dsm_path) as dataset:
        profile = dataset.profile
        values = dataset.read()
        tags = dataset.tags()
    profile["transform"] = from_origin(12_000_010.0, 3_401_000.0, 10.0, 10.0)
    with rasterio.open(dsm_path, "w", **profile) as dataset:
        dataset.write(values)
        dataset.update_tags(**tags)
    _refresh_checksum(source, "elevation/dsm.tif")

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "EXTENT_MISMATCH")


def test_license_notice_is_required(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _document(source)
    document["license"]["notice"] = ""
    _write_document(source, document)

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "MANIFEST_INVALID")


def test_license_must_explicitly_allow_offline_use(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _document(source)
    document["license"]["offlineUseApproved"] = False
    _write_document(source, document)

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "LICENSE_NOT_APPROVED")


def test_unknown_license_identifier_is_rejected(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _document(source)
    document["license"]["spdxId"] = "unknown"
    _write_document(source, document)

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "LICENSE_ID_INVALID")


def test_roads_must_be_rfc7946_wgs84_in_hubei(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    roads_path = source / "roads" / "roads.geojson"
    document = json.loads(roads_path.read_text(encoding="utf-8"))
    document["features"][0]["geometry"]["coordinates"] = [
        [12_000_100, 3_400_100],
        [12_000_900, 3_400_900],
    ]
    roads_path.write_text(json.dumps(document), encoding="utf-8")
    _refresh_checksum(source, "roads/roads.geojson")

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "ROADS_INVALID")


def test_roads_must_align_with_elevation_coverage(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    roads_path = source / "roads" / "roads.geojson"
    document = json.loads(roads_path.read_text(encoding="utf-8"))
    document["features"][0]["geometry"]["coordinates"] = [
        [115.0, 31.0],
        [115.01, 31.01],
    ]
    roads_path.write_text(json.dumps(document), encoding="utf-8")
    _refresh_checksum(source, "roads/roads.geojson")

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "ROADS_OUTSIDE_ELEVATION_EXTENT")


def test_all_nodata_elevation_is_rejected(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    dtm_path = source / "elevation" / "dtm.tif"
    with rasterio.open(dtm_path, "r+") as dataset:
        dataset.write(np.full((1, dataset.height, dataset.width), -9999.0, dtype=np.float32))
    _refresh_checksum(source, "elevation/dtm.tif")

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "ELEVATION_HAS_NO_VALID_DATA")


def test_quantized_mesh_template_cannot_reference_the_network(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    layer_path = source / "terrain" / "layer.json"
    document = json.loads(layer_path.read_text(encoding="utf-8"))
    document["tiles"] = ["https://example.invalid/{z}/{x}/{y}.terrain"]
    layer_path.write_text(json.dumps(document), encoding="utf-8")
    _refresh_checksum(source, "terrain/layer.json")

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "TERRAIN_INVALID")


def test_quantized_mesh_bounds_must_match_package_extent(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    layer_path = source / "terrain" / "layer.json"
    document = json.loads(layer_path.read_text(encoding="utf-8"))
    document["bounds"] = [110.0, 30.0, 111.0, 31.0]
    layer_path.write_text(json.dumps(document), encoding="utf-8")
    _refresh_checksum(source, "terrain/layer.json")

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "TERRAIN_BOUNDS_MISMATCH")


def test_corrupt_quantized_mesh_with_matching_checksum_is_rejected(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    terrain_path = source / "terrain" / "0" / "0" / "0.terrain"
    terrain_path.write_bytes(b"not-a-quantized-mesh")
    _refresh_checksum(source, "terrain/0/0/0.terrain")

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "TERRAIN_TILE_INVALID")


def test_corrupt_xyz_with_matching_checksum_is_rejected(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    image_path = source / "imagery" / "0" / "0" / "0.png"
    image_path.write_bytes(b"not-an-image")
    _refresh_checksum(source, "imagery/0/0/0.png")

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "BASEMAP_TILE_INVALID")


def test_corrupt_road_vector_tile_with_matching_checksum_is_rejected(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    tile_path = source / "roads" / "tiles" / "8" / "207" / "104.mvt"
    tile_path.write_bytes(b"not-an-mvt")
    _refresh_checksum(source, "roads/tiles/8/207/104.mvt")

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "ROAD_TILE_INVALID")


def test_manifest_paths_cannot_escape_package_root(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _document(source)
    document["files"][0]["path"] = "../outside.tif"
    _write_document(source, document)

    _, response = _install(tmp_path, source)

    _assert_clean_failure(tmp_path, response, "MANIFEST_PATH_INVALID")
