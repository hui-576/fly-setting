from __future__ import annotations

import hashlib
import hmac
import json
from base64 import b64encode
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from fly_setting_api.app import create_app
from fly_setting_api.settings import ApiSettings

from .conftest import create_data_package

_TEST_KEY_ID = "project-data-owner-test"
_TEST_SECRET = b"test-only-license-approval-secret-32-bytes"


def _document(source: Path) -> dict[str, Any]:
    return json.loads((source / "manifest.json").read_text(encoding="utf-8"))


def _write_document(source: Path, document: dict[str, Any]) -> None:
    (source / "manifest.json").write_text(
        json.dumps(document, ensure_ascii=False), encoding="utf-8"
    )


def _install(tmp_path: Path, source: Path, trust_store: Path | None = None) -> Any:
    client = TestClient(
        create_app(
            ApiSettings(
                data_package_root=tmp_path / "store",
                license_trust_store_path=trust_store,
            )
        )
    )
    return client.post(
        "/api/v1/data-packages/install", json={"sourceDirectory": str(source)}
    )


def _add_inventory_file(source: Path, document: dict[str, Any], relative: str, text: str) -> None:
    path = source / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    document["files"].append(
        {"path": relative, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    )


def _canonical_json(document: dict[str, Any]) -> bytes:
    return json.dumps(
        document, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def _manifest_binding(document: dict[str, Any], approval_path: str) -> str:
    bound = deepcopy(document)
    bound["files"] = sorted(
        (entry for entry in bound["files"] if entry["path"] != approval_path),
        key=lambda entry: entry["path"],
    )
    return hashlib.sha256(_canonical_json(bound)).hexdigest()


def _write_trust_store(tmp_path: Path, secret: bytes = _TEST_SECRET) -> Path:
    trust_store = tmp_path / "license-trust-store.json"
    trust_store.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "hmacSha256Keys": {_TEST_KEY_ID: b64encode(secret).decode("ascii")},
            }
        ),
        encoding="utf-8",
    )
    return trust_store


def _custom_license_package(
    source: Path, *, secret: bytes = _TEST_SECRET
) -> dict[str, Any]:
    document = _document(source)
    _add_inventory_file(
        source,
        document,
        "licenses/custom-license.txt",
        "Project geodata license\nOffline processing is governed by the attached approval.",
    )
    license_text_sha256 = hashlib.sha256(
        (source / "licenses" / "custom-license.txt").read_bytes()
    ).hexdigest()
    approval_path = "licenses/offline-approval.json"
    document["license"].update(
        {
            "name": "Project Geodata License",
            "spdxId": "LicenseRef-Project-Geodata-1.0",
            "source": "project:data-owner",
            "licenseText": "licenses/custom-license.txt",
            "sourceUri": "https://data-owner.example/licenses/geodata-1.0",
            "approvalEvidence": approval_path,
        }
    )
    evidence: dict[str, Any] = {
        "schemaVersion": 1,
        "keyId": _TEST_KEY_ID,
        "decision": "approved",
        "approvedBy": "Project Data Owner",
        "approvedAt": "2026-07-15",
        "scope": ["offline-processing", "offline-deployment"],
        "packageId": document["id"],
        "version": document["version"],
        "licenseId": document["license"]["spdxId"],
        "licenseTextSha256": license_text_sha256,
        "manifestDigestSha256": _manifest_binding(document, approval_path),
        "licenseSource": document["license"]["source"],
        "sourceEvidence": document["license"]["sourceUri"],
    }
    evidence["signature"] = hmac.new(
        secret, _canonical_json(evidence), hashlib.sha256
    ).hexdigest()
    _add_inventory_file(source, document, approval_path, json.dumps(evidence))
    return document


def _assert_license_failure(response: Any, code: str) -> None:
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code


