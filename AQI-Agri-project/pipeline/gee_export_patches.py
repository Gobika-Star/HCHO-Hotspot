import argparse
from datetime import date
from io import BytesIO
from pathlib import Path
import time
from zipfile import ZipFile, is_zipfile

import ee
import numpy as np
import pandas as pd
import rasterio
import requests
from rasterio.io import MemoryFile


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "pipeline" / "spatial_data"
STATE_NAMES = ["Haryana", "Punjab", "Uttar Pradesh"]
FEATURES = ["HCHO", "NDVI", "fire_count", "wind_u", "wind_v"]
TARGET_BAND = "tropospheric_HCHO_column_number_density"


def with_empty_image(collection, band_names):
    empty = ee.Image.constant([0] * len(band_names)).rename(band_names).updateMask(ee.Image.constant(0))
    return collection.merge(ee.ImageCollection([empty]))


def monthly_image(geometry, month_start):
    month_end = month_start.advance(1, "month")
    hcho_collection = (
        ee.ImageCollection("COPERNICUS/S5P/OFFL/L3_HCHO")
        .filterDate(month_start, month_end)
        .filterBounds(geometry)
        .map(lambda image: image.updateMask(image.select("cloud_fraction").lte(0.5)))
        .select(TARGET_BAND)
    )
    hcho = (
        with_empty_image(hcho_collection, [TARGET_BAND])
        .mean()
        .rename("HCHO")
        .resample("bilinear")
    )
    ndvi_collection = (
        ee.ImageCollection("MODIS/061/MOD13A2")
        .filterDate(month_start, month_end)
        .filterBounds(geometry)
        .select("NDVI")
    )
    ndvi = (
        with_empty_image(ndvi_collection, ["NDVI"])
        .mean()
        .multiply(0.0001)
        .rename("NDVI")
        .resample("bilinear")
    )
    fire_collection = (
        ee.ImageCollection("MODIS/061/MOD14A1")
        .filterDate(month_start, month_end)
        .filterBounds(geometry)
        .map(
            lambda image: image.select("FireMask")
            .gte(7)
            .And(image.select("FireMask").lte(9))
            .rename("fire_count")
        )
    )
    fire = with_empty_image(fire_collection, ["fire_count"]).sum()
    wind_collection = (
        ee.ImageCollection("ECMWF/ERA5_LAND/MONTHLY_AGGR")
        .filterDate(month_start, month_end)
        .filterBounds(geometry)
        .select(["u_component_of_wind_10m", "v_component_of_wind_10m"])
    )
    wind = (
        with_empty_image(wind_collection, ["u_component_of_wind_10m", "v_component_of_wind_10m"])
        .mean()
        .rename(["wind_u", "wind_v"])
        .resample("bilinear")
    )
    return hcho.addBands([ndvi, fire, wind]).select(FEATURES).clip(geometry)


def download_stack(image, geometry, scale, crs):
    region = geometry.bounds(maxError=1000).getInfo()["coordinates"]
    url = image.getDownloadURL(
        {"scale": scale, "crs": crs, "region": region, "format": "GEO_TIFF"}
    )
    for attempt in range(4):
        try:
            response = requests.get(url, timeout=(30, 240))
            response.raise_for_status()
            break
        except requests.exceptions.RequestException:
            if attempt == 3:
                raise
            time.sleep(2**attempt)
    content = BytesIO(response.content)
    if is_zipfile(content):
        with ZipFile(content) as archive:
            tif_names = [name for name in archive.namelist() if name.lower().endswith((".tif", ".tiff"))]
            if len(tif_names) != 1:
                raise RuntimeError(f"Expected one GeoTIFF in GEE response; found {tif_names}.")
            raster_bytes = archive.read(tif_names[0])
    else:
        raster_bytes = response.content

    with MemoryFile(raster_bytes) as memory_file:
        with memory_file.open() as dataset:
            return dataset.read(masked=True).filled(np.nan).astype(np.float32), dataset.transform


