from __future__ import annotations

import json
import re
from base64 import b64decode
from binascii import Error as Base64Error
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

from fly_setting_api.data_packages.errors import DataPackageError

_TRUST_STORE_LIMIT = 64 * 1024
_KEY_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")


@dataclass(frozen=True, slots=True)
class LicenseTrustStore:
    """Immutable external trust anchors for custom-license approvals."""

    source_path: Path
    hmac_sha256_keys: MappingProxyType[str, bytes]


def _decode_keys(document: object) -> dict[str, bytes]:
    if not isinstance(document, dict):
        raise ValueError("trust store must be an object")
    if set(document) != {"schemaVersion", "hmacSha256Keys"}:
        raise ValueError("trust store fields are invalid")
    if document["schemaVersion"] != 1:
        raise ValueError("unsupported trust store schemaVersion")
    encoded_keys = document["hmacSha256Keys"]
    if not isinstance(encoded_keys, dict) or not 1 <= len(encoded_keys) <= 32:
        raise ValueError("hmacSha256Keys must contain between 1 and 32 keys")
    keys: dict[str, bytes] = {}
    for key_id, encoded in encoded_keys.items():
        if not isinstance(key_id, str) or _KEY_ID_PATTERN.fullmatch(key_id) is None:
            raise ValueError("invalid trust-store key identifier")
        if not isinstance(encoded, str):
            raise ValueError("trust-store keys must be base64 strings")
        secret = b64decode(encoded, validate=True)
        if not 32 <= len(secret) <= 64:
            raise ValueError("HMAC-SHA256 trust keys must contain 32 to 64 bytes")
        keys[key_id] = secret
    return keys


def load_license_trust_store(path: Path | None) -> LicenseTrustStore | None:
    """Load a bounded external HMAC trust store; no built-in key is provided."""

    if path is None:
        return None
    resolved = path.expanduser().resolve(strict=True)
    if not resolved.is_file() or resolved.is_symlink():
        raise DataPackageError(
            "LICENSE_TRUST_STORE_INVALID", "The license trust store must be a regular file"
        )
    if resolved.stat().st_size > _TRUST_STORE_LIMIT:
        raise DataPackageError(
            "LICENSE_TRUST_STORE_INVALID", "The license trust store exceeds 64 KiB"
        )
    try:
        document = json.loads(resolved.read_text(encoding="utf-8"))
        keys = _decode_keys(document)
    except (
        OSError,
        TypeError,
        ValueError,
        UnicodeDecodeError,
        json.JSONDecodeError,
        Base64Error,
    ) as error:
        raise DataPackageError(
            "LICENSE_TRUST_STORE_INVALID", "The license trust store is invalid"
        ) from error
    return LicenseTrustStore(resolved, MappingProxyType(keys))
