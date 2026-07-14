from pathlib import Path

from fastapi.testclient import TestClient

from fly_setting_api.app import create_app
from fly_setting_api.data_packages.gis_runtime import rasterio_environment
from fly_setting_api.data_packages.service import DataPackageService
from fly_setting_api.settings import ApiSettings

from .conftest import create_data_package


def test_activate_package_publishes_frontend_map_manifest(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    client = TestClient(create_app(ApiSettings(data_package_root=tmp_path / "store")))
    assert client.post(
        "/api/v1/data-packages/install", json={"sourceDirectory": str(source)}
    ).status_code == 201

    activated = client.put(
        "/api/v1/data-packages/active",
        json={
            "packageId": "hubei-demo",
            "version": "2026.07.0",
            "obscurationMode": "surface",
        },
    )
    manifest = client.get("/api/v1/map/manifest")

    assert activated.status_code == 200
    assert activated.json()["data"]["active"] is True
    assert manifest.status_code == 200
    assert manifest.json() == {
        "status": "ready",
        "package": {
            "id": "hubei-demo",
            "version": "2026.07.0",
            "obscurationMode": "surface",
            "supportedObscurationModes": ["bare-earth", "surface"],
            "dtm": {
                "available": True,
                "resolutionMeters": 10.0,
                "accuracyHint": "Synthetic fixture; not for operational use",
            },
            "dsm": {
                "available": True,
                "resolutionMeters": 10.0,
                "accuracyHint": "Synthetic fixture; not for operational use",
            },
        },
        "layers": {
            "basemap": {
                "type": "xyz",
                "urlTemplate": (
                    "/api/v1/map/packages/hubei-demo/2026.07.0/xyz/{z}/{x}/{y}.png"
                ),
                "minimumLevel": 0,
                "maximumLevel": 0,
            },
            "terrain": {
                "type": "quantized-mesh",
                "url": "/api/v1/map/packages/hubei-demo/2026.07.0/terrain/",
            },
            "roads": {
                "type": "mvt",
                "urlTemplate": (
                    "/api/v1/map/packages/hubei-demo/2026.07.0/roads/{z}/{x}/{y}.mvt"
                ),
                "layer": "roads",
                "minimumLevel": 8,
                "maximumLevel": 8,
            },
        },
        "errors": [],
    }


def test_surface_mode_is_blocked_when_package_has_no_dsm(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming", include_dsm=False)
    client = TestClient(create_app(ApiSettings(data_package_root=tmp_path / "store")))
    installed = client.post(
        "/api/v1/data-packages/install", json={"sourceDirectory": str(source)}
    )

    activated = client.put(
        "/api/v1/data-packages/active",
        json={
            "packageId": "hubei-demo",
            "version": "2026.07.0",
            "obscurationMode": "surface",
        },
    )

    assert installed.status_code == 201
    assert installed.json()["data"]["dsm"] == {
        "available": False,
        "resolutionMeters": None,
        "accuracyHint": None,
    }
    assert installed.json()["data"]["supportedObscurationModes"] == ["bare-earth"]
    assert activated.status_code == 409
    assert activated.json()["error"] == {
        "code": "OBSCURATION_MODE_UNAVAILABLE",
        "message": "Surface mode requires a DSM, but this package only supports bare-earth mode",
        "details": {"supportedObscurationModes": ["bare-earth"]},
    }
    assert client.get("/api/v1/map/manifest").json()["status"] == "missing"


def test_backend_resolves_distinct_dtm_and_dsm_rasters(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    service = DataPackageService(tmp_path / "store")
    service.install(str(source))
    service.activate("hubei-demo", "2026.07.0", "surface")

    dtm_path = service.elevation_raster("bare-earth")
    dsm_path = service.elevation_raster("surface")

    with rasterio_environment():
        import rasterio

        with rasterio.open(dtm_path) as dtm, rasterio.open(dsm_path) as dsm:
            assert float(dtm.read(1)[0, 0]) == 100.0
            assert float(dsm.read(1)[0, 0]) == 105.0
            assert dtm_path != dsm_path


def test_switching_versions_publishes_distinct_immutable_resource_urls(tmp_path: Path) -> None:
    first = create_data_package(tmp_path / "incoming-a", version="2026.07.0")
    second = create_data_package(tmp_path / "incoming-b", version="2026.08.0")
    client = TestClient(create_app(ApiSettings(data_package_root=tmp_path / "store")))
    for source in (first, second):
        assert client.post(
            "/api/v1/data-packages/install", json={"sourceDirectory": str(source)}
        ).status_code == 201

    client.put(
        "/api/v1/data-packages/active",
        json={"packageId": "hubei-demo", "version": "2026.07.0"},
    )
    first_manifest = client.get("/api/v1/map/manifest")
    client.put(
        "/api/v1/data-packages/active",
        json={"packageId": "hubei-demo", "version": "2026.08.0"},
    )
    second_manifest = client.get("/api/v1/map/manifest")

    first_url = first_manifest.json()["layers"]["basemap"]["urlTemplate"]
    second_url = second_manifest.json()["layers"]["basemap"]["urlTemplate"]
    assert "/2026.07.0/" in first_url
    assert "/2026.08.0/" in second_url
    assert first_url != second_url
    assert first_manifest.headers["cache-control"] == "no-store"
    assert second_manifest.headers["cache-control"] == "no-store"
    assert client.get(first_url.format(z=0, x=0, y=0)).status_code == 200
    assert client.get(second_url.format(z=0, x=0, y=0)).status_code == 200
