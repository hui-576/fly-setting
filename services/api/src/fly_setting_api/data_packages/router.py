from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Response, status
from fastapi.responses import FileResponse

from fly_setting_api.data_packages.models import (
    ActivateDataPackageRequest,
    InstallDataPackageRequest,
)
from fly_setting_api.data_packages.service import DataPackageService

_IMMUTABLE_HEADERS = {"Cache-Control": "public, max-age=31536000, immutable"}


def _register_package_routes(router: APIRouter, service: DataPackageService) -> None:
    @router.get("/data-packages", operation_id="listDataPackages")
    def list_data_packages(
        page: int = Query(default=1, ge=1),
        limit: int = Query(default=20, ge=1, le=100),
    ) -> dict[str, Any]:
        packages = service.list_packages()
        start = (page - 1) * limit
        return {
            "data": packages[start : start + limit],
            "meta": {"page": page, "limit": limit, "total": len(packages)},
        }

    @router.post(
        "/data-packages/install",
        operation_id="installDataPackage",
        status_code=status.HTTP_201_CREATED,
    )
    def install_data_package(request: InstallDataPackageRequest) -> dict[str, Any]:
        return {"data": service.install(request.source_directory)}

    @router.put("/data-packages/active", operation_id="activateDataPackage")
    def activate_data_package(request: ActivateDataPackageRequest) -> dict[str, Any]:
        return {
            "data": service.activate(
                request.package_id, request.version, request.obscuration_mode
            )
        }


def _register_manifest_route(router: APIRouter, service: DataPackageService) -> None:
    @router.get("/map/manifest", operation_id="getMapManifest")
    def get_map_manifest(response: Response) -> dict[str, Any]:
        response.headers["Cache-Control"] = "no-store"
        return service.map_manifest()


def _register_xyz_route(router: APIRouter, service: DataPackageService) -> None:
    @router.get(
        "/map/packages/{package_id}/{version}/xyz/{z}/{x}/{y}.{extension}",
        include_in_schema=False,
    )
    def get_xyz_tile(
        package_id: str, version: str, z: int, x: int, y: int, extension: str
    ) -> FileResponse:
        resource = service.xyz_resource(package_id, version, z, x, y, extension)
        media_types = {
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "webp": "image/webp",
        }
        return FileResponse(
            resource, media_type=media_types[extension], headers=_IMMUTABLE_HEADERS
        )


def _register_terrain_route(router: APIRouter, service: DataPackageService) -> None:
    @router.get(
        "/map/packages/{package_id}/{version}/terrain/{resource_path:path}",
        include_in_schema=False,
    )
    def get_terrain_resource(
        package_id: str, version: str, resource_path: str
    ) -> FileResponse:
        resource = service.terrain_resource(package_id, version, resource_path)
        media_type = (
            "application/json"
            if resource.suffix.lower() == ".json"
            else "application/vnd.quantized-mesh"
        )
        return FileResponse(resource, media_type=media_type, headers=_IMMUTABLE_HEADERS)


def _register_road_route(router: APIRouter, service: DataPackageService) -> None:
    @router.get(
        "/map/packages/{package_id}/{version}/roads/{z}/{x}/{y}.mvt",
        include_in_schema=False,
    )
    def get_roads(
        package_id: str, version: str, z: int, x: int, y: int
    ) -> FileResponse:
        return FileResponse(
            service.road_tile_resource(package_id, version, z, x, y),
            media_type="application/vnd.mapbox-vector-tile",
            headers=_IMMUTABLE_HEADERS,
        )


def create_data_package_router(service: DataPackageService) -> APIRouter:
    """Create API routes bound to one package repository."""

    router = APIRouter(prefix="/api/v1")
    _register_package_routes(router, service)
    _register_manifest_route(router, service)
    _register_xyz_route(router, service)
    _register_terrain_route(router, service)
    _register_road_route(router, service)
    return router
