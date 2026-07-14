from pathlib import Path

from fastapi.testclient import TestClient

from fly_setting_api.app import create_app
from fly_setting_api.settings import ApiSettings

from .conftest import create_data_package


def _active_client(tmp_path: Path) -> TestClient:
    source = create_data_package(tmp_path / "incoming")
    client = TestClient(create_app(ApiSettings(data_package_root=tmp_path / "store")))
    client.post("/api/v1/data-packages/install", json={"sourceDirectory": str(source)})
    client.put(
        "/api/v1/data-packages/active",
        json={"packageId": "hubei-demo", "version": "2026.07.0"},
    )
    return client


def test_active_package_serves_same_origin_map_resources(tmp_path: Path) -> None:
    client = _active_client(tmp_path)
    prefix = "/api/v1/map/packages/hubei-demo/2026.07.0"

    basemap = client.get(f"{prefix}/xyz/0/0/0.png")
    terrain_metadata = client.get(f"{prefix}/terrain/layer.json")
    terrain_tile = client.get(f"{prefix}/terrain/0/0/0.terrain")
    roads = client.get(f"{prefix}/roads/8/207/104.mvt")

    assert basemap.status_code == 200
    assert basemap.content.startswith(b"\x89PNG\r\n\x1a\n")
    assert terrain_metadata.json()["format"] == "quantized-mesh-1.0"
    assert len(terrain_tile.content) > 100
    assert len(roads.content) > 10
    assert basemap.headers["content-type"].startswith("image/png")
    assert terrain_metadata.headers["content-type"].startswith("application/json")
    assert terrain_tile.headers["content-type"].startswith(
        "application/vnd.quantized-mesh"
    )
    assert roads.headers["content-type"].startswith("application/vnd.mapbox-vector-tile")
    for response in (basemap, terrain_metadata, terrain_tile, roads):
        assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_map_resource_paths_cannot_traverse_outside_active_package(tmp_path: Path) -> None:
    client = _active_client(tmp_path)

    response = client.get(
        "/api/v1/map/packages/hubei-demo/2026.07.0/terrain/%2e%2e/%2e%2e/active.json"
    )

    assert response.status_code in {404, 422}
    assert "hubei-demo" not in response.text
