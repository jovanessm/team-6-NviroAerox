"""
Pre-compute simulation results for all solar parks.

Runs simulate() for all parks × RCP2.6 / RCP4.5 / RCP8.5 and saves one JSON file
to backend/precomputed.json so the API can serve results instantly.

ΔT signal comes from the CMIP6 7-model ensemble (Open-Meteo HighResMIP, cached
to backend/cmip6_cache/). ERA5 provides the baseline weather. The EnviroTrust
daily-max-temp and wildfire fields are NOT used — both are annual extremes with
no usable trend (see model/cmip6.py).

Usage:
    python -m model.precompute
    python -m model.precompute --output path/to/output.json
    python -m model.precompute --dry-run   # validate ERA5 + CMIP6 without full MC
"""

import sys
import json
import time
import argparse
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime, timezone

# Allow both `python -m model.precompute` and `python model/precompute.py`
_repo_root = Path(__file__).parent.parent
sys.path.insert(0, str(_repo_root))
sys.path.insert(0, str(_repo_root / "backend"))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / "backend" / ".env")

from model.parks import ALL_PARKS
from model.data import ParkSpecs, BaselineWeather
from model.cmip6 import fetch_ensemble_annual, build_all_scenarios_cmip6, heat_tail_from_deltas
from model.montecarlo import simulate
from model.finance import energy_to_revenue, format_for_ui
from model.config import LIFETIME_YEARS

ERA5_DIR = Path(__file__).parent.parent / "backend" / "CDS Data" / "era5_data"
DEFAULT_OUTPUT = Path(__file__).parent.parent / "backend" / "precomputed.json"
FAIMAN_OUTPUT = Path(__file__).parent.parent / "backend" / "precomputed_faiman.json"
CMIP6_CACHE_DIR = Path(__file__).parent.parent / "backend" / "cmip6_cache"
GRW_DIR = Path(__file__).parent.parent / "backend" / "GRW Data"


def load_baseline(park_name: str, mean_wind_speed: float = 4.0) -> BaselineWeather | None:
    csv_path = ERA5_DIR / f"{park_name}.csv"
    if not csv_path.exists():
        return None
    df = pd.read_csv(csv_path)
    ghi = df["shortwave_radiation"].values.astype(float)
    temp = df["temperature_2m"].values.astype(float)
    ghi = np.where(np.isnan(ghi), 0.0, ghi)
    temp = np.where(np.isnan(temp), np.nanmean(temp), temp)
    return BaselineWeather(ghi=ghi, temp_amb=temp, mean_wind_speed=mean_wind_speed)


def load_wind_speeds() -> dict[str, float]:
    """Load ERA5 mean wind speeds fetched by backend/GRW Data/fetch_wind_speed.py."""
    path = GRW_DIR / "wind_speed.json"
    if not path.exists():
        return {}
    with open(path) as f:
        return json.load(f)


def park_to_dict(park: ParkSpecs) -> dict:
    return {
        "id": park.name,
        "name": park.name.replace("_", " "),
        "lat": park.lat,
        "lon": park.lon,
        "capacity_kwp": park.capacity_kwp,
        "commissioned": park.commissioned,
        "tilt": park.tilt,
        "azimuth": park.azimuth,
    }


def prediction_to_dict(pred, finance: dict) -> dict:
    return {
        "years": pred.years.tolist(),
        "baseline_annual_kwh": [round(v) for v in pred.baseline_annual.tolist()],
        "p10_kwh": [round(v) for v in pred.p10.tolist()],
        "p50_kwh": [round(v) for v in pred.p50.tolist()],
        "p90_kwh": [round(v) for v in pred.p90.tolist()],
        "lifetime_baseline_kwh": round(float(np.sum(pred.baseline_annual))),
        "lifetime_p50_kwh": round(pred.lifetime_p50),
        "lifetime_p90_kwh": round(pred.lifetime_p90),
        "delta_pct": round(pred.delta_pct, 3),
        "finance": finance,
        "provenance": pred.provenance,
    }


