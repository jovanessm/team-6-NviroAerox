"""
CMIP6 multi-model temperature ensemble → ClimateDeltas.

Replaces the EnviroTrust "daily max temperature" field as the ΔT driver. That
field is a single annual extreme (hottest day), swings ±2-3°C year-to-year, and
carries no usable warming trend — at most parks it trends the WRONG way (RCP8.5
cooling). Mean ambient temperature is the correct thermal-derating variable
anyway (CLAUDE.md: "temperature is the headline signal").

Source: Open-Meteo Climate API — 7 HighResMIP models (SSP5-8.5), daily
temperature_2m_mean, 2024-2050. We fit each model's annual-mean warming trend,
then take the ensemble mean as the ΔT signal and the ensemble spread as the
real dT_model_std (no proxy).

Scenarios: the HighResMIP ensemble is SSP5-8.5, so it IS our RCP8.5 branch.
RCP4.5 and RCP2.6 are scaled by IPCC AR6 WGI Central Europe near-term ratios
(2041-2060 vs 1995-2014): SSP1-2.6 ~1.2°C, SSP2-4.5 ~1.6°C, SSP5-8.5 ~2.0°C.
"""

import json
import numpy as np
import pandas as pd
import requests
from pathlib import Path

from model.data import ClimateDeltas
from model.config import LIFETIME_YEARS

# Open-Meteo HighResMIP models (all SSP5-8.5)
CMIP6_MODELS = [
    "MRI_AGCM3_2_S",
    "EC_Earth3P_HR",
    "MPI_ESM1_2_XR",
    "CMCC_CM2_VHR4",
    "FGOALS_f3_H",
    "HiRAM_SIT_HR",
    "NICAM16_8S",
]

CLIMATE_API_URL = "https://climate-api.open-meteo.com/v1/climate"

# IPCC AR6 WGI Central Europe near-term warming vs SSP5-8.5 (see module docstring)
SCENARIO_SCALE = {
    "RCP8.5": 1.00,  # the HighResMIP ensemble itself
    "RCP4.5": 0.80,  # 1.6°C / 2.0°C
    "RCP2.6": 0.60,  # 1.2°C / 2.0°C
}

# Floor on model spread so MC doesn't collapse in early years (°C)
_STD_FLOOR_C = 0.15

# Hot extremes in Central Europe warm ~1.5x the mean (IPCC AR6 WGI Ch.11, TX trends).
# The heat-tail applies the EXTRA warming — 0.5x the mean shift — to the hottest
# hours, on top of the uniform mean shift every hour already receives. Tied to the
# same CMIP6 ensemble; replaces the noise-only EnviroTrust wildfire day-count.
HOT_TAIL_AMPLIFICATION = 0.5


def fetch_ensemble_annual(lat: float, lon: float, cache_path: Path | None = None) -> dict[str, dict[str, float]]:
    """
    Fetch annual-mean temperature per model for a location.

    Returns {model_name: {year: mean_temp_c}}. Years with <360 valid days are
    dropped (partial coverage). Caches the processed result if cache_path given.
    """
    if cache_path and cache_path.exists():
        with open(cache_path) as f:
            return json.load(f)

    r = requests.get(CLIMATE_API_URL, params={
        "latitude": lat, "longitude": lon,
        "start_date": "2024-01-01", "end_date": "2050-12-31",
        "models": ",".join(CMIP6_MODELS),
        "daily": "temperature_2m_mean",
    }, timeout=90)
    r.raise_for_status()
    daily = r.json()["daily"]

    df = pd.DataFrame(daily)
    df["year"] = pd.to_datetime(df["time"]).dt.year

    out: dict[str, dict[str, float]] = {}
    for model in CMIP6_MODELS:
        col = f"temperature_2m_mean_{model}"
        if col not in df:
            continue
        annual = df.groupby("year")[col].mean()
        counts = df.groupby("year")[col].count()
        annual = annual[counts >= 360].dropna()
        if len(annual) >= 5:
            out[model] = {str(int(y)): float(v) for y, v in annual.items()}

    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, "w") as f:
            json.dump(out, f)
    return out


