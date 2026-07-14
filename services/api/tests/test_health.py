from fastapi.testclient import TestClient

from fly_setting_api.app import create_app
from fly_setting_api.settings import ApiSettings


def test_health_returns_versioned_non_sensitive_status() -> None:
    client = TestClient(create_app(ApiSettings()))

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "apiVersion": "v1",
        "service": {"name": "fly-setting-api", "version": "0.1.0"},
        "status": "ok",
        "runtime": {"state": "ready"},
    }
    serialized = response.text.lower()
    assert "token" not in serialized
    assert "secret" not in serialized
    assert "password" not in serialized
    assert "environment" not in serialized


def test_health_is_declared_in_openapi() -> None:
    client = TestClient(create_app(ApiSettings()))

    document = client.get("/openapi.json").json()

    assert document["info"]["version"] == "0.1.0"
    assert list(document["paths"]) == ["/api/v1/health"]
    assert list(document["paths"]["/api/v1/health"]) == ["get"]

