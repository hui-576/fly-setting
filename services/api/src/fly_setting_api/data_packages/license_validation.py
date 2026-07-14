from __future__ import annotations

import hashlib
import hmac
import json
import re
from datetime import date, datetime
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlsplit

from fly_setting_api.data_packages.errors import DataPackageError
from fly_setting_api.data_packages.license_trust import LicenseTrustStore
from fly_setting_api.data_packages.models import DataPackageManifest
from fly_setting_api.data_packages.spdx import is_license_ref, is_spdx_license_id

_LICENSE_TEXT_LIMIT = 1024 * 1024
_APPROVAL_EVIDENCE_LIMIT = 64 * 1024
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def _canonical_json(document: dict[str, Any]) -> bytes:
    return json.dumps(
        document, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_relative_path(value: str, *, field: str) -> PurePosixPath:
    if not value or "\\" in value or ":" in value:
        raise DataPackageError("MANIFEST_PATH_INVALID", f"{field} is not a safe relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise DataPackageError("MANIFEST_PATH_INVALID", f"{field} is not a safe relative path")
    return path


def _require_evidence_file(
    root: Path,
    manifest: DataPackageManifest,
    value: str | None,
    *,
    field: str,
    size_limit: int,
) -> Path:
    if value is None:
        raise DataPackageError(
            "LICENSE_EVIDENCE_MISSING", f"{field} is required for LicenseRef licenses"
        )
    relative = _safe_relative_path(value, field=field)
    inventory = {PurePosixPath(entry.path) for entry in manifest.files}
    path = root.joinpath(*relative.parts)
    if relative not in inventory or not path.is_file() or path.is_symlink():
        raise DataPackageError(
            "LICENSE_EVIDENCE_MISSING", f"{field} must reference a declared regular package file"
        )
    if path.stat().st_size > size_limit:
        raise DataPackageError("LICENSE_EVIDENCE_INVALID", f"{field} exceeds its size limit")
    return path


def _validate_source_uri(value: str) -> None:
    parsed = urlsplit(value)
    if parsed.scheme in {"http", "https"}:
        if parsed.hostname and parsed.username is None and parsed.password is None:
            return
    elif parsed.scheme == "urn" and parsed.path:
        return
    raise DataPackageError(
        "LICENSE_SOURCE_INVALID", "license.sourceUri must be a traceable HTTP(S) URI or URN"
    )


def manifest_binding_sha256(
    manifest: DataPackageManifest, approval_path: PurePosixPath
) -> str:
    """Hash the canonical manifest while excluding the circular approval file entry."""

    document = manifest.model_dump(by_alias=True, exclude_none=True)
    document["files"] = sorted(
        (
            entry
            for entry in document["files"]
            if PurePosixPath(entry["path"]) != approval_path
        ),
        key=lambda entry: entry["path"],
    )
    return hashlib.sha256(_canonical_json(document)).hexdigest()


def _parse_approval(path: Path) -> dict[str, Any]:
    expected_fields = {
        "schemaVersion",
        "keyId",
        "decision",
        "approvedBy",
        "approvedAt",
        "scope",
        "packageId",
        "version",
        "licenseId",
        "licenseTextSha256",
        "manifestDigestSha256",
        "licenseSource",
        "sourceEvidence",
        "signature",
    }
    try:
        document: Any = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(document, dict) or set(document) != expected_fields:
            raise ValueError("approval fields are invalid")
        if document["schemaVersion"] != 1 or document["decision"] != "approved":
            raise ValueError("approval decision is not approved")
        if not isinstance(document["approvedBy"], str) or not document["approvedBy"].strip():
            raise ValueError("approvedBy must identify the approving authority")
        approved_at = document["approvedAt"]
        if not isinstance(approved_at, str):
            raise ValueError("approvedAt must be an ISO-8601 date or timestamp")
        try:
            datetime.fromisoformat(approved_at.replace("Z", "+00:00"))
        except ValueError:
            date.fromisoformat(approved_at)
        scope = document["scope"]
        if not isinstance(scope, list) or not all(isinstance(item, str) for item in scope):
            raise ValueError("scope must be a list")
        if not {"offline-processing", "offline-deployment"}.issubset(scope):
            raise ValueError("scope must approve offline processing and deployment")
        for field in (
            "keyId",
            "packageId",
            "version",
            "licenseId",
            "licenseSource",
            "sourceEvidence",
        ):
            if not isinstance(document[field], str) or not document[field]:
                raise ValueError(f"{field} must be a non-empty string")
        for field in ("licenseTextSha256", "manifestDigestSha256", "signature"):
            if (
                not isinstance(document[field], str)
                or _SHA256_PATTERN.fullmatch(document[field]) is None
            ):
                raise ValueError(f"{field} must be a lowercase SHA-256 value")
    except (KeyError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DataPackageError(
            "LICENSE_EVIDENCE_INVALID",
            "license.approvalEvidence is not explicit signed approval evidence",
            details={"reason": str(error)},
        ) from error
    return document


def _verify_approval(
    evidence: dict[str, Any],
    expected: dict[str, str],
    trust_store: LicenseTrustStore | None,
) -> None:
    if trust_store is None:
        raise DataPackageError(
            "LICENSE_TRUST_ANCHOR_MISSING",
            "LicenseRef approval requires an externally configured trust store",
        )
    if any(evidence[field] != value for field, value in expected.items()):
        raise DataPackageError(
            "LICENSE_APPROVAL_INVALID", "The custom-license approval does not bind this package"
        )
    secret = trust_store.hmac_sha256_keys.get(evidence["keyId"])
    if secret is None:
        raise DataPackageError(
            "LICENSE_APPROVAL_INVALID", "The custom-license approval key is not trusted"
        )
    signed = dict(evidence)
    supplied_signature = signed.pop("signature")
    expected_signature = hmac.new(secret, _canonical_json(signed), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(supplied_signature, expected_signature):
        raise DataPackageError(
            "LICENSE_APPROVAL_INVALID", "The custom-license approval signature is invalid"
        )


def _requires_custom_approval(manifest: DataPackageManifest) -> bool:
    license_info = manifest.license_info
    if not license_info.offline_use_approved:
        raise DataPackageError(
            "LICENSE_NOT_APPROVED",
            "The data license does not explicitly approve offline processing and deployment",
        )
    if (
        license_info.source.casefold() in {"unknown", "none", "n/a"}
        or ":" not in license_info.source
    ):
        raise DataPackageError("LICENSE_SOURCE_INVALID", "The data license source is not traceable")
    if is_spdx_license_id(license_info.spdx_id):
        return False
    if not is_license_ref(license_info.spdx_id):
        raise DataPackageError(
            "LICENSE_ID_INVALID",
            "The data license must use a reviewed SPDX identifier or LicenseRef-*",
        )
    return True


def _license_text_sha256(
    root: Path, manifest: DataPackageManifest
) -> str:
    license_info = manifest.license_info

    license_text_path = _require_evidence_file(
        root,
        manifest,
        license_info.license_text,
        field="license.licenseText",
        size_limit=_LICENSE_TEXT_LIMIT,
    )
    try:
        if not license_text_path.read_text(encoding="utf-8").strip():
            raise ValueError("license text is empty")
    except (UnicodeDecodeError, ValueError) as error:
        raise DataPackageError(
            "LICENSE_EVIDENCE_INVALID", "license.licenseText must contain UTF-8 license text"
        ) from error
    return _hash_file(license_text_path)


def _source_evidence(
    manifest: DataPackageManifest, license_text_sha256: str
) -> str:
    license_info = manifest.license_info

    if license_info.source_uri is None and license_info.source_file_sha256 is None:
        raise DataPackageError(
            "LICENSE_EVIDENCE_MISSING",
            "LicenseRef licenses require license.sourceUri or license.sourceFileSha256",
        )
    if license_info.source_uri is not None:
        _validate_source_uri(license_info.source_uri)
        return license_info.source_uri
    if license_info.source_file_sha256 != license_text_sha256:
        raise DataPackageError(
            "LICENSE_SOURCE_INVALID",
            "license.sourceFileSha256 must match the referenced license text",
        )
    return f"sha256:{license_text_sha256}"


def _approval_inputs(
    root: Path, manifest: DataPackageManifest
) -> tuple[dict[str, Any], PurePosixPath]:
    license_info = manifest.license_info

    approval_path = _require_evidence_file(
        root,
        manifest,
        license_info.approval_evidence,
        field="license.approvalEvidence",
        size_limit=_APPROVAL_EVIDENCE_LIMIT,
    )
    approval_relative = _safe_relative_path(
        license_info.approval_evidence or "", field="license.approvalEvidence"
    )
    return _parse_approval(approval_path), approval_relative


def validate_license(
    root: Path,
    manifest: DataPackageManifest,
    trust_store: LicenseTrustStore | None,
) -> None:
    """Validate SPDX identity and externally trusted custom-license approval."""

    if not _requires_custom_approval(manifest):
        return
    license_info = manifest.license_info
    license_text_sha256 = _license_text_sha256(root, manifest)
    source_evidence = _source_evidence(manifest, license_text_sha256)
    evidence, approval_relative = _approval_inputs(root, manifest)
    _verify_approval(
        evidence,
        {
            "packageId": manifest.package_id,
            "version": manifest.version,
            "licenseId": license_info.spdx_id,
            "licenseTextSha256": license_text_sha256,
            "manifestDigestSha256": manifest_binding_sha256(manifest, approval_relative),
            "licenseSource": license_info.source,
            "sourceEvidence": source_evidence,
        },
        trust_store,
    )
