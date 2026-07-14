from __future__ import annotations

import os
from pathlib import Path

import rasterio


def rasterio_environment() -> rasterio.Env:
    """Use Rasterio's bundled GDAL/PROJ data instead of ambient installations."""

    package_root = Path(rasterio.__file__).resolve().parent
    gdal_data = package_root / "gdal_data"
    proj_data = package_root / "proj_data"
    os.environ["GDAL_DATA"] = str(gdal_data)
    os.environ["PROJ_DATA"] = str(proj_data)
    os.environ["PROJ_LIB"] = str(proj_data)
    return rasterio.Env(GDAL_DATA=str(gdal_data), PROJ_DATA=str(proj_data))
