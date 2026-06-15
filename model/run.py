"""
Full end-to-end run: real ERA5 data + EnviroTrust API → simulate() → print results.

Usage:
    python -m model.run
"""

import sys
import os
import numpy as np
import pandas as pd
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from model.data import ParkSpecs, BaselineWeather
from model.adapters import compute_baseline_temp, build_all_scenarios, wildfire_to_heat_tail
from model.montecarlo import simulate
from model.config import LIFETIME_YEARS

ERA5_CSV = Path("backend/CDS Data/era5_data/Buergerwindpark_Reussenkoge.csv")

EGGEBEK = ParkSpecs(
    name="Eggebek_Solar_Park",
    lat=54.629,
    lon=9.343,
    capacity_kwp=83_600.0,
    gamma=-0.0045,   # Trina Solar TSM-PC05 datasheet
    noct_c=45.0,
    tilt=20.0,
    azimuth=180.0,
    commissioned=2011,
)


def load_baseline(csv_path: Path) -> BaselineWeather:
    df = pd.read_csv(csv_path)
    ghi = df["shortwave_radiation"].values.astype(float)
    temp = df["temperature_2m"].values.astype(float)
    ghi = np.where(np.isnan(ghi), 0, ghi)
    temp = np.where(np.isnan(temp), np.nanmean(temp), temp)
    return BaselineWeather(ghi=ghi, temp_amb=temp)


def main():
    if not ERA5_CSV.exists():
        print(f"ERA5 data not found at {ERA5_CSV}. Run the fetch script first.")
        sys.exit(1)

    print("Loading ERA5 baseline weather...")
    baseline = load_baseline(ERA5_CSV)
    baseline_temp_c = compute_baseline_temp(str(ERA5_CSV))
    print(f"  {len(baseline.ghi):,} hours ({len(baseline.ghi)/8760:.1f} years)")
    print(f"  Mean temp: {baseline_temp_c:.1f}°C")
    print()

    print("Fetching EnviroTrust climate projections...")
    from EnviroTrustAPI.client import EnviroTrustClient
    client = EnviroTrustClient()
    lat, lon = EGGEBEK.lat, EGGEBEK.lon

    timeseries = client.get_heat_wind_timeseries(lat, lon, 2024, 2054)["heat_wind_timeseries_data"]
    wildfire = client.get_wildfire_timeseries(lat, lon, 2024, 2054)["wildfire_risk_timeseries_data"]
    try:
        risk = client.get_climate_risk_score(lat, lon)
        heat_risk = risk["scores"]["heat_risk"]
    except Exception:
        heat_risk = "unavailable"

    n_years = len(timeseries)
    print(f"  {n_years} years of projections (2024–2054)")
    print(f"  Heat risk score: {heat_risk}")
    print()

    print("Building climate deltas from API...")
    scenarios = build_all_scenarios(timeseries, baseline_temp_c)
    heat_tail_series = wildfire_to_heat_tail(wildfire, n_years)
    print(f"  Scenarios: {list(scenarios.keys())}")
    print(f"  Max heat-tail dT: {heat_tail_series.max():.2f}°C")
    print()

    results = {}
    for scenario_name, deltas in scenarios.items():
        print(f"Running simulate() — {scenario_name} ...")
        pred = simulate(
            EGGEBEK,
            baseline,
            deltas,
            n_draws=3000,
            heat_tail_series=heat_tail_series,
        )
        results[scenario_name] = pred

        lifetime_gwh = pred.lifetime_p50 / 1e6
        baseline_gwh = np.sum(pred.baseline_annual) / 1e6
        print(f"  Baseline lifetime:        {baseline_gwh:.1f} GWh")
        print(f"  Climate-adjusted P50:     {lifetime_gwh:.1f} GWh  ({pred.delta_pct:+.2f}%)")
        print(f"  Climate-adjusted P90:     {np.sum(pred.p90)/1e6:.1f} GWh  ({(np.sum(pred.p90) - np.sum(pred.baseline_annual)) / np.sum(pred.baseline_annual) * 100:+.2f}%)")
        print()

    print("=" * 50)
    print(f"Park: {EGGEBEK.name}  ({EGGEBEK.capacity_kwp/1000:.0f} MWp)")
    print(f"Heat risk score: {heat_risk}/10")
    print()
    for name, pred in results.items():
        print(f"  {name}:  delta = {pred.delta_pct:+.2f}%")


if __name__ == "__main__":
    main()
