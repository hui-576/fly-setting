from pathlib import Path

import pytest

from fly_setting_api.settings import ApiSettings, SettingsError


def test_default_listener_is_loopback_only() -> None:
    settings = ApiSettings()

    assert settings.host == "127.0.0.1"
    assert settings.port == 0
    assert settings.allow_lan is False


def test_non_loopback_listener_requires_explicit_lan_mode() -> None:
    with pytest.raises(SettingsError, match="non-loopback"):
        ApiSettings(host="0.0.0.0")


def test_lan_mode_is_rejected_until_authenticated_access_is_implemented() -> None:
    with pytest.raises(SettingsError, match="LAN mode is unavailable"):
        ApiSettings(host="0.0.0.0", allow_lan=True)


def test_invalid_port_is_rejected() -> None:
    with pytest.raises(SettingsError, match="port"):
        ApiSettings(port=70_000)


def test_environment_values_are_validated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FLY_SETTING_API_HOST", "192.168.1.10")
    monkeypatch.setenv("FLY_SETTING_API_ALLOW_LAN", "false")

    with pytest.raises(SettingsError, match="non-loopback"):
        ApiSettings.from_environment()


def test_invalid_environment_boolean_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FLY_SETTING_API_ALLOW_LAN", "sometimes")

    with pytest.raises(SettingsError, match="boolean"):
        ApiSettings.from_environment()


def test_web_root_is_loaded_from_the_environment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    (tmp_path / "index.html").write_text("<main>planner</main>", encoding="utf-8")
    monkeypatch.setenv("FLY_SETTING_WEB_ROOT", str(tmp_path))

    assert ApiSettings.from_environment().web_root == tmp_path.resolve()


def test_web_root_requires_an_index_document(tmp_path: Path) -> None:
    with pytest.raises(SettingsError, match=r"index\.html"):
        ApiSettings(web_root=tmp_path)
