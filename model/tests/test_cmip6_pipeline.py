"""
Integration test: CMIP6 ensemble → ClimateDeltas → simulate().

Uses the cached CMIP6 ensemble (backend/cmip6_cache/) + ERA5 baseline. Skips if
neither the cache nor network is available.
"""

import sys
import os
import numpy as np
import pytest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../backend"))

from model.cmip6 import (
    fetch_ensemble_annual,
    build_all_scenarios_cmip6,
    heat_tail_from_deltas,
)
from model.montecarlo import simulate
from model.data import ParkSpecs, BaselineWeather

EGGEBEK = ParkSpecs(
    name="Eggebek_Solar_Park",
    lat=54.629, lon=9.343,
    capacity_kwp=16_588.39,
    gamma=-0.0045, noct_c=45.0,
    tilt=12.0, azimuth=180.0, commissioned=2025,
)

ERA5_CSV = Path("backend/CDS Data/era5_data/Eggebek_Solar_Park.csv")
CMIP6_CACHE = Path("backend/cmip6_cache/Eggebek_Solar_Park.json")


def load_baseline() -> BaselineWeather:
    import pandas as pd
    df = pd.read_csv(ERA5_CSV)
    ghi = np.where(np.isnan(df["shortwave_radiation"].values), 0, df["shortwave_radiation"].values)
    temp = df["temperature_2m"].values
    temp = np.where(np.isnan(temp), np.nanmean(temp), temp)
    return BaselineWeather(ghi=ghi.astype(float), temp_amb=temp.astype(float))


@pytest.mark.skipif(not ERA5_CSV.exists(), reason="ERA5 CSV not fetched")
@pytest.mark.skipif(not CMIP6_CACHE.exists(), reason="CMIP6 ensemble not cached")
def test_full_pipeline_cmip6():
    """CMIP6 ensemble → three scenarios → simulate(), with correct sign + ordering."""
    ensemble = fetch_ensemble_annual(EGGEBEK.lat, EGGEBEK.lon, CMIP6_CACHE)
    assert len(ensemble) >= 3, "expected at least 3 CMIP6 models"

    scenarios = build_all_scenarios_cmip6(ensemble, n_years=30)
    assert set(scenarios) == {"RCP2.6", "RCP4.5", "RCP8.5"}

    # Warming must be positive and ordered RCP2.6 < RCP4.5 < RCP8.5
    w26 = scenarios["RCP2.6"].dT_per_year[-1]
    w45 = scenarios["RCP4.5"].dT_per_year[-1]
    w85 = scenarios["RCP8.5"].dT_per_year[-1]
    assert 0 < w26 < w45 < w85, f"warming not ordered: {w26:.2f} {w45:.2f} {w85:.2f}"

    baseline = load_baseline()

    results = {}
    for name, deltas in scenarios.items():
        pred = simulate(
            EGGEBEK, baseline, deltas,
            n_draws=2000,
            heat_tail_series=heat_tail_from_deltas(deltas),
        )
        results[name] = pred

        assert len(pred.years) == 30
        assert np.all(pred.p10 <= pred.p50), f"{name}: P10 > P50"
        assert np.all(pred.p50 <= pred.p90), f"{name}: P50 > P90"
        # With common random numbers + real warming, the climate delta is a small
        # but correctly-signed loss (mean temp derating + Arrhenius + heat-tail).
        assert -5 < pred.delta_pct < 0, f"{name}: delta {pred.delta_pct:.2f}% should be a small loss"
        assert pred.provenance["heat_tail_applied"] is True
        assert pred.provenance["arrhenius_degradation"] is True
        assert "common random numbers" in pred.provenance["variance_reduction"]

    # More warming → more lifetime loss
    assert results["RCP8.5"].delta_pct <= results["RCP4.5"].delta_pct <= results["RCP2.6"].delta_pct, \
        "lifetime loss must grow with warming (RCP8.5 worst)"
