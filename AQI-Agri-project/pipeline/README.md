# GEE data collection and CNN-LSTM training

This pipeline collects monthly state-level HCHO and environmental features from Google Earth Engine (GEE), then trains a temporal Conv1D-LSTM to predict whether next month's HCHO is unusually high. It uses the existing project scope: Haryana, Punjab, and Uttar Pradesh. Collection starts in October 2018, when Sentinel-5P HCHO observations are available, and ends at the latest complete month.

## Data sources

- `COPERNICUS/S5P/OFFL/L3_HCHO`: cloud-screened tropospheric HCHO column density (`cloud_fraction <= 0.5`).
- `MODIS/061/MOD13A2`: scaled monthly NDVI.
- `MODIS/061/MOD14A1`: monthly average of active-fire detections per pixel from FireMask classes 7-9. This is an indicator, not a count of unique fire incidents.
- `ECMWF/ERA5_LAND/MONTHLY_AGGR`: 10 m eastward and northward wind components.

The tabular collector writes one row per state-month to `frontend/public/data/gee_monthly_state_data.csv`; existing source and prediction CSVs are not overwritten.

## Setup and run

Use Python 3.10 or newer. Install dependencies and authenticate Earth Engine locally with a Google Cloud project that has the Earth Engine API enabled:

```powershell
cd pipeline
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
earthengine authenticate --project YOUR_GEE_CLOUD_PROJECT_ID
python gee_collect.py --project YOUR_GEE_CLOUD_PROJECT_ID
python train_cnn_lstm.py
```

For repeatable collection, pass explicit month-start boundaries, for example `--start 2018-10-01 --end 2026-09-01`. The end is exclusive, so this includes data through August 2026.

## Model and interpretation

Each sample uses the previous 12 consecutive monthly rows and predicts the following month's hotspot proxy. A 1D convolution extracts local temporal patterns, followed by an LSTM. Splits are chronological (70% train, 15% validation, 15% test); scaling is fit only on training sequences.

The original repository describes `HCHO_hotspot` as an exploratory derived label but does not provide its calculation rule. To make new training reproducible, this pipeline defines a proxy as HCHO at or above the state-specific 90th percentile calculated from the training period only. This proxy is not verified crop damage and is not guaranteed to match the existing label.

Training writes the Keras model, scaler values, test predictions, next-month predictions, and metrics to `pipeline/artifacts/`. The scripts do not update the dashboard's existing prediction file automatically.

## Spatial image patches

To retain spatial information rather than reduce each state to a single average, export monthly 5-band GeoTIFF grids at 5 km resolution and train a Conv2D-LSTM on 32x32 patches. The exporter writes one compressed raster stack per state under `pipeline/spatial_data/`:

```powershell
python gee_export_patches.py --project YOUR_GEE_CLOUD_PROJECT_ID
python train_spatial_cnn_lstm.py
```

The spatial model uses each patch's previous 12 monthly rasters and predicts whether the following month's patch-mean HCHO exceeds that state's training-period 90th percentile. It defaults to at most 12 high-coverage patches per state with 50% overlap. Model, scaler, metrics, test predictions, and next-month patch forecasts are written to `pipeline/spatial_artifacts/`; these outputs are separate from the original state-level dashboard predictions. They remain exploratory HCHO indicators, not verified crop-damage labels.