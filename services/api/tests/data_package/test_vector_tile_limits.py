from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from pathlib import Path
from typing import cast

import pytest
from mapbox_vector_tile import encode as encode_vector_tile
from shapely.geometry import LineString

from fly_setting_api.data_packages import content_validation, road_source_validation
from fly_setting_api.data_packages.errors import DataPackageError
from fly_setting_api.data_packages.mvt_budget_validation import (
    RoadGeometryBudget,
    RoadGeometryLimits,
    inspect_vector_tile,
)
from fly_setting_api.data_packages.road_source_validation import RoadSourceMatcher
from fly_setting_api.data_packages.validation import validate_package

from .conftest import _web_mercator_tile_bounds, create_data_package


def _line_feature(name: str, coordinates: list[list[float]]) -> dict[str, object]:
    return {
        "geometry": {"type": "LineString", "coordinates": coordinates},
        "properties": {"name": name},
    }


def _road_tile(features: list[dict[str, object]]) -> bytes:
    return cast(
        bytes,
        encode_vector_tile(
            {"name": "roads", "features": features},
            default_options={"quantize_bounds": _web_mercator_tile_bounds(8, 207, 104)},
        ),
    )


def _replace_road_tile(source: Path, payload: bytes) -> None:
    relative = "roads/tiles/8/207/104.mvt"
    path = source / relative
    path.write_bytes(payload)
    manifest_path = source / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    next(entry for entry in manifest["files"] if entry["path"] == relative)[
        "sha256"
    ] = hashlib.sha256(payload).hexdigest()
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")


def test_mvt_preflight_rejects_single_tile_feature_explosion() -> None:
    payload = _road_tile(
        [
            _line_feature("first", [[112.297, 30.899], [112.302, 30.903]]),
            _line_feature("second", [[112.298, 30.899], [112.303, 30.903]]),
        ]
    )
    budget = RoadGeometryBudget(
        RoadGeometryLimits(
            max_features_per_tile=1,
            max_coordinates_per_tile=100,
            max_features_per_package=100,
            max_coordinates_per_package=1_000,
        )
    )

    with pytest.raises(DataPackageError) as captured:
        inspect_vector_tile(payload, budget)

    assert captured.value.code == "ROAD_TILE_FEATURE_LIMIT_EXCEEDED"


def test_mvt_preflight_rejects_single_tile_coordinate_explosion() -> None:
    payload = _road_tile(
        [_line_feature("road", [[112.297, 30.899], [112.302, 30.903]])]
    )
    budget = RoadGeometryBudget(
        RoadGeometryLimits(
            max_features_per_tile=10,
            max_coordinates_per_tile=1,
            max_features_per_package=100,
            max_coordinates_per_package=1_000,
        )
    )

    with pytest.raises(DataPackageError) as captured:
        inspect_vector_tile(payload, budget)

    assert captured.value.code == "ROAD_TILE_COORDINATE_LIMIT_EXCEEDED"


def test_mvt_preflight_enforces_whole_package_feature_and_coordinate_budgets() -> None:
    payload = _road_tile(
        [_line_feature("road", [[112.297, 30.899], [112.302, 30.903]])]
    )
    feature_budget = RoadGeometryBudget(
        RoadGeometryLimits(
            max_features_per_tile=10,
            max_coordinates_per_tile=10,
            max_features_per_package=1,
            max_coordinates_per_package=100,
        )
    )
    coordinate_budget = RoadGeometryBudget(
        RoadGeometryLimits(
            max_features_per_tile=10,
            max_coordinates_per_tile=10,
            max_features_per_package=100,
            max_coordinates_per_package=3,
        )
    )

    inspect_vector_tile(payload, feature_budget)
    inspect_vector_tile(payload, coordinate_budget)
    with pytest.raises(DataPackageError) as feature_error:
        inspect_vector_tile(payload, feature_budget)
    with pytest.raises(DataPackageError) as coordinate_error:
        inspect_vector_tile(payload, coordinate_budget)

    assert feature_error.value.code == "ROAD_PACKAGE_FEATURE_LIMIT_EXCEEDED"
    assert coordinate_error.value.code == "ROAD_PACKAGE_COORDINATE_LIMIT_EXCEEDED"


def test_package_rejects_feature_explosion_before_full_mvt_decode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = create_data_package(tmp_path)
    explosive_payload = _road_tile(
        [
            _line_feature("first", [[112.297, 30.899], [112.302, 30.903]]),
            _line_feature("second", [[112.298, 30.899], [112.303, 30.903]]),
        ]
    )
    _replace_road_tile(
        source,
        explosive_payload,
    )
    monkeypatch.setattr(
        content_validation,
        "_ROAD_GEOMETRY_LIMITS",
        RoadGeometryLimits(
            max_features_per_tile=1,
            max_coordinates_per_tile=100,
            max_features_per_package=100,
            max_coordinates_per_package=1_000,
        ),
        raising=False,
    )

    real_decode = cast(
        Callable[[bytes], object], content_validation.__dict__["decode_vector_tile"]
    )

    def guarded_decode(payload: bytes) -> object:
        if payload == explosive_payload:
            raise AssertionError("full MVT decoder ran before the feature budget check")
        return real_decode(payload)

    monkeypatch.setattr(content_validation, "decode_vector_tile", guarded_decode)

    with pytest.raises(DataPackageError) as captured:
        validate_package(source)

    assert captured.value.code == "ROAD_TILE_FEATURE_LIMIT_EXCEEDED"


def test_incremental_road_matcher_preserves_authoritative_source_coverage() -> None:
    source_document = {
        "type": "FeatureCollection",
        "features": [
            _line_feature("first", [[112.297, 30.899], [112.302, 30.903]]),
            _line_feature("second", [[112.31, 30.91], [112.315, 30.915]]),
        ],
    }
    matcher = RoadSourceMatcher.from_document(source_document)
    matcher.match_tile(
        [LineString([[112.297, 30.899], [112.302, 30.903]])],
        tolerance_degrees=0.0001,
    )

    with pytest.raises(DataPackageError) as captured:
        matcher.finish()

    assert captured.value.code == "ROAD_TILE_SOURCE_MISMATCH"


def test_authoritative_source_coordinate_budget_runs_before_shapely_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_document = {
        "type": "FeatureCollection",
        "features": [
            _line_feature("road", [[112.297, 30.899], [112.302, 30.903]])
        ],
    }

    def unexpected_shape(_: object) -> object:
        raise AssertionError("Shapely geometry was allocated before the source budget check")

    monkeypatch.setattr(road_source_validation, "shape", unexpected_shape)

    with pytest.raises(DataPackageError) as captured:
        RoadSourceMatcher.from_document(
            source_document,
            RoadGeometryLimits(
                max_features_per_tile=10,
                max_coordinates_per_tile=10,
                max_features_per_package=10,
                max_coordinates_per_package=1,
            ),
        )

    assert captured.value.code == "ROAD_PACKAGE_COORDINATE_LIMIT_EXCEEDED"
