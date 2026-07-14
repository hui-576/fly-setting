from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import numpy as np
import pytest

from fly_setting_api.data_packages import validation
from fly_setting_api.data_packages.errors import DataPackageError
from fly_setting_api.data_packages.models import DataPackageManifest
from fly_setting_api.data_packages.validation import validate_package

from .conftest import create_data_package, rasterio


def _refresh_checksum(source: Path, relative: str) -> None:
    manifest_path = source / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    digest = hashlib.sha256()
    with (source / relative).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    for entry in manifest["files"]:
        if entry["path"] == relative:
            entry["sha256"] = digest.hexdigest()
            break
    else:
        raise AssertionError(f"fixture manifest does not declare {relative}")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")


def _expand_file(source: Path, relative: str, size: int) -> None:
    with (source / relative).open("ab") as stream:
        stream.truncate(size)
    _refresh_checksum(source, relative)


def _assert_rejected(source: Path, code: str) -> None:
    with pytest.raises(DataPackageError) as captured:
        validate_package(source)
    assert captured.value.code == code


def _replace_dtm(source: Path, *, width: int, height: int, **options: object) -> None:
    path = source / "elevation" / "dtm.tif"
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=width,
        height=height,
        count=1,
        dtype="float32",
        crs="EPSG:3857",
        transform=rasterio.Affine(10, 0, 0, 0, -10, 0),
        nodata=-9999.0,
        SPARSE_OK="TRUE",
        **options,
    ) as dataset:
        dataset.update_tags(VERTICAL_UNIT="m")
    _refresh_checksum(source, "elevation/dtm.tif")


def test_quantized_mesh_larger_than_32_mib_is_rejected_before_decode(tmp_path: Path) -> None:
    source = create_data_package(tmp_path)
    _expand_file(source, "terrain/0/0/0.terrain", 32 * 1024 * 1024 + 1)

    _assert_rejected(source, "TERRAIN_TILE_TOO_LARGE")


def test_basemap_tile_larger_than_32_mib_is_rejected_before_pillow(tmp_path: Path) -> None:
    source = create_data_package(tmp_path)
    _expand_file(source, "imagery/0/0/0.png", 32 * 1024 * 1024 + 1)

    _assert_rejected(source, "BASEMAP_TILE_TOO_LARGE")


def test_terrain_metadata_larger_than_1_mib_is_rejected_before_json_parse(
    tmp_path: Path,
) -> None:
    source = create_data_package(tmp_path)
    _expand_file(source, "terrain/layer.json", 1024 * 1024 + 1)

    _assert_rejected(source, "TERRAIN_METADATA_TOO_LARGE")


def test_road_mvt_larger_than_16_mib_is_rejected_before_protobuf_decode(
    tmp_path: Path,
) -> None:
    source = create_data_package(tmp_path)
    relative = "roads/tiles/8/207/104.mvt"
    _expand_file(source, relative, 16 * 1024 * 1024 + 1)

    _assert_rejected(source, "ROAD_TILE_TOO_LARGE")


def test_road_geojson_larger_than_64_mib_is_rejected_before_json_parse(
    tmp_path: Path,
) -> None:
    source = create_data_package(tmp_path)
    _expand_file(source, "roads/roads.geojson", 64 * 1024 * 1024 + 1)

    _assert_rejected(source, "ROADS_TOO_LARGE")


@pytest.mark.parametrize(("width", "height"), [(262_145, 1), (1, 262_145)])
def test_raster_width_and_height_declarations_are_bounded(
    tmp_path: Path,
    width: int,
    height: int,
) -> None:
    source = create_data_package(tmp_path)
    _replace_dtm(source, width=width, height=height)

    _assert_rejected(source, "RASTER_DIMENSIONS_TOO_LARGE")


def test_raster_total_pixel_declaration_is_bounded(tmp_path: Path) -> None:
    source = create_data_package(tmp_path)
    _replace_dtm(
        source,
        width=100_000,
        height=50_000,
        tiled=True,
        blockxsize=256,
        blockysize=256,
        BIGTIFF="YES",
    )

    _assert_rejected(source, "RASTER_PIXEL_COUNT_TOO_LARGE")


def test_raster_block_pixel_declaration_is_bounded(tmp_path: Path) -> None:
    source = create_data_package(tmp_path)
    _replace_dtm(
        source,
        width=4_096,
        height=2_048,
        tiled=True,
        blockxsize=4_096,
        blockysize=2_048,
    )

    _assert_rejected(source, "RASTER_BLOCK_TOO_LARGE")


def test_complete_synthetic_package_remains_within_asset_limits(tmp_path: Path) -> None:
    source = create_data_package(tmp_path)

    manifest = validate_package(source)

    assert manifest.package_id == "hubei-demo"


def test_raster_validation_stops_after_first_block_with_valid_data(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = create_data_package(tmp_path)
    manifest = DataPackageManifest.model_validate(
        json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    )
    with rasterio.open(source / manifest.assets.dtm) as dataset:
        metadata: dict[str, Any] = {
            "crs": dataset.crs,
            "bounds": dataset.bounds,
            "res": dataset.res,
            "nodata": dataset.nodata,
            "count": dataset.count,
            "tags": dataset.tags(),
        }

    class FirstBlockIsValid:
        read_calls = 0

        def __enter__(self) -> FirstBlockIsValid:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def tags(self) -> dict[str, str]:
            return cast(dict[str, str], metadata["tags"])

        def block_windows(self, _: int) -> Iterator[tuple[int, str]]:
            return iter(((0, "first"), (1, "second")))

        def read(self, *_: object, **__: object) -> np.ma.MaskedArray:
            self.read_calls += 1
            if self.read_calls > 1:
                raise AssertionError("validation read beyond the first valid raster block")
            return np.ma.array([[100.0]], mask=[[False]])

        crs = metadata["crs"]
        bounds = metadata["bounds"]
        res = metadata["res"]
        nodata = metadata["nodata"]
        count = metadata["count"]

    fake = FirstBlockIsValid()
    monkeypatch.setattr(validation, "_open_raster", lambda *_: fake)

    validation._validate_raster(source, manifest, manifest.assets.dtm)

    assert fake.read_calls == 1
