from fly_setting_api.main import build_server_config
from fly_setting_api.settings import ApiSettings


def test_server_config_uses_validated_settings() -> None:
    config = build_server_config(ApiSettings(host="127.0.0.1", port=8123))

    assert config.host == "127.0.0.1"
    assert config.port == 8123
    assert config.factory is True
    assert config.app == "fly_setting_api.app:create_app"
