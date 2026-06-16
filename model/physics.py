"""Pure, deterministic physics core for PV energy prediction."""

import numpy as np
from model.config import GAMMA_DEFAULT, NOCT_DEFAULT, PR_NONTHERMAL_DEFAULT

# Faiman (2008) empirical coefficients for mono/poly-Si modules
FAIMAN_U0 = 25.0   # W/m²/K — constant convective loss
FAIMAN_U1 = 6.84   # W·s/m³/K — wind-speed-dependent loss


def cell_temperature(t_amb: np.ndarray, ghi: np.ndarray, noct: float = NOCT_DEFAULT) -> np.ndarray:
    """
    Estimate cell temperature from ambient temp and irradiance (NOCT model).

    T_cell = T_amb + (NOCT - 20) / 800 * GHI

    Args:
        t_amb: ambient temperature, °C, shape (n_hours,)
        ghi: global horizontal irradiance, W/m², shape (n_hours,)
        noct: nominal operating cell temperature, °C

    Returns:
        Cell temperature, °C, shape (n_hours,)
    """
    return t_amb + (noct - 20) / 800 * ghi


def dc_power(
    ghi: np.ndarray,
    t_cell: np.ndarray,
    capacity_kwp: float,
    gamma: float = GAMMA_DEFAULT,
) -> np.ndarray:
    """
    Estimate DC power from irradiance and cell temperature.

    P_dc = capacity_kwp * (GHI / 1000) * (1 + gamma * (T_cell - 25))

    Args:
        ghi: irradiance, W/m², shape (n_hours,)
        t_cell: cell temperature, °C, shape (n_hours,)
        capacity_kwp: rated capacity, kWp
        gamma: temperature coefficient, 1/°C

    Returns:
        DC power, kW, shape (n_hours,)
    """
    return capacity_kwp * (ghi / 1000) * (1 + gamma * (t_cell - 25))


def ac_power(dc: np.ndarray, pr_nonthermal: float = PR_NONTHERMAL_DEFAULT) -> np.ndarray:
    """
    Convert DC power to AC power via inverter and non-thermal losses.

    P_ac = P_dc * PR_nonthermal

    Args:
        dc: DC power, kW, shape (n_hours,)
        pr_nonthermal: performance ratio (non-thermal: inverter, soiling, wiring, etc.)

    Returns:
        AC power, kW, shape (n_hours,)
    """
    return dc * pr_nonthermal


def cell_temperature_faiman(
    t_amb: np.ndarray,
    ghi: np.ndarray,
    wind_speed: float | np.ndarray,
    u0: float = FAIMAN_U0,
    u1: float = FAIMAN_U1,
) -> np.ndarray:
    """
    Faiman cell temperature model: T_cell = T_amb + GHI / (U0 + U1 × wind_speed)

    More accurate than NOCT when actual wind speed is known. The NOCT formula
    implicitly assumes ~1 m/s; Faiman uses the measured value, so parks with
    real wind (3–5 m/s German average) run cooler and produce more power.

    Wind shielding from park interior rows is captured by pre-multiplying
    wind_speed by ParkSpecs.wind_exposure before passing here.

    Args:
        t_amb: ambient temperature, °C, shape (n_hours,)
        ghi: global horizontal irradiance, W/m², shape (n_hours,)
        wind_speed: effective wind speed at panel surface, m/s (scalar or array)
        u0: constant heat loss coefficient, W/m²/K
        u1: wind-dependent heat loss coefficient, W·s/m³/K

    Returns:
        Cell temperature, °C, shape (n_hours,)
    """
    return t_amb + ghi / (u0 + u1 * wind_speed)


def annual_energy_faiman(
    ghi: np.ndarray,
    t_amb: np.ndarray,
    capacity_kwp: float,
    wind_speed: float | np.ndarray,
    gamma: float = GAMMA_DEFAULT,
    u0: float = FAIMAN_U0,
    u1: float = FAIMAN_U1,
    pr_nonthermal: float = PR_NONTHERMAL_DEFAULT,
) -> float:
    """
    Compute annual energy using the Faiman cell temperature model.

    Drop-in replacement for annual_energy() when wind speed is available.

    Args:
        ghi: hourly irradiance, W/m², shape (8760,)
        t_amb: hourly ambient temp, °C, shape (8760,)
        capacity_kwp: rated capacity, kWp
        wind_speed: effective wind speed at panel surface, m/s (scalar or hourly array)
        gamma: temperature coefficient, 1/°C
        u0: Faiman constant loss coefficient
        u1: Faiman wind-dependent loss coefficient
        pr_nonthermal: performance ratio (non-thermal losses)

    Returns:
        Annual energy, kWh
    """
    t_cell = cell_temperature_faiman(t_amb, ghi, wind_speed, u0, u1)
    p_dc = dc_power(ghi, t_cell, capacity_kwp, gamma)
    p_ac = ac_power(p_dc, pr_nonthermal)
    return float(np.sum(p_ac))


def annual_energy(
    ghi: np.ndarray,
    t_amb: np.ndarray,
    capacity_kwp: float,
    gamma: float = GAMMA_DEFAULT,
    noct: float = NOCT_DEFAULT,
    pr_nonthermal: float = PR_NONTHERMAL_DEFAULT,
) -> float:
    """
    Compute annual energy from hourly irradiance and temperature (one typical year).

    Closed-form, no randomness. Chain: GHI + T_amb → T_cell → P_dc → P_ac → E_year.

    Args:
        ghi: hourly irradiance, W/m², shape (8760,) for one year
        t_amb: hourly ambient temp, °C, shape (8760,)
        capacity_kwp: rated capacity, kWp
        gamma: temperature coefficient, 1/°C
        noct: nominal operating cell temperature, °C
        pr_nonthermal: performance ratio (non-thermal losses)

    Returns:
        Annual energy, kWh
    """
    t_cell = cell_temperature(t_amb, ghi, noct)
    p_dc = dc_power(ghi, t_cell, capacity_kwp, gamma)
    p_ac = ac_power(p_dc, pr_nonthermal)
    return np.sum(p_ac)  # kWh per year (hourly power summed)
