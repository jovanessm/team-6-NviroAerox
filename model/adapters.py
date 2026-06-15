"""
Adapters that convert EnviroTrust API responses to model data contracts.

EnviroTrust API → ClimateDeltas + heat-tail series for simulate().
"""

import numpy as np
import pandas as pd
from model.data import ClimateDeltas


def compute_baseline_temp(era5_csv_path: str) -> float:
    """
    Compute mean ambient temperature from ERA5 historical data.
    Used as the reference point to compute dT from projected temperatures.

    Args:
        era5_csv_path: path to ERA5 CSV fetched by CDS Data script

    Returns:
        Mean temperature in °C
    """
    df = pd.read_csv(era5_csv_path)
    return float(df["temperature_2m"].mean())


def heat_wind_to_climate_deltas(
    timeseries_data: list[dict],
    baseline_temp_c: float,
    scenario: str,
) -> ClimateDeltas:
    """
    Convert EnviroTrust heat-wind/timeseries response to ClimateDeltas.

    Temperature is returned in Kelvin (daily max). We compute dT as the
    change relative to the first projection year (2024 = current climate),
    not vs ERA5 mean — because the API gives daily max, not mean ambient.

    Args:
        timeseries_data: list of yearly dicts from heat_wind_timeseries_data
        baseline_temp_c: unused (kept for API compatibility); baseline is taken
                         internally from the first projection year
        scenario: "RCP4.5" or "RCP8.5"

    Returns:
        ClimateDeltas with dT_per_year and estimated dT_model_std
    """
    if scenario not in ("RCP4.5", "RCP8.5"):
        raise ValueError(f"Unknown scenario '{scenario}'. Use 'RCP4.5' or 'RCP8.5'.")

    # API key format: "daily max temperature rcp45(K)" (no dot)
    api_key = scenario.lower().replace(".", "")
    temp_key = f"daily max temperature {api_key}(K)"
    sorted_data = sorted(timeseries_data, key=lambda x: x["year"])

    temps_k = np.array([record[temp_key] for record in sorted_data])
    temps_c = temps_k - 273.15

    # dT = change relative to first year (2024 baseline) — keeps comparison
    # internally consistent within the API's own daily-max metric
    reference_temp = temps_c[0]
    dT_per_year = temps_c - reference_temp

    # Ensemble spread proxy: no full CMIP6 ensemble from API
    # Use 0.3°C fixed floor + 20% of delta as conservative uncertainty estimate
    dT_model_std = np.maximum(0.3, np.abs(dT_per_year) * 0.2)

    return ClimateDeltas(
        scenario=scenario,
        dT_per_year=dT_per_year,
        dT_model_std=dT_model_std,
    )


def wildfire_to_heat_tail(wildfire_data: dict, n_years: int) -> np.ndarray:
    """
    Convert EnviroTrust wildfire/timeseries to a per-year heat-tail dT_extra.

    days_very_high_fire_danger is a proxy for extreme heat frequency.
    More extreme-heat days → larger extra temperature bump on the hottest hours.

    Scaling: 0 days → 0°C, 30+ days → 2°C (capped).

    Args:
        wildfire_data: dict keyed by year string from wildfire_risk_timeseries_data
        n_years: number of years to return (matches ClimateDeltas length)

    Returns:
        dT_extra per year, shape (n_years,)
    """
    sorted_years = sorted(wildfire_data.keys(), key=int)[:n_years]
    dT_extra = np.array([
        min(wildfire_data[yr]["days_very_high_fire_danger"] / 30 * 2.0, 2.0)
        for yr in sorted_years
    ])
    return dT_extra


def build_all_scenarios(
    timeseries_data: list[dict],
    baseline_temp_c: float,
) -> dict[str, ClimateDeltas]:
    """
    Build ClimateDeltas for both available scenarios from one API response.

    Args:
        timeseries_data: list from heat_wind_timeseries_data
        baseline_temp_c: historical mean temperature in °C

    Returns:
        dict mapping scenario name to ClimateDeltas
    """
    return {
        "RCP4.5": heat_wind_to_climate_deltas(timeseries_data, baseline_temp_c, "RCP4.5"),
        "RCP8.5": heat_wind_to_climate_deltas(timeseries_data, baseline_temp_c, "RCP8.5"),
    }
