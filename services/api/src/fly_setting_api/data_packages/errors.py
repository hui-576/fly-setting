from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class DataPackageError(Exception):
    """Stable domain error exposed through the local REST API."""

    code: str
    message: str
    status_code: int = 422
    details: dict[str, Any] | None = None

    def __str__(self) -> str:
        return self.message
