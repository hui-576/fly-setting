from __future__ import annotations

from typing import Any

from fly_setting_api.data_packages.models import ActivePackageReference, DataPackageManifest


def supported_modes(manifest: DataPackageManifest) -> list[str]:
    """Return analysis modes backed by authoritative elevation assets."""

    return ["bare-earth", "surface"] if manifest.assets.dsm is not None else ["bare-earth"]


def package_descriptor(
    manifest: DataPackageManifest,
    *,
    active: bool,
    obscuration_mode: str | None = None,
    status: str = "installed",
) -> dict[str, Any]:
    """Build the user-facing package capability descriptor."""

    resolution = float(manifest.pixel_size[0])
    elevation = {
        "available": True,
        "resolutionMeters": resolution,
        "accuracyHint": manifest.accuracy_hint,
    }
    return {
        "id": manifest.package_id,
        "version": manifest.version,
        "displayName": manifest.display_name,
        "status": status,
        "active": active,
        "obscurationMode": obscuration_mode if active else None,
        "supportedObscurationModes": supported_modes(manifest),
        "dtm": elevation,
        "dsm": {
            "available": manifest.assets.dsm is not None,
            "resolutionMeters": resolution if manifest.assets.dsm is not None else None,
            "accuracyHint": manifest.accuracy_hint if manifest.assets.dsm is not None else None,
        },
    }


def ready_map_manifest(
    manifest: DataPackageManifest, active: ActivePackageReference
) -> dict[str, Any]:
    """Build versioned same-origin URLs for one active immutable package."""

    prefix = f"/api/v1/map/packages/{manifest.package_id}/{manifest.version}"
    resolution = float(manifest.pixel_size[0])
    accuracy = manifest.accuracy_hint
    return {
        "status": "ready",
        "package": {
            "id": manifest.package_id,
            "version": manifest.version,
            "obscurationMode": active.obscuration_mode,
            "supportedObscurationModes": supported_modes(manifest),
            "dtm": {
                "available": True,
                "resolutionMeters": resolution,
                "accuracyHint": accuracy,
            },
            "dsm": {
                "available": manifest.assets.dsm is not None,
                "resolutionMeters": resolution if manifest.assets.dsm is not None else None,
                "accuracyHint": accuracy if manifest.assets.dsm is not None else None,
            },
        },
        "layers": {
            "basemap": {
                "type": "xyz",
                "urlTemplate": (
                    f"{prefix}/xyz/{{z}}/{{x}}/{{y}}.{manifest.assets.basemap_extension}"
                ),
                "minimumLevel": manifest.assets.basemap_minimum_level,
                "maximumLevel": manifest.assets.basemap_maximum_level,
            },
            "terrain": {"type": "quantized-mesh", "url": f"{prefix}/terrain/"},
            "roads": {
                "type": "mvt",
                "urlTemplate": f"{prefix}/roads/{{z}}/{{x}}/{{y}}.mvt",
                "layer": manifest.assets.road_tiles_layer,
                "minimumLevel": manifest.assets.road_tiles_minimum_level,
                "maximumLevel": manifest.assets.road_tiles_maximum_level,
            },
        },
        "errors": [],
    }
