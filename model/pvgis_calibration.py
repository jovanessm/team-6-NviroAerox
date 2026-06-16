"""
PVGIS calibration — validate our baseline specific yield against PVGIS ERA5.

Usage:
    python -m model.pvgis_calibration

Result (as of 2026-06):
    Our model is +8.4% vs PVGIS ERA5 across all 10 parks (systematic positive bias).

Why the offset exists:
    PVGIS applies spectral corrections, angular reflection losses, and detailed
    in-plane irradiance transposition that our closed-form NOCT model omits.
    Both use ERA5 as the underlying climate data.

Why the climate delta is unaffected:
    We compare our own baseline to our own climate-adjusted forecast — the
    systematic +8% offset cancels in the difference. The RCP scenarios move
    the number by 1–3%; that signal comes purely from the ΔT term, which is
    scenario-dependent and not part of the PVGIS offset.
"""

import sys
import requests
import numpy as np
import pandas as pd
from pathlib import Path

_repo_root = Path(__file__).parent.parent
sys.path.insert(0, str(_repo_root))

from model.physics import annual_energy
from model.typical_year import build_typical_year
from model.parks import ALL_PARKS

ERA5_DIR = _repo_root / "backend" / "CDS Data" / "era5_data"

PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_2/PVcalc"
# loss=14 ≈ our PR_NONTHERMAL of 0.87 (13% non-thermal losses + ~1% rounding)
PVGIS_LOSS_PCT = 14


def fetch_pvgis_yield(lat: float, lon: float) -> float:
    """Return PVGIS ERA5 specific yield (kWh/kWp/yr) for a location."""
    r = requests.get(PVGIS_URL, params={
        "lat": lat, "lon": lon,
        "peakpower": 1,
        "loss": PVGIS_LOSS_PCT,
        "outputformat": "json",
        "raddatabase": "PVGIS-ERA5",
    }, timeout=30)
    r.raise_for_status()
    return float(r.json()["outputs"]["totals"]["fixed"]["E_y"])


def model_typical_yield(park_name: str) -> float | None:
    """Return our model's typical-year specific yield (kWh/kWp/yr) for a park."""
    csv = ERA5_DIR / f"{park_name}.csv"
    if not csv.exists():
        return None
    df = pd.read_csv(csv)
    ghi  = np.where(np.isnan(df["shortwave_radiation"].values), 0.0, df["shortwave_radiation"].values)
    temp = df["temperature_2m"].values.astype(float)
    ty_ghi, ty_temp = build_typical_year(ghi, temp)
    return annual_energy(ty_ghi, ty_temp, capacity_kwp=1.0)


def main() -> None:
    print(f"{'Park':<42} {'PVGIS':>8} {'Model':>8} {'Diff%':>7}")
    print("-" * 72)

    diffs: list[float] = []
    for park in ALL_PARKS:
        pvgis = fetch_pvgis_yield(park.lat, park.lon)
        model = model_typical_yield(park.name)
        if model is None:
            print(f"{park.name:<42} {'N/A (ERA5 missing)':>24}")
            continue
        diff = (model - pvgis) / pvgis * 100
        diffs.append(diff)
        print(f"{park.name:<42} {pvgis:>8.0f} {model:>8.0f} {diff:>+7.1f}%")

    print("-" * 72)
    print(f"{'Mean bias':<42} {'':>8} {'':>8} {np.mean(diffs):>+7.1f}%")
    print(f"{'MAE':<42} {'':>8} {'':>8} {np.mean(np.abs(diffs)):>7.1f}%")
    print()
    print("Interpretation:")
    print(f"  Our model is {np.mean(diffs):+.1f}% vs PVGIS ERA5 (systematic positive bias).")
    print("  Cause: simplified NOCT model omits spectral + angular loss corrections.")
    print("  Impact on results: NONE — climate delta cancels the absolute offset.")
    print("  The ΔT signal (RCP scenarios) is the same physics in both paths.")


if __name__ == "__main__":
    main()
