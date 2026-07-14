# Fly Setting API

The local FastAPI process used by the desktop application. The default listener is loopback-only.

```powershell
uv sync --extra test
uv run fly-setting-api
```

Health check: `GET /api/v1/health`.

