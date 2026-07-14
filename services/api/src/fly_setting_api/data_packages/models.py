from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PackageId = Annotated[str, Field(pattern=r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")]
PackageVersion = Annotated[str, Field(pattern=r"^[0-9]+(?:\.[0-9A-Za-z-]+){1,3}$")]
Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=False)


class LicenseManifest(StrictModel):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    spdx_id: Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9.+-]{1,79}$")] = Field(
        alias="spdxId"
    )
    source: Annotated[str, Field(min_length=3, max_length=2_000)]
    offline_use_approved: bool = Field(alias="offlineUseApproved")
    attribution: Annotated[str, Field(min_length=1, max_length=2_000)]
    notice: Annotated[str, Field(min_length=1, max_length=10_000)]
    license_text: Annotated[str, Field(min_length=1, max_length=500)] | None = Field(
        default=None, alias="licenseText"
    )
    source_uri: Annotated[str, Field(min_length=3, max_length=2_000)] | None = Field(
        default=None, alias="sourceUri"
    )
    source_file_sha256: Sha256 | None = Field(default=None, alias="sourceFileSha256")
    approval_evidence: Annotated[str, Field(min_length=1, max_length=500)] | None = Field(
        default=None, alias="approvalEvidence"
    )


class AssetManifest(StrictModel):
    dtm: str
    dsm: str | None
    basemap_root: str = Field(alias="basemapRoot")
    basemap_extension: Literal["png", "jpg", "jpeg", "webp"] = Field(
        alias="basemapExtension"
    )
    basemap_minimum_level: Annotated[int, Field(ge=0, le=30)] = Field(
        alias="basemapMinimumLevel"
    )
    basemap_maximum_level: Annotated[int, Field(ge=0, le=30)] = Field(
        alias="basemapMaximumLevel"
    )
    terrain_root: str = Field(alias="terrainRoot")
    roads: str
    roads_crs: Literal["EPSG:4326"] = Field(alias="roadsCrs")
    road_tiles_root: str = Field(alias="roadTilesRoot")
    road_tiles_layer: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")] = Field(
        alias="roadTilesLayer"
    )
    road_tiles_minimum_level: Annotated[int, Field(ge=0, le=22)] = Field(
        alias="roadTilesMinimumLevel"
    )
    road_tiles_maximum_level: Annotated[int, Field(ge=0, le=22)] = Field(
        alias="roadTilesMaximumLevel"
    )

    @model_validator(mode="after")
    def validate_level_range(self) -> AssetManifest:
        if self.basemap_minimum_level > self.basemap_maximum_level:
            raise ValueError("basemapMinimumLevel must not exceed basemapMaximumLevel")
        if self.road_tiles_minimum_level > self.road_tiles_maximum_level:
            raise ValueError("roadTilesMinimumLevel must not exceed roadTilesMaximumLevel")
        return self


class FileManifest(StrictModel):
    path: str
    sha256: Sha256


class DataPackageManifest(StrictModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    package_id: PackageId = Field(alias="id")
    version: PackageVersion
    display_name: Annotated[str, Field(min_length=1, max_length=200)] = Field(
        alias="displayName"
    )
    crs: Annotated[str, Field(min_length=1, max_length=200)]
    extent: tuple[float, float, float, float]
    geographic_bounds: tuple[float, float, float, float] = Field(alias="geographicBounds")
    pixel_size: tuple[Annotated[float, Field(gt=0)], Annotated[float, Field(gt=0)]] = Field(
        alias="pixelSize"
    )
    no_data: float = Field(alias="noData")
    vertical_unit: Literal["m"] = Field(alias="verticalUnit")
    accuracy_hint: Annotated[str, Field(min_length=1, max_length=2_000)] = Field(
        alias="accuracyHint"
    )
    license_info: LicenseManifest = Field(alias="license")
    assets: AssetManifest
    files: Annotated[list[FileManifest], Field(min_length=1)]

    @field_validator("extent", "geographic_bounds")
    @classmethod
    def validate_extent(
        cls, value: tuple[float, float, float, float]
    ) -> tuple[float, float, float, float]:
        if value[0] >= value[2] or value[1] >= value[3]:
            raise ValueError("extent must be ordered as minX, minY, maxX, maxY")
        return value

    @model_validator(mode="after")
    def require_unique_files(self) -> DataPackageManifest:
        paths = [entry.path for entry in self.files]
        if len(paths) != len(set(paths)):
            raise ValueError("files must not contain duplicate paths")
        return self


class InstallDataPackageRequest(StrictModel):
    source_directory: str = Field(alias="sourceDirectory", min_length=1, max_length=32_767)


class ActivateDataPackageRequest(StrictModel):
    package_id: PackageId = Field(alias="packageId")
    version: PackageVersion
    obscuration_mode: Literal["bare-earth", "surface"] = Field(
        default="bare-earth", alias="obscurationMode"
    )


class ActivePackageReference(StrictModel):
    """Strict on-disk pointer to one immutable package version."""

    package_id: PackageId = Field(alias="id")
    version: PackageVersion
    obscuration_mode: Literal["bare-earth", "surface"] = Field(alias="obscurationMode")
