from dataclasses import dataclass, field
from typing import Optional
import numpy as np


@dataclass
class ParkSpecs:
    """Solar park specifications from MaStR registry."""
    name: str
    lat: float
    lon: float
    capacity_kwp: float
    gamma: float = -0.004  # power temperature coefficient, 1/°C
    noct_c: float = 45.0  # nominal operating cell temperature, °C
    tilt: Optional[float] = None  # degrees
    azimuth: Optional[float] = None  # degrees, 0=north, 90=east, 180=south
    commissioned: Optional[int] = None  # year
    wind_exposure: float = 0.75  # fraction of open-field wind at panel surface (from GRW geometry)


@dataclass
class BaselineWeather:
    """Historical multi-year weather data for baseline."""
    ghi: np.ndarray  # W/m², shape (n_hours,), hourly
    temp_amb: np.ndarray  # °C, shape (n_hours,), hourly
    # Assumption: 8760 h/yr; n_hours = 8760 * n_years for interannual sampling
    mean_wind_speed: float = 4.0  # m/s, ERA5 mean wind_speed_10m; used by Faiman model only


@dataclass
class ClimateDeltas:
    """Temperature change projections from climate models (delta method)."""
    scenario: str  # "RCP2.6" | "RCP4.5" | "RCP8.5"
    dT_per_year: np.ndarray  # °C, shape (n_years,), added to baseline temp each year
    dT_model_std: np.ndarray  # °C, shape (n_years,), ensemble spread per year
    source: str = ""  # provenance: where the ΔT signal came from
    std_source: str = ""  # provenance: where dT_model_std came from


@dataclass
class Prediction:
    """Output from simulate() — one scenario."""
    years: np.ndarray  # shape (n_years,), 0..N-1
    baseline_annual: np.ndarray  # kWh, shape (n_years,), flat-climate line
    p10: np.ndarray  # kWh, shape (n_years,), climate-adjusted 10th percentile
    p50: np.ndarray  # kWh, shape (n_years,), climate-adjusted median
    p90: np.ndarray  # kWh, shape (n_years,), climate-adjusted 90th percentile
    lifetime_p50: float  # kWh, total over all years at P50
    lifetime_p90: float  # kWh, total over all years at P90
    delta_pct: float  # %, (lifetime_p50 - baseline_lifetime) / baseline_lifetime * 100
    provenance: dict = field(default_factory=dict)  # inputs/assumptions behind each point
