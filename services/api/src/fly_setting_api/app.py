"""FastAPI application factory."""

from __future__ import annotations

import asyncio
import secrets
from collections.abc import MutableMapping
from hmac import compare_digest
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import FileResponse
from starlette.responses import Response as StarletteResponse
from starlette.staticfiles import StaticFiles

from fly_setting_api import __version__
from fly_setting_api.settings import ApiSettings

CONTENT_SECURITY_POLICY = "; ".join(
    (
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' blob:",
        "worker-src 'self' blob:",
        "child-src 'self' blob:",
        "media-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    )
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Apply the same desktop security boundary to API and static responses."""

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> StarletteResponse:
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        return response


class SpaStaticFiles(StaticFiles):
    """Serve built assets while falling back to index.html for client-side routes."""

    def _index_response(self) -> FileResponse:
        if self.directory is None:
            raise RuntimeError("SPA static directory is not configured")
        return FileResponse(Path(self.directory) / "index.html")

    async def get_response(
        self,
        path: str,
        scope: MutableMapping[str, Any],
    ) -> StarletteResponse:
        try:
            response = await super().get_response(path, scope)
        except HTTPException as error:
            if error.status_code != 404 or Path(path).suffix or path.startswith("api/"):
                raise
            return self._index_response()
        if response.status_code != 404 or Path(path).suffix or path.startswith("api/"):
            return response
        return self._index_response()


def _health_payload() -> dict[str, Any]:
    return {
        "apiVersion": "v1",
        "service": {"name": "fly-setting-api", "version": __version__},
        "status": "ok",
        "runtime": {"state": "ready"},
    }


def create_app(settings: ApiSettings | None = None) -> FastAPI:
    """Create an isolated API application using validated settings."""

    resolved_settings = settings or ApiSettings.from_environment()
    app = FastAPI(
        title="Fly Setting Local API",
        version=__version__,
        docs_url=None,
        redoc_url=None,
    )
    app.state.settings = resolved_settings
    app.state.startup_secret_consumed = False
    app.state.startup_secret_lock = asyncio.Lock()
    app.state.local_session_token = None
    app.add_middleware(SecurityHeadersMiddleware)
    if resolved_settings.renderer_origin is not None:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[resolved_settings.renderer_origin],
            allow_credentials=True,
            allow_methods=["POST"],
            allow_headers=["X-Startup-Secret"],
        )

    @app.middleware("http")
    async def require_local_session(
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> StarletteResponse:
        public_paths = {"/api/v1/health", "/api/v1/session"}
        if (
            resolved_settings.startup_secret is not None
            and request.url.path.startswith("/api/v1/")
            and request.url.path not in public_paths
        ):
            supplied = request.cookies.get("fly_setting_session")
            expected = app.state.local_session_token
            if supplied is None or expected is None or not compare_digest(supplied, expected):
                return StarletteResponse(status_code=401, content="Local session required")
        return await call_next(request)

    @app.get("/api/v1/health", operation_id="getHealth")
    def get_health(response: Response) -> dict[str, Any]:
        response.headers["Cache-Control"] = "no-store"
        return _health_payload()

    @app.post("/api/v1/session", include_in_schema=False)
    async def create_local_session(
        response: Response,
        startup_secret: str | None = Header(default=None, alias="X-Startup-Secret"),
    ) -> dict[str, str]:
        async with app.state.startup_secret_lock:
            expected = resolved_settings.startup_secret
            if (
                expected is None
                or startup_secret is None
                or app.state.startup_secret_consumed
                or not compare_digest(startup_secret, expected)
            ):
                raise HTTPException(status_code=401, detail="Invalid or consumed startup secret")
            app.state.startup_secret_consumed = True
            session_token = secrets.token_urlsafe(32)
            app.state.local_session_token = session_token
        response.set_cookie(
            "fly_setting_session",
            session_token,
            httponly=True,
            samesite="strict",
            path="/api/",
        )
        return {"status": "ok"}

    @app.get("/api/{path:path}", include_in_schema=False)
    def reject_unknown_api_path(path: str) -> None:
        raise HTTPException(status_code=404, detail=f"Unknown API path: /api/{path}")

    if resolved_settings.web_root is not None:
        app.mount(
            "/",
            SpaStaticFiles(directory=resolved_settings.web_root, html=True),
            name="web",
        )

    return app
