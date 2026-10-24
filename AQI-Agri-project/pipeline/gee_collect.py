import argparse
from datetime import date
from pathlib import Path

import ee
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "frontend" / "public" / "data" / "gee_monthly_state_data.csv"
STATE_NAMES = ["Haryana", "Punjab", "Uttar Pradesh"]


def current_month_start(today: date) -> date:
    return today.replace(day=1)


def collect_monthly(project: str, start: date, end: date) -> pd.DataFrame:
    ee.Initialize(project=project)
    states = (
        ee.FeatureCollection("FAO/GAUL/2025/level1")
        .filter(ee.Filter.eq("GAUL0_NAME", "India"))
        .filter(ee.Filter.inList("GAUL1_NAME", STATE_NAMES))
    )
    matched = states.aggregate_array("GAUL1_NAME").distinct().getInfo()
    if set(matched or []) != set(STATE_NAMES):
        raise RuntimeError(f"Expected all three states in GAUL boundaries; found {matched}.")

    month_count = (end.year - start.year) * 12 + end.month - start.month
    offsets = ee.List.sequence(0, month_count - 1)
    state_list = states.toList(states.size())

    def state_month(state_feature, month_offset):
        state_feature = ee.Feature(state_feature)
        offset = ee.Number(month_offset)
        month_start = ee.Date(start.isoformat()).advance(offset, "month")
        month_end = month_start.advance(1, "month")
        geometry = state_feature.geometry()

        hcho = (
            ee.ImageCollection("COPERNICUS/S5P/OFFL/L3_HCHO")
            .filterDate(month_start, month_end)
            .filterBounds(geometry)
            .map(lambda image: image.updateMask(image.select("cloud_fraction").lte(0.5)))
            .select("tropospheric_HCHO_column_number_density")
            .mean()
            .rename("HCHO")
        )
        ndvi = (
            ee.ImageCollection("MODIS/061/MOD13A2")
            .filterDate(month_start, month_end)
            .filterBounds(geometry)
            .select("NDVI")
            .mean()
            .multiply(0.0001)
            .rename("NDVI")
        )
        fire = (
            ee.ImageCollection("MODIS/061/MOD14A1")
            .filterDate(month_start, month_end)
            .filterBounds(geometry)
            .map(
                lambda image: image.select("FireMask")
                .gte(7)
                .And(image.select("FireMask").lte(9))
                .rename("fire_count")
            )
            .sum()
        )
        wind = (
            ee.ImageCollection("ECMWF/ERA5_LAND/MONTHLY_AGGR")
            .filterDate(month_start, month_end)
            .filterBounds(geometry)
            .select(["u_component_of_wind_10m", "v_component_of_wind_10m"])
            .mean()
            .rename(["wind_u", "wind_v"])
        )
        image = hcho.addBands([ndvi, fire, wind])
        values = image.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geometry,
            scale=10000,
            bestEffort=True,
            maxPixels=1e13,
        )
        return ee.Feature(
            None,
            values.set("state", state_feature.get("GAUL1_NAME"))
            .set("year", month_start.get("year"))
            .set("month", month_start.get("month")),
        )

    def collect_state(state_feature):
        return ee.FeatureCollection(offsets.map(lambda offset: state_month(state_feature, offset)))

    features = ee.FeatureCollection(state_list.map(collect_state)).flatten()
    payload = features.getInfo()
    rows = [feature["properties"] for feature in payload["features"]]
    frame = pd.DataFrame(rows)
    frame["wind_speed"] = (frame["wind_u"] ** 2 + frame["wind_v"] ** 2) ** 0.5
    frame["NDVI_observed"] = frame["NDVI"].notna().astype(int)
    return frame.sort_values(["state", "year", "month"]).reset_index(drop=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect monthly HCHO/environment data from GEE.")
    parser.add_argument("--project", required=True, help="Google Cloud project enabled for Earth Engine")
    parser.add_argument("--start", type=date.fromisoformat, default=date(2018, 10, 1))
    parser.add_argument("--end", type=date.fromisoformat, default=current_month_start(date.today()))
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    if args.start.day != 1 or args.end.day != 1 or args.end <= args.start:
        parser.error("--start and --end must be month starts, and --end must follow --start.")

    data = collect_monthly(args.project, args.start, args.end)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    data.to_csv(args.output, index=False)
    print(f"Saved {len(data)} state-month records to {args.output}")
    print(data.groupby("state").size().to_string())


if __name__ == "__main__":
    main()