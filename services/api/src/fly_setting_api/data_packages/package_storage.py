from __future__ import annotations

import json
import shutil
from pathlib import Path

from pydantic import ValidationError

from fly_setting_api.data_packages.errors import DataPackageError
from fly_setting_api.data_packages.models import ActivePackageReference


def prepare_storage(packages_root: Path, staging_root: Path) -> None:
    packages_root.mkdir(parents=True, exist_ok=True)
    staging_root.mkdir(parents=True, exist_ok=True)


def read_active_reference(active_path: Path) -> ActivePackageReference | None:
    try:
        document = json.loads(active_path.read_text(encoding="utf-8"))
        return ActivePackageReference.model_validate(document)
    except FileNotFoundError:
        return None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValidationError) as error:
        raise DataPackageError(
            "ACTIVE_REFERENCE_INVALID", "The active data-package reference is invalid"
        ) from error


def cleanup_staging(staging: Path, cause: BaseException | None = None) -> None:
    if not staging.exists():
        return
    try:
        shutil.rmtree(staging)
    except OSError as error:
        raise DataPackageError(
            "STAGING_CLEANUP_FAILED", "The failed import staging directory could not be removed"
        ) from cause or error
