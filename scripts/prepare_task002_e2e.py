from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path


def _safe_clean(path: Path, workspace: Path) -> None:
    resolved = path.resolve()
    allowed_root = (workspace / "test-results").resolve()
    if not resolved.is_relative_to(allowed_root) or resolved == allowed_root:
        raise RuntimeError("E2E data path must be a child of test-results")
    shutil.rmtree(resolved, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, required=True)
    arguments = parser.parse_args()
    workspace = Path(__file__).resolve().parents[1]
    tests_root = workspace / "services" / "api" / "tests"
    sys.path.insert(0, str(tests_root))

    from data_package.conftest import create_data_package
    from fly_setting_api.data_packages.service import DataPackageService

    data_root = arguments.data_root.resolve()
    _safe_clean(data_root, workspace)
    source_root = data_root.parent / f"{data_root.name}-source"
    _safe_clean(source_root, workspace)
    switch_root = data_root.parent / f"{data_root.name}-switch-source"
    _safe_clean(switch_root, workspace)
    source = create_data_package(source_root)
    create_data_package(switch_root, version="2026.08.0")
    create_data_package(switch_root, version="2026.09.0")
    service = DataPackageService(data_root)
    service.install(str(source))
    service.activate("hubei-demo", "2026.07.0", "surface")


if __name__ == "__main__":
    main()
