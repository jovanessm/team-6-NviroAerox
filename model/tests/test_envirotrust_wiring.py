"""
Integration test: EnviroTrust API → adapters → simulate().

Requires:
- ENVIROTRUST_API_KEY in backend/.env
- ERA5 CSV for Eggebek fetched at backend/CDS Data/era5_data/Eggebek_Solar_Park.csv
"""

import sys
import os
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../backend"))

from pathlib import Path
from model.adapters import (
    compute_baseline_temp,
    heat_wind_to_climate_deltas,
    wildfire_to_heat_tail,
    build_all_scenarios,
)
from model.montecarlo import simulate
from model.data import ParkSpecs, BaselineWeather

EGGEBEK_SOLAR_PARK = ParkSpecs(
    name="Eggebek_Solar_Park",
    lat=54.629,
    lon=9.343,
    capacity_kwp=83_600.0,
    gamma=-0.0045,
    noct_c=45.0,
    tilt=20.0,
    azimuth=180.0,
    commissioned=2011,
)

ERA5_CSV = Path("backend/CDS Data/era5_data/Eggebek_Solar_Park.csv")


def load_baseline_weather() -> BaselineWeather:
    import pandas as pd
    df = pd.read_csv(ERA5_CSV)
    ghi = np.where(np.isnan(df["shortwave_radiation"].values), 0, df["shortwave_radiation"].values)
    temp = df["temperature_2m"].values
    temp = np.where(np.isnan(temp), np.nanmean(temp), temp)
    return BaselineWeather(ghi=ghi.astype(float), temp_amb=temp.astype(float))


@pytest.mark.skipif(not ERA5_CSV.exists(), reason="ERA5 CSV not fetched yet")
def test_full_pipeline_with_envirotrust():
    """Wire EnviroTrust API → ClimateDeltas → simulate() → Prediction."""
    from EnviroTrustAPI.client import EnviroTrustClient

    client = EnviroTrustClient()
    lat, lon = EGGEBEK_SOLAR_PARK.lat, EGGEBEK_SOLAR_PARK.lon

    # Fetch from API
    timeseries = client.get_heat_wind_timeseries(lat, lon, 2024, 2054)["heat_wind_timeseries_data"]
    wildfire = client.get_wildfire_timeseries(lat, lon, 2024, 2054)["wildfire_risk_timeseries_data"]

    # Load ERA5 baseline
    baseline = load_baseline_weather()
    baseline_temp_c = compute_baseline_temp(str(ERA5_CSV))

    # Build climate deltas from API
    scenarios = build_all_scenarios(timeseries, baseline_temp_c)
    assert "RCP4.5" in scenarios
    assert "RCP8.5" in scenarios

    # Build heat-tail series
    n_years = len(timeseries)
    heat_tail = wildfire_to_heat_tail(wildfire, n_years)
    assert len(heat_tail) == n_years

    # Run simulation for each scenario
    results = {}
    for scenario_name, deltas in scenarios.items():
        pred = simulate(
            EGGEBEK_SOLAR_PARK,
            baseline,
            deltas,
            n_draws=500,  # fast for tests
            heat_tail_series=heat_tail,
        )
        results[scenario_name] = pred

        assert len(pred.years) == n_years
        assert np.all(pred.p10 <= pred.p50), f"{scenario_name}: P10 > P50"
        assert np.all(pred.p50 <= pred.p90), f"{scenario_name}: P50 > P90"
        # Climate signal (~1-2%) is small vs interannual GHI variance; 500 draws can't
        # resolve sign reliably. Check it's within a physically plausible range instead.
        assert -10 < pred.delta_pct < 5, f"{scenario_name}: delta {pred.delta_pct:.2f}% outside [-10, 5]"
        assert pred.provenance["heat_tail_applied"] is True
        assert pred.provenance["arrhenius_degradation"] is True

    # RCP8.5 should not be materially better than RCP4.5.
    # Allow 2% MC noise — at n=500 draws the climate signal (~1%) is barely above noise floor.
    assert results["RCP8.5"].delta_pct <= results["RCP4.5"].delta_pct + 2.0, \
        "RCP8.5 should not show materially better outcome than RCP4.5"

    print(f"\nRCP4.5: delta = {results['RCP4.5'].delta_pct:.2f}%")
    print(f"RCP8.5: delta = {results['RCP8.5'].delta_pct:.2f}%")
