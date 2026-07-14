from fastapi.testclient import TestClient

from fly_setting_api.app import create_app
from fly_setting_api.settings import ApiSettings


def test_startup_secret_is_accepted_exactly_once() -> None:
    client = TestClient(create_app(ApiSettings(startup_secret="one-time-secret")))

    response = client.post(
        "/api/v1/session",
        headers={"X-Startup-Secret": "one-time-secret"},
    )
    replay = client.post(
        "/api/v1/session",
        headers={"X-Startup-Secret": "one-time-secret"},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=strict" in response.headers["set-cookie"]
    assert replay.status_code == 401


def test_startup_secret_rejects_missing_or_incorrect_values() -> None:
    client = TestClient(create_app(ApiSettings(startup_secret="expected")))

    assert client.post("/api/v1/session").status_code == 401
    assert client.post(
        "/api/v1/session",
        headers={"X-Startup-Secret": "incorrect"},
    ).status_code == 401