def _model_slopes(ensemble_annual: dict[str, dict[str, float]]) -> np.ndarray:
    """Fit each model's annual-mean warming trend → array of slopes (°C/year)."""
    slopes = []
    for series in ensemble_annual.values():
        years = np.array([int(y) for y in series.keys()], dtype=float)
        temps = np.array(list(series.values()), dtype=float)
        years = years - years.min()
        slope = np.polyfit(years, temps, 1)[0]
        slopes.append(slope)
    return np.array(slopes)


def build_climate_deltas(
    ensemble_annual: dict[str, dict[str, float]],
    scenario: str,
    n_years: int = LIFETIME_YEARS,
) -> ClimateDeltas:
    """
    Build ClimateDeltas for one scenario from the CMIP6 ensemble.

    Each model contributes a linear warming trajectory dT_m(t) = slope_m * t,
    anchored at 0 in year 0. The ensemble mean across models is the ΔT signal;
    the ensemble standard deviation is the model spread (dT_model_std). RCP4.5
    and RCP2.6 scale the SSP5-8.5 ensemble by IPCC AR6 ratios.

    Args:
        ensemble_annual: {model: {year: mean_temp_c}} from fetch_ensemble_annual
        scenario: "RCP2.6" | "RCP4.5" | "RCP8.5"
        n_years: projection length (default 30-year lifetime)

    Returns:
        ClimateDeltas with ensemble-mean dT_per_year and real dT_model_std
    """
    if scenario not in SCENARIO_SCALE:
        raise ValueError(f"Unknown scenario '{scenario}'. Use one of {list(SCENARIO_SCALE)}.")

    slopes = _model_slopes(ensemble_annual)  # (n_models,), °C/year
    n_models = len(slopes)
    scale = SCENARIO_SCALE[scenario]
    t = np.arange(n_years, dtype=float)  # 0..n_years-1

    # Per-model trajectories: (n_models, n_years)
    trajectories = np.outer(slopes, t) * scale

    dT_per_year = trajectories.mean(axis=0)
    dT_model_std = np.maximum(_STD_FLOOR_C, trajectories.std(axis=0))

    if scenario == "RCP8.5":
        source = f"CMIP6 {n_models}-model HighResMIP ensemble (Open-Meteo, SSP5-8.5), linear annual-mean trend"
    else:
        source = (f"CMIP6 {n_models}-model HighResMIP ensemble x {scale:.2f} "
                  f"(IPCC AR6 WGI Central Europe near-term ratio vs SSP5-8.5)")

    return ClimateDeltas(
        scenario=scenario,
        dT_per_year=dT_per_year,
        dT_model_std=dT_model_std,
        source=source,
        std_source=f"CMIP6 {n_models}-model ensemble spread (across-model std of warming trajectory)",
    )


def build_all_scenarios_cmip6(
    ensemble_annual: dict[str, dict[str, float]],
    n_years: int = LIFETIME_YEARS,
) -> dict[str, ClimateDeltas]:
    """Build all three scenarios from one CMIP6 ensemble, ordered low → high warming."""
    return {
        "RCP2.6": build_climate_deltas(ensemble_annual, "RCP2.6", n_years),
        "RCP4.5": build_climate_deltas(ensemble_annual, "RCP4.5", n_years),
        "RCP8.5": build_climate_deltas(ensemble_annual, "RCP8.5", n_years),
    }


def heat_tail_from_deltas(deltas: ClimateDeltas, amplification: float = HOT_TAIL_AMPLIFICATION) -> np.ndarray:
    """
    Per-year extra warming on the hottest hours, derived from the scenario's
    mean-temperature trajectory. See HOT_TAIL_AMPLIFICATION.

    Returns dT_extra per year, shape (n_years,) — feeds simulate(heat_tail_series=).
    """
    return amplification * deltas.dT_per_year
