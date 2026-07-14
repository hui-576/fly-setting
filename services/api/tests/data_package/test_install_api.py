from pathlib import Path

from fastapi.testclient import TestClient

from fly_setting_api.app import create_app
from fly_setting_api.settings import ApiSettings

from .conftest import create_data_package


def test_install_valid_package_and_list_it(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    client = TestClient(create_app(ApiSettings(data_package_root=tmp_path / "store")))

    installed = client.post(
        "/api/v1/data-packages/install", json={"sourceDirectory": str(source)}
    )
    listed = client.get("/api/v1/data-packages")

    assert installed.status_code == 201
    assert installed.json()["data"] == {
        "id": "hubei-demo",
        "version": "2026.07.0",
        "displayName": "Synthetic Hubei data",
        "status": "installed",
        "active": False,
        "obscurationMode": None,
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
    }
    assert listed.status_code == 200
    assert listed.json()["data"] == [installed.json()["data"]]
    assert listed.json()["meta"] == {"page": 1, "limit": 20, "total": 1}
    assert (tmp_path / "store" / "packages" / "hubei-demo" / "2026.07.0").is_dir()
    assert list((tmp_path / "store" / ".staging").iterdir()) == []
