"""Validated runtime settings for the local API listener."""

from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass
from pathlib import Path


class SettingsError(ValueError):
    """Raised when local API settings violate the listener security boundary."""


def _parse_boolean(value: str, name: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise SettingsError(f"{name} must be a boolean")


def _is_loopback(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


@dataclass(frozen=True, slots=True)
class ApiSettings:
    """Configuration for one local API process."""

    host: str = "127.0.0.1"
    port: int = 0
    allow_lan: bool = False
    web_root: Path | None = None
    startup_secret: str | None = None
    renderer_origin: str | None = None

    def __post_init__(self) -> None:
        if not 0 <= self.port <= 65_535:
            raise SettingsError("port must be between 0 and 65535")
        if self.allow_lan:
            raise SettingsError(
                "LAN mode is unavailable until authenticated read-only access is implemented"
            )
        if not self.allow_lan and not _is_loopback(self.host):
            raise SettingsError(
                "non-loopback host is unavailable until authenticated LAN mode is implemented"
            )
        if self.web_root is not None:
            resolved_root = self.web_root.expanduser().resolve()
            if not resolved_root.is_dir():
                raise SettingsError("FLY_SETTING_WEB_ROOT must be an existing directory")
            if not (resolved_root / "index.html").is_file():
                raise SettingsError("FLY_SETTING_WEB_ROOT must contain index.html")
            object.__setattr__(self, "web_root", resolved_root)

    @classmethod
    def from_environment(cls) -> ApiSettings:
        """Read supported environment variables and validate their combined effect."""

        host = os.getenv("FLY_SETTING_API_HOST", "127.0.0.1")
        port_text = os.getenv("FLY_SETTING_API_PORT", "0")
        allow_lan = _parse_boolean(
            os.getenv("FLY_SETTING_API_ALLOW_LAN", "false"),
            "FLY_SETTING_API_ALLOW_LAN",
        )
        try:
            port = int(port_text)
        except ValueError as error:
            raise SettingsError("FLY_SETTING_API_PORT must be an integer") from error
        web_root_text = os.getenv("FLY_SETTING_WEB_ROOT")
        web_root = Path(web_root_text) if web_root_text else None
        startup_secret = os.getenv("FLY_SETTING_STARTUP_SECRET")
        renderer_origin = os.getenv("FLY_SETTING_RENDERER_ORIGIN")
        return cls(
            host=host,
            port=port,
            allow_lan=allow_lan,
            web_root=web_root,
            startup_secret=startup_secret,
            renderer_origin=renderer_origin,
        )
