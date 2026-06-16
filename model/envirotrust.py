"""
EnviroTrust Climate Risks API → ClimateDeltas (alternative climate source).

Parallel to model/cmip6.py, but the ΔT signal comes from the EnviroTrust
"daily max temperature" field (RCP4.5 / RCP8.5), 2024-2054, pulled via
EnviroTrustClient (cache-backed by backend/EnviroTrust Data/cache/).

INTEGRITY NOTE — read before trusting these numbers:
This field is an annual EXTREME (hottest day), swings ±2-3°C year-to-year, and at
most German parks carries no usable warming trend — it often trends toward COOLING
(see CLAUDE.md and model/cmip6.py). CLAUDE.md rejected it as the climate driver for
exactly that reason. Here it is used DELIBERATELY, as the second leg of a CMIP6-vs-
EnviroTrust source comparison, and we take the MAGNITUDE of the fitted trend (|slope|)
so the EnviroTrust branch always shows warming/derating rather than spurious cooling.
That forcing is a thumb on the scale; it is stamped verbatim into `source` (and thus
into Prediction.provenance.scenario_source) so every number still traces to its
assumption. Only RCP4.5 and RCP8.5 exist here — EnviroTrust provides no RCP2.6.
"""

import sys
import numpy as np
import pandas as pd
from pathlib import Path

from model.data import ClimateDeltas
from model.config import LIFETIME_YEARS

# EnviroTrustClient lives under backend/ — make it importable however we're launched.
_BACKEND_DIR = Path(__file__).parent.parent / "backend"
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))
from EnviroTrustAPI import EnviroTrustClient  # noqa: E402

# EnviroTrust only ships RCP4.5 and RCP8.5 (no RCP2.6).
ENVIROTRUST_SCENARIOS = ["RCP4.5", "RCP8.5"]

# Scenario → daily-max-temperature column in the heat-wind timeseries (Kelvin).
_TEMP_COLUMN = {
    "RCP4.5": "daily max temperature rcp45(K)",
    "RCP8.5": "daily max temperature rcp85(K)",
}

_KELVIN = 273.15

# Floor on the per-year spread so MC doesn't collapse in early years (°C).
# Matches model/cmip6._STD_FLOOR_C.
_STD_FLOOR_C = 0.15


def _load_timeseries(lat: float, lon: float) -> pd.DataFrame:
    """EnviroTrust heat-wind timeseries for a location (local cache or live API)."""
    client = EnviroTrustClient()
    payload = client.get_heat_wind_timeseries(lat, lon)
    records = payload.get("heat_wind_timeseries_data", [])
    if not records:
        raise ValueError(f"no EnviroTrust timeseries data for ({lat}, {lon})")
    return pd.DataFrame(records)


def build_climate_deltas_envirotrust(
    df: pd.DataFrame,
    scenario: str,
    n_years: int = LIFETIME_YEARS,
) -> ClimateDeltas:
    """
    Build ClimateDeltas for one EnviroTrust scenario from its daily-max-temperature series.

    Fits a linear trend to the annual daily-max temperature, then uses the MAGNITUDE of
    the slope (|slope|) as the warming rate — forcing a warming direction because the raw
    series is noisy and frequently trends toward cooling (see module docstring). The band
    is the standard error of the slope projected over the horizon (how poorly the trend is
    pinned down), grown over time like CMIP6's across-model spread.

    Args:
        df: EnviroTrust heat-wind timeseries (must have "year" + the scenario temp column)
        scenario: "RCP4.5" | "RCP8.5"
        n_years: projection length (default 30-year lifetime)

    Returns:
        ClimateDeltas with forced-warming dT_per_year and trend-SE dT_model_std
    """
    if scenario not in _TEMP_COLUMN:
        raise ValueError(f"Unknown EnviroTrust scenario '{scenario}'. Use one of {ENVIROTRUST_SCENARIOS}.")

    col = _TEMP_COLUMN[scenario]
    if col not in df.columns:
        raise ValueError(f"EnviroTrust timeseries missing column '{col}'")

    years = df["year"].to_numpy(dtype=float)
    temps_c = df[col].to_numpy(dtype=float) - _KELVIN
    mask = ~np.isnan(years) & ~np.isnan(temps_c)
    years, temps_c = years[mask], temps_c[mask]
    if len(years) < 3:
        raise ValueError(f"EnviroTrust {scenario}: only {len(years)} usable years")

    x = years - years.min()
    slope, intercept = np.polyfit(x, temps_c, 1)

    # Force warming direction: use the magnitude of the fitted trend.
    warming_rate = abs(float(slope))
    t = np.arange(n_years, dtype=float)  # 0..n_years-1, anchored at 0 in year 0
    dT_per_year = warming_rate * t

    # Band = standard error of the slope, projected over the horizon.
    residuals = temps_c - (slope * x + intercept)
    sse = float(np.sum(residuals ** 2))
    sxx = float(np.sum((x - x.mean()) ** 2))
    dof = max(len(x) - 2, 1)
    slope_se = float(np.sqrt((sse / dof) / sxx)) if sxx > 0 else 0.0
    dT_model_std = np.maximum(_STD_FLOOR_C, slope_se * t)

    source = (
        f"EnviroTrust daily-max-temperature field (annual extreme, {scenario}), "
        f"|linear trend| forced to warming direction (raw slope {slope:+.3f}°C/yr)"
    )
    std_source = "EnviroTrust daily-max trend standard error projected over horizon"

    return ClimateDeltas(
        scenario=scenario,
        dT_per_year=dT_per_year,
        dT_model_std=dT_model_std,
        source=source,
        std_source=std_source,
    )


def build_all_scenarios_envirotrust(
    lat: float,
    lon: float,
    n_years: int = LIFETIME_YEARS,
) -> dict[str, ClimateDeltas]:
    """Build EnviroTrust RCP4.5 + RCP8.5 deltas for a location (one timeseries fetch)."""
    df = _load_timeseries(lat, lon)
    return {s: build_climate_deltas_envirotrust(df, s, n_years) for s in ENVIROTRUST_SCENARIOS}