def run(output_path: Path, dry_run: bool = False, n_draws: int = 3000, use_faiman: bool = False) -> None:
    wind_speeds = load_wind_speeds() if use_faiman else {}
    if use_faiman:
        if not wind_speeds:
            print("WARNING: no wind_speed.json found — using default 4.0 m/s for all parks")
            print(f"  Run: python 'backend/GRW Data/fetch_wind_speed.py'")
        else:
            print(f"Faiman model: wind speeds loaded for {len(wind_speeds)} parks from GRW Data/wind_speed.json")

    # Resume: load existing output and keep already-computed parks
    existing: dict[str, dict] = {}
    if output_path.exists():
        with open(output_path) as f:
            prev = json.load(f)
        existing = {p["id"]: p for p in prev.get("parks", [])}
        if existing:
            print(f"Resuming — {len(existing)} parks already in {output_path.name}")

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "n_draws": n_draws,
        "parks": list(existing.values()),
    }

    skipped = []

    for i, park in enumerate(ALL_PARKS, 1):
        print(f"\n[{i}/{len(ALL_PARKS)}] {park.name}")

        if park.name in existing:
            print(f"  SKIP — already computed")
            continue

        mean_wind = wind_speeds.get(park.name, 4.0)
        baseline = load_baseline(park.name, mean_wind_speed=mean_wind)
        if baseline is None:
            print(f"  SKIP — no ERA5 CSV in {ERA5_DIR}")
            skipped.append(park.name)
            continue

        n_hours = len(baseline.ghi)
        mean_temp = float(np.mean(baseline.temp_amb))
        print(f"  ERA5: {n_hours:,} hours ({n_hours/8760:.1f} yr), mean temp {mean_temp:.1f}°C")

        # CMIP6 7-model ensemble (Open-Meteo HighResMIP) → ΔT signal + model spread
        cache_path = CMIP6_CACHE_DIR / f"{park.name}.json"
        try:
            ensemble = fetch_ensemble_annual(park.lat, park.lon, cache_path)
        except Exception as e:
            print(f"  SKIP — CMIP6 fetch error: {e}")
            skipped.append(park.name)
            continue
        if len(ensemble) < 3:
            print(f"  SKIP — only {len(ensemble)} CMIP6 models returned")
            skipped.append(park.name)
            continue
        if not cache_path.exists():
            time.sleep(3)  # be polite to the API on a fresh fetch

        scenarios = build_all_scenarios_cmip6(ensemble, n_years=LIFETIME_YEARS)
        warming = {n: d.dT_per_year[-1] for n, d in scenarios.items()}
        print(f"  CMIP6: {len(ensemble)} models, 30yr warming "
              f"RCP2.6={warming['RCP2.6']:+.2f} RCP4.5={warming['RCP4.5']:+.2f} RCP8.5={warming['RCP8.5']:+.2f}°C")

        if dry_run:
            print(f"  DRY RUN — skipping simulate() ({LIFETIME_YEARS} years, {list(scenarios.keys())})")
            continue

        park_entry = {**park_to_dict(park), "scenarios": {}}

        for scenario_name, deltas in scenarios.items():
            heat_tail_series = heat_tail_from_deltas(deltas)
            model_label = "faiman" if use_faiman else "noct"
            print(f"  simulate() {scenario_name} [{model_label}] ({n_draws} draws)...", end=" ", flush=True)
            pred = simulate(park, baseline, deltas, n_draws=n_draws,
                            heat_tail_series=heat_tail_series, use_faiman=use_faiman)
            rev = energy_to_revenue(pred)
            finance = format_for_ui(rev)
            park_entry["scenarios"][scenario_name] = prediction_to_dict(pred, finance)
            print(f"delta={pred.delta_pct:+.2f}%  P50={pred.lifetime_p50/1e6:.1f} GWh")

        output["parks"].append(park_entry)

    if not dry_run:
        # Derive risk_score 0–10 from RCP8.5 delta_pct across all computed parks.
        # Larger absolute loss → higher risk. Normalized so the worst park = 10.
        parks_with_rcp85 = [p for p in output["parks"] if "RCP8.5" in p.get("scenarios", {})]
        if len(parks_with_rcp85) >= 2:
            deltas = [abs(p["scenarios"]["RCP8.5"]["delta_pct"]) for p in parks_with_rcp85]
            min_d, max_d = min(deltas), max(deltas)
            denom = max_d - min_d if max_d > min_d else 1.0
            for park, d in zip(parks_with_rcp85, deltas):
                park["risk_score"] = round(10 * (d - min_d) / denom, 1)
        elif len(parks_with_rcp85) == 1:
            parks_with_rcp85[0]["risk_score"] = 5.0  # single park: mid-range placeholder

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(output, f, indent=2)
        size_kb = output_path.stat().st_size / 1024
        print(f"\nSaved {len(output['parks'])} parks → {output_path} ({size_kb:.0f} KB)")

    if skipped:
        print(f"\nSkipped ({len(skipped)}): {', '.join(skipped)}")


def main():
    parser = argparse.ArgumentParser(description="Pre-compute solar park simulations.")
    parser.add_argument("--output", type=Path, default=None,
                        help="Output JSON path (default: precomputed.json or precomputed_faiman.json)")
    parser.add_argument("--model", choices=["noct", "faiman"], default="noct",
                        help="Cell temperature model: noct (default) or faiman (requires wind data)")
    parser.add_argument("--dry-run", action="store_true", help="Validate data without running MC")
    parser.add_argument("--draws", type=int, default=3000, help="MC draws per scenario (default 3000)")
    args = parser.parse_args()

    use_faiman = args.model == "faiman"
    output_path = args.output or (FAIMAN_OUTPUT if use_faiman else DEFAULT_OUTPUT)
    run(output_path, dry_run=args.dry_run, n_draws=args.draws, use_faiman=use_faiman)


if __name__ == "__main__":
    main()
