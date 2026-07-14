"""Validated uvicorn startup entry point."""

from __future__ import annotations

import uvicorn

from fly_setting_api.settings import ApiSettings


def build_server_config(settings: ApiSettings) -> uvicorn.Config:
    """Build a uvicorn configuration from already validated settings."""

    return uvicorn.Config(
        app="fly_setting_api.app:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        access_log=False,
        server_header=False,
    )


def main() -> None:
    """Start the local API and propagate startup failures."""

    settings = ApiSettings.from_environment()
    server = uvicorn.Server(build_server_config(settings))
    server.run()


if __name__ == "__main__":
    main()
