from pathlib import Path

from fastapi.testclient import TestClient

from fly_setting_api.app import create_app
from fly_setting_api.settings import ApiSettings


def _create_web_root(root: Path) -> Path:
    (root / "assets").mkdir()
    (root / "index.html").write_text("<main>视距规划</main>", encoding="utf-8")
    (root / "assets" / "app.js").write_text("console.log('ready')", encoding="utf-8")
    return root


def test_serves_static_assets_and_spa_routes_from_configured_web_root(tmp_path: Path) -> None:
    client = TestClient(create_app(ApiSettings(web_root=_create_web_root(tmp_path))))

    assert client.get("/").text == "<main>视距规划</main>"
    assert client.get("/planning/tasks/current").text == "<main>视距规划</main>"
    asset = client.get("/assets/app.js")
    assert asset.status_code == 200
    assert asset.headers["content-type"].split(";", maxsplit=1)[0] in {
        "application/javascript",
        "text/javascript",
    }
    assert client.get("/missing.js").status_code == 404
    assert client.get("/api/v1/missing").status_code == 404
    assert client.get("/api/v1/health").json()["status"] == "ok"


def test_adds_cesium_compatible_csp_and_basic_security_headers(tmp_path: Path) -> None:
    client = TestClient(create_app(ApiSettings(web_root=_create_web_root(tmp_path))))

    for path in ("/", "/assets/app.js", "/api/v1/health"):
        response = client.get(path)
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert response.headers["permissions-policy"] == (
            "camera=(), microphone=(), geolocation=(self)"
        )
        policy = response.headers["content-security-policy"]
        assert "default-src 'self'" in policy
        assert "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'" in policy
        assert "worker-src 'self' blob:" in policy
        assert "img-src 'self' data: blob:" in policy
        assert "object-src 'none'" in policy
