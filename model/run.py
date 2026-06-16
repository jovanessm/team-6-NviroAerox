"""
Full end-to-end run: real ERA5 baseline + CMIP6 ensemble → simulate() → print.

Usage:
    python -m model.run
    python -m model.run --model faiman
    python -m model.run --model both      # side-by-side comparison
"""

import sys
import json
import argparse
import numpy as np
import pandas as pd
from pathlib import Path

from model.data import ParkSpecs, BaselineWeather
from model.cmip6 import fetch_ensemble_annual, build_all_scenarios_cmip6, heat_tail_from_deltas
from model.montecarlo import simulate
from model.config import LIFETIME_YEARS
from model.parks import PARKS_BY_NAME

ERA5_CSV    = Path("backend/CDS Data/era5_data/Eggebek_Solar_Park.csv")
CMIP6_CACHE = Path("backend/cmip6_cache/Eggebek_Solar_Park.json")
WIND_SPEED_JSON = Path("backend/GRW Data/wind_speed.json")
PARK = PARKS_BY_NAME["Eggebek_Solar_Park"]


def load_baseline(csv_path: Path, mean_wind_speed: float = 4.0) -> BaselineWeather:
    df = pd.read_csv(csv_path)
    ghi  = df["shortwave_radiation"].values.astype(float)
    temp = df["temperature_2m"].values.astype(float)
    ghi  = np.where(np.isnan(ghi),  0,                 ghi)
    temp = np.where(np.isnan(temp), np.nanmean(temp),  temp)
    return BaselineWeather(ghi=ghi, temp_amb=temp, mean_wind_speed=mean_wind_speed)


def load_wind_speed(park_name: str) -> float:
    if not WIND_SPEED_JSON.exists():
        print(f"  wind_speed.json not found — using default 4.0 m/s")
        print(f"  Run: python 'backend/GRW Data/fetch_wind_speed.py'")
        return 4.0
    with open(WIND_SPEED_JSON) as f:
        speeds = json.load(f)
    speed = speeds.get(park_name, 4.0)
    print(f"  ERA5 mean wind_speed_10m: {speed:.2f} m/s  (from wind_speed.json)")
    return speed


def run_scenario(park, baseline, scenarios, use_faiman: bool, label: str):
    model_tag = "faiman" if use_faiman else "noct"
    print(f"\n{'─'*50}")
    print(f"Model: {label}  [{model_tag}]")
    if use_faiman:
        eff = baseline.mean_wind_speed * park.wind_exposure
        print(f"  wind_exposure={park.wind_exposure}  ×  {baseline.mean_wind_speed:.2f} m/s  =  {eff:.2f} m/s effective")
    print(f"{'─'*50}")

    results = {}
    for scenario_name, deltas in scenarios.items():
        print(f"\nRunning simulate() — {scenario_name} ...")
        pred = simulate(
            park, baseline, deltas,
            n_draws=3000,
            heat_tail_series=heat_tail_from_deltas(deltas),
            use_faiman=use_faiman,
        )
        results[scenario_name] = pred

        baseline_gwh = np.sum(pred.baseline_annual) / 1e6
        print(f"  Baseline lifetime:    {baseline_gwh:.1f} GWh")
        print(f"  Climate-adj P50:      {pred.lifetime_p50/1e6:.1f} GWh  ({pred.delta_pct:+.2f}%)")
        print(f"  Climate-adj P90:      {np.sum(pred.p90)/1e6:.1f} GWh")

    return results


def main():
    parser = argparse.ArgumentParser(description="Dev run: ERA5 + CMIP6 → simulate() for one park.")
    parser.add_argument(
        "--model", choices=["noct", "faiman", "both"], default="noct",
        help="Cell temperature model (default: noct)",
    )
    args = parser.parse_args()

    if not ERA5_CSV.exists():
        print(f"ERA5 data not found at {ERA5_CSV}. Run the fetch script first.")
        sys.exit(1)

    # ── Load baseline ──────────────────────────────────────────────────────────
    mean_wind = load_wind_speed(PARK.name) if args.model in ("faiman", "both") else 4.0
    baseline  = load_baseline(ERA5_CSV, mean_wind_speed=mean_wind)

    print(f"ERA5: {len(baseline.ghi):,} hours ({len(baseline.ghi)/8760:.1f} years)")
    print(f"Mean temp: {np.mean(baseline.temp_amb):.1f}°C")

    # ── CMIP6 scenarios ────────────────────────────────────────────────────────
    print("\nFetching CMIP6 7-model ensemble (Open-Meteo HighResMIP)...")
    ensemble  = fetch_ensemble_annual(PARK.lat, PARK.lon, CMIP6_CACHE)
    scenarios = build_all_scenarios_cmip6(ensemble, n_years=LIFETIME_YEARS)
    print(f"  {len(ensemble)} models")
    for name, d in scenarios.items():
        print(f"  {name}: 30yr warming +{d.dT_per_year[-1]:.2f} ± {d.dT_model_std[-1]:.2f}°C")

    # ── Simulate ───────────────────────────────────────────────────────────────
    print(f"\nPark: {PARK.name}  ({PARK.capacity_kwp/1000:.0f} MWp)")

    if args.model == "both":
        noct_results   = run_scenario(PARK, baseline, scenarios, use_faiman=False, label="Standard NOCT")
        faiman_results = run_scenario(PARK, baseline, scenarios, use_faiman=True,  label="Satellite-Enhanced Faiman")

        print(f"\n{'='*50}")
        print("Side-by-side comparison (lifetime delta %)")
        print(f"{'='*50}")
        print(f"  {'Scenario':<10}  {'NOCT':>8}  {'Faiman':>8}  {'Δ (Faiman−NOCT)':>16}")
        print(f"  {'-'*46}")
        for name in scenarios:
            n = noct_results[name].delta_pct
            f = faiman_results[name].delta_pct
            print(f"  {name:<10}  {n:>+8.2f}%  {f:>+8.2f}%  {f-n:>+15.2f}%")

        print(f"\n  Baseline lifetime GWh (NOCT vs Faiman):")
        for name in scenarios:
            nb = np.sum(noct_results[name].baseline_annual) / 1e6
            fb = np.sum(faiman_results[name].baseline_annual) / 1e6
            print(f"  {name:<10}  NOCT {nb:.1f} GWh  →  Faiman {fb:.1f} GWh  ({(fb-nb)/nb*100:+.1f}%)")

    else:
        use_faiman = args.model == "faiman"
        results = run_scenario(PARK, baseline, scenarios, use_faiman=use_faiman,
                               label="Standard NOCT" if not use_faiman else "Satellite-Enhanced Faiman")

        print(f"\n{'='*50}")
        for name, pred in results.items():
            print(f"  {name}:  delta = {pred.delta_pct:+.2f}%")


if __name__ == "__main__":
    main()