def test_arbitrary_spdx_like_identifier_is_rejected(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _document(source)
    document["license"]["spdxId"] = "Bogus-License-1.0"
    _write_document(source, document)

    response = _install(tmp_path, source)

    _assert_license_failure(response, "LICENSE_ID_INVALID")


@pytest.mark.parametrize(
    "spdx_id", ["MIT", "Apache-2.0", "BSD-3-Clause", "CC-BY-4.0", "ODbL-1.0"]
)
def test_reviewed_common_spdx_identifiers_are_accepted(tmp_path: Path, spdx_id: str) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _document(source)
    document["license"]["spdxId"] = spdx_id
    _write_document(source, document)

    response = _install(tmp_path, source)

    assert response.status_code == 201, response.text


@pytest.mark.parametrize(
    "missing_field",
    ["licenseText", "sourceUri", "approvalEvidence"],
)
def test_license_ref_requires_each_evidence_category(
    tmp_path: Path, missing_field: str
) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _custom_license_package(source)
    document["license"].pop(missing_field)
    _write_document(source, document)

    response = _install(tmp_path, source)

    _assert_license_failure(response, "LICENSE_EVIDENCE_MISSING")


def test_license_ref_rejects_non_approval_document(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _custom_license_package(source)
    approval_path = source / "licenses" / "offline-approval.json"
    evidence = json.loads(approval_path.read_text(encoding="utf-8"))
    evidence["decision"] = "pending"
    approval_path.write_text(json.dumps(evidence), encoding="utf-8")
    next(
        entry
        for entry in document["files"]
        if entry["path"] == "licenses/offline-approval.json"
    )["sha256"] = hashlib.sha256(approval_path.read_bytes()).hexdigest()
    _write_document(source, document)

    response = _install(tmp_path, source, _write_trust_store(tmp_path))

    _assert_license_failure(response, "LICENSE_EVIDENCE_INVALID")


def test_license_ref_with_complete_auditable_evidence_is_accepted(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _custom_license_package(source)
    _write_document(source, document)

    response = _install(tmp_path, source, _write_trust_store(tmp_path))

    assert response.status_code == 201, response.text


def test_license_ref_accepts_source_file_digest_instead_of_uri(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _document(source)
    _add_inventory_file(
        source,
        document,
        "licenses/custom-license.txt",
        "Project geodata license with a source-file digest.",
    )
    document["license"].update(
        {
            "name": "Project Geodata License",
            "spdxId": "LicenseRef-Project-Geodata-1.0",
            "source": "project:data-owner",
            "licenseText": "licenses/custom-license.txt",
            "sourceFileSha256": hashlib.sha256(
                (source / "licenses" / "custom-license.txt").read_bytes()
            ).hexdigest(),
            "approvalEvidence": "licenses/offline-approval.json",
        }
    )
    approval_path = "licenses/offline-approval.json"
    evidence: dict[str, Any] = {
        "schemaVersion": 1,
        "keyId": _TEST_KEY_ID,
        "decision": "approved",
        "approvedBy": "Project Data Owner",
        "approvedAt": "2026-07-15",
        "scope": ["offline-processing", "offline-deployment"],
        "packageId": document["id"],
        "version": document["version"],
        "licenseId": document["license"]["spdxId"],
        "licenseTextSha256": document["license"]["sourceFileSha256"],
        "manifestDigestSha256": _manifest_binding(document, approval_path),
        "licenseSource": document["license"]["source"],
        "sourceEvidence": f"sha256:{document['license']['sourceFileSha256']}",
    }
    evidence["signature"] = hmac.new(
        _TEST_SECRET, _canonical_json(evidence), hashlib.sha256
    ).hexdigest()
    _add_inventory_file(source, document, approval_path, json.dumps(evidence))
    _write_document(source, document)

    response = _install(tmp_path, source, _write_trust_store(tmp_path))

    assert response.status_code == 201, response.text


def test_license_ref_rejects_unbound_source_file_digest(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _custom_license_package(source)
    document["license"].pop("sourceUri")
    document["license"]["sourceFileSha256"] = "a" * 64
    _write_document(source, document)

    response = _install(tmp_path, source)

    _assert_license_failure(response, "LICENSE_SOURCE_INVALID")


def test_license_ref_without_external_trust_anchor_is_rejected(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _custom_license_package(source)
    _write_document(source, document)

    response = _install(tmp_path, source)

    _assert_license_failure(response, "LICENSE_TRUST_ANCHOR_MISSING")


def test_runtime_has_no_default_license_trust_key(tmp_path: Path) -> None:
    settings = ApiSettings(data_package_root=tmp_path / "store")

    assert settings.license_trust_store_path is None


def test_imported_package_cannot_supply_its_own_trust_store(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _custom_license_package(source)
    _write_document(source, document)
    trust_store = source / "package-controlled-trust-store.json"
    trust_store.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "hmacSha256Keys": {
                    _TEST_KEY_ID: b64encode(_TEST_SECRET).decode("ascii")
                },
            }
        ),
        encoding="utf-8",
    )

    response = _install(tmp_path, source, trust_store)

    _assert_license_failure(response, "LICENSE_TRUST_STORE_INSIDE_PACKAGE")


@pytest.mark.parametrize(
    "binding",
    [
        "packageId",
        "version",
        "licenseId",
        "licenseTextSha256",
        "manifestDigestSha256",
        "licenseSource",
        "sourceEvidence",
    ],
)
def test_license_ref_rejects_tampered_signed_binding(tmp_path: Path, binding: str) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _custom_license_package(source)
    approval_path = source / "licenses" / "offline-approval.json"
    evidence = json.loads(approval_path.read_text(encoding="utf-8"))
    evidence[binding] = (
        "b" * 64
        if binding in {"licenseTextSha256", "manifestDigestSha256"}
        else f"tampered-{binding}"
    )
    approval_path.write_text(json.dumps(evidence), encoding="utf-8")
    next(
        entry for entry in document["files"] if entry["path"] == "licenses/offline-approval.json"
    )["sha256"] = hashlib.sha256(approval_path.read_bytes()).hexdigest()
    _write_document(source, document)

    response = _install(tmp_path, source, _write_trust_store(tmp_path))

    _assert_license_failure(response, "LICENSE_APPROVAL_INVALID")


def test_license_ref_approval_cannot_be_replayed_to_another_package(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _custom_license_package(source)
    document["id"] = "hubei-replay"
    document["version"] = "2027.1.0"
    _write_document(source, document)

    response = _install(tmp_path, source, _write_trust_store(tmp_path))

    _assert_license_failure(response, "LICENSE_APPROVAL_INVALID")


def test_license_ref_rejects_signature_from_untrusted_key(tmp_path: Path) -> None:
    source = create_data_package(tmp_path / "incoming")
    document = _custom_license_package(source, secret=b"untrusted-secret-is-at-least-32-bytes")
    _write_document(source, document)

    response = _install(tmp_path, source, _write_trust_store(tmp_path))

    _assert_license_failure(response, "LICENSE_APPROVAL_INVALID")