def collect_state(project, state_name, start, end, output, scale, crs):
    states = (
        ee.FeatureCollection("FAO/GAUL/2025/level1")
        .filter(ee.Filter.eq("GAUL0_NAME", "India"))
        .filter(ee.Filter.eq("GAUL1_NAME", state_name))
    )
    if states.size().getInfo() != 1:
        raise RuntimeError(f"Could not resolve exactly one GEE boundary for {state_name}.")
    geometry = ee.Feature(states.first()).geometry()
    months = pd.date_range(start=start, end=end, freq="MS", inclusive="left")
    chunks = []
    reference_transform = None
    reference_shape = None
    state_slug = state_name.lower().replace(" ", "_")
    checkpoint_dir = output / "yearly_stacks"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    for year in sorted(set(months.year)):
        year_months = [month for month in months if month.year == year]
        year_month_ids = np.asarray(
            [month.year * 12 + month.month - 1 for month in year_months], dtype=np.int32
        )
        checkpoint = checkpoint_dir / f"{state_slug}_{year}.npz"
        raster = None
        transform = None
        if checkpoint.exists():
            try:
                with np.load(checkpoint, allow_pickle=False) as saved:
                    saved_ids = saved["month_ids"]
                    saved_images = saved["images"]
                    saved_transform = saved["transform"]
                if np.array_equal(saved_ids, year_month_ids) and saved_images.shape == (
                    len(year_months),
                    *saved_images.shape[1:3],
                    len(FEATURES),
                ):
                    raster = saved_images
                    transform = rasterio.Affine(*saved_transform.astype(float).tolist())
                    print(f"Using checkpoint {state_name} {year}")
            except (OSError, ValueError, KeyError):
                raster = None

        if raster is None:
            image_list = []
            for month in year_months:
                month_start = ee.Date(month.strftime("%Y-%m-%d"))
                image = monthly_image(geometry, month_start)
                names = [f"{feature}_{month:%Y%m}" for feature in FEATURES]
                image_list.append(image.rename(names))
            stack = ee.Image.cat(image_list)
            raster, transform = download_stack(stack, geometry, scale, crs)
            if raster.shape[0] != len(year_months) * len(FEATURES):
                raise RuntimeError(
                    f"Unexpected band count for {state_name} {year}: {raster.shape[0]}"
                )
            raster = raster.reshape(len(year_months), len(FEATURES), *raster.shape[1:]).transpose(
                0, 2, 3, 1
            )
            np.savez_compressed(
                checkpoint,
                images=raster.astype(np.float16),
                month_ids=year_month_ids,
                transform=np.asarray(tuple(transform)[:6], dtype=np.float64),
            )
            print(f"Downloaded and checkpointed {state_name} {year}")
        if reference_shape is None:
            reference_shape = raster.shape[1:]
            reference_transform = transform
        elif raster.shape[1:] != reference_shape or transform != reference_transform:
            raise RuntimeError(f"GEE returned inconsistent grids for {state_name} in {year}.")
        chunks.append(raster)

    images = np.concatenate(chunks, axis=0)
    output.mkdir(parents=True, exist_ok=True)
    path = output / f"{state_slug}_monthly_patches.npz"
    np.savez_compressed(
        path,
        images=images.astype(np.float16),
        month_ids=(months.year.to_numpy() * 12 + months.month.to_numpy() - 1).astype(np.int32),
        feature_names=np.asarray(FEATURES),
        state=np.asarray(state_name),
        crs=np.asarray(crs),
        transform=np.asarray(tuple(reference_transform)[:6], dtype=np.float64),
    )
    print(f"Saved {len(months)} image dates, grid={images.shape[1:3]}, file={path}")
    return path


def assemble_state_checkpoints(state_name, start, end, output):
    months = pd.date_range(start=start, end=end, freq="MS", inclusive="left")
    state_slug = state_name.lower().replace(" ", "_")
    checkpoint_dir = output / "yearly_stacks"
    chunks = []
    reference_shape = None
    reference_transform = None
    for year in sorted(set(months.year)):
        expected_months = [month for month in months if month.year == year]
        expected_ids = np.asarray(
            [month.year * 12 + month.month - 1 for month in expected_months], dtype=np.int32
        )
        checkpoint = checkpoint_dir / f"{state_slug}_{year}.npz"
        if not checkpoint.exists():
            raise FileNotFoundError(f"Missing GEE raster checkpoint: {checkpoint}")
        with np.load(checkpoint, allow_pickle=False) as saved:
            month_ids = saved["month_ids"]
            images = saved["images"].astype(np.float32)
            transform = rasterio.Affine(*saved["transform"].astype(float).tolist())
        if not np.array_equal(month_ids, expected_ids):
            raise ValueError(f"Date range mismatch in checkpoint {checkpoint}.")
        if images.ndim != 4 or images.shape[0] != len(expected_months) or images.shape[-1] != len(FEATURES):
            raise ValueError(f"Unexpected image shape {images.shape} in checkpoint {checkpoint}.")
        if reference_shape is None:
            reference_shape = images.shape[1:]
            reference_transform = transform
        elif images.shape[1:] != reference_shape or transform != reference_transform:
            raise ValueError(f"Raster grid mismatch in checkpoint {checkpoint}.")
        chunks.append(images)

    images = np.concatenate(chunks, axis=0)
    month_ids = np.asarray([month.year * 12 + month.month - 1 for month in months], dtype=np.int32)
    path = output / f"{state_slug}_monthly_patches.npz"
    np.savez_compressed(
        path,
        images=images.astype(np.float16),
        month_ids=month_ids,
        feature_names=np.asarray(FEATURES),
        state=np.asarray(state_name),
        crs=np.asarray("EPSG:3857"),
        transform=np.asarray(tuple(reference_transform)[:6], dtype=np.float64),
    )
    print(f"Assembled {state_name}: {len(month_ids)} months, grid={images.shape[1:3]}, file={path}")
    return path


def main():
    parser = argparse.ArgumentParser(description="Export monthly GEE raster stacks for spatial patches.")
    parser.add_argument("--project", required=True, help="Google Cloud project enabled for Earth Engine")
    parser.add_argument("--start", type=date.fromisoformat, default=date(2018, 10, 1))
    parser.add_argument("--end", type=date.fromisoformat, default=date.today().replace(day=1))
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--scale", type=int, default=5000)
    parser.add_argument("--crs", default="EPSG:3857")
    args = parser.parse_args()
    if args.start.day != 1 or args.end.day != 1 or args.end <= args.start:
        parser.error("--start and --end must be month starts, and --end must follow --start.")

    ee.Initialize(project=args.project)
    for state_name in STATE_NAMES:
        collect_state(args.project, state_name, args.start, args.end, args.output_dir, args.scale, args.crs)


if __name__ == "__main__":
    main()