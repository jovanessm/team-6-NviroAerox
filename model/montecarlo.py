"""Monte Carlo uncertainty engine for PV lifetime prediction."""

import numpy as np
from model.data import ParkSpecs, BaselineWeather, ClimateDeltas, Prediction
from model.config import (
    N_DRAWS_DEFAULT,
    RNG_SEED,
    GAMMA_DEFAULT,
    PR_NONTHERMAL_DEFAULT,
    DEGRADATION_RATE_DEFAULT,
    LIFETIME_YEARS,
)
from model.physics import annual_energy, annual_energy_faiman
from model.typical_year import build_typical_year, sample_year
from model.degradation import degradation_factor
from model.climate import apply_delta, heat_tail
from model.validate import check_specific_yield


def simulate(
    park: ParkSpecs,
    baseline: BaselineWeather,
    deltas: ClimateDeltas,
    n_draws: int = N_DRAWS_DEFAULT,
    seed: int = RNG_SEED,
    heat_tail_series: np.ndarray | None = None,
    use_faiman: bool = False,
) -> Prediction:
    """
    Run Monte Carlo simulation for one scenario.

    Samples four uncertainty sources:
    1. Climate-model spread (ΔT ensemble, correlated across years per draw)
    2. Interannual weather (resample whole historical years)
    3. Parameter uncertainty (gamma, PR, degradation rate)
    4. Scenario (fixed by input ClimateDeltas — run once per scenario)

    Uses **common random numbers**: within each draw/year the baseline and
    climate-adjusted paths share the same sampled weather year and the same
    parameter draws, differing only by the climate signal. This cancels
    interannual GHI variance from the delta so the small (~1-3%) climate effect
    is not swamped by ~5-10% weather noise.

    Optionally applies heat-tail derating per year (from EnviroTrust wildfire timeseries).

    Args:
        park: solar park specs (capacity, gamma, NOCT, wind_exposure)
        baseline: multi-year historical weather (GHI + temp + mean_wind_speed)
        deltas: temperature change projections for one scenario
        n_draws: number of MC draws
        seed: RNG seed for reproducibility
        heat_tail_series: optional extra dT per year for hottest hours, shape (n_years,)
        use_faiman: if True, use Faiman T_cell model with park.wind_exposure ×
                    baseline.mean_wind_speed as effective wind; else use NOCT

    Returns:
        Prediction with p10/p50/p90 fans and lifetime stats
    """
    # Effective wind speed at panel surface (park geometry reduces open-field wind)
    effective_wind = baseline.mean_wind_speed * park.wind_exposure
    rng = np.random.default_rng(seed)

    typical_ghi, typical_temp = build_typical_year(baseline.ghi, baseline.temp_amb)
    n_years = len(deltas.dT_per_year)
    years = np.arange(n_years)

    # Sanity-check baseline yield before running 3000-draw MC on bad inputs
    e_typical = annual_energy(typical_ghi, typical_temp, park.capacity_kwp)
    check_specific_yield(e_typical, park.capacity_kwp)

    # Storage: (n_draws, n_years)
    annual_energies_adjusted = np.zeros((n_draws, n_years))
    annual_energies_baseline = np.zeros((n_draws, n_years))

    for draw in range(n_draws):
        # Sample parameters once per draw — SHARED by both paths (common random numbers)
        gamma = rng.normal(park.gamma, 2e-4)
        pr = rng.normal(PR_NONTHERMAL_DEFAULT, 0.02)
        d0 = rng.normal(DEGRADATION_RATE_DEFAULT, 5e-4)

        # Sample climate scalar once per draw (correlated trajectory across years)
        m = rng.standard_normal()
        dT_draw = deltas.dT_per_year + m * deltas.dT_model_std  # shape (n_years,)

        # Degradation: baseline standard, adjusted Arrhenius-accelerated (same d0)
        deg_baseline = degradation_factor(years, d0=d0)
        deg_adjusted = degradation_factor(years, d0=d0, accelerated=True, dT_per_year=dT_draw)

        for year in range(n_years):
            # Common random numbers: sample ONE weather year and use it for BOTH
            # paths. Baseline and adjusted then differ ONLY by the climate signal
            # (temperature delta + heat-tail + Arrhenius aging), so interannual GHI
            # variance cancels in the delta instead of swamping it. Without this,
            # the ~1-3% climate signal is buried under ~5-10% weather noise and the
            # lifetime delta can come out the wrong sign.
            ghi_sampled, temp_sampled = sample_year(baseline.ghi, baseline.temp_amb, rng)

            # Baseline path: this year's weather, no climate shift
            if use_faiman:
                e_year_base = annual_energy_faiman(
                    ghi_sampled, temp_sampled, park.capacity_kwp,
                    wind_speed=effective_wind, gamma=gamma, pr_nonthermal=pr,
                )
            else:
                e_year_base = annual_energy(
                    ghi_sampled, temp_sampled, park.capacity_kwp,
                    gamma=gamma, noct=park.noct_c, pr_nonthermal=pr,
                )
            annual_energies_baseline[draw, year] = e_year_base * deg_baseline[year]

            # Adjusted path: SAME weather + temperature delta + heat-tail
            temp_shifted = apply_delta(temp_sampled, dT_draw[year])
            if heat_tail_series is not None:
                temp_shifted = heat_tail(temp_shifted, dT_extra=heat_tail_series[year])

            if use_faiman:
                e_year_adj = annual_energy_faiman(
                    ghi_sampled, temp_shifted, park.capacity_kwp,
                    wind_speed=effective_wind, gamma=gamma, pr_nonthermal=pr,
                )
            else:
                e_year_adj = annual_energy(
                    ghi_sampled, temp_shifted, park.capacity_kwp,
                    gamma=gamma, noct=park.noct_c, pr_nonthermal=pr,
                )
            annual_energies_adjusted[draw, year] = e_year_adj * deg_adjusted[year]

    # Per-year fan from the climate-adjusted distribution (includes weather spread)
    p10_annual = np.percentile(annual_energies_adjusted, 10, axis=0)
    p50_annual = np.percentile(annual_energies_adjusted, 50, axis=0)
    p90_annual = np.percentile(annual_energies_adjusted, 90, axis=0)
    # Baseline flat line: median sampled year (same statistic as the P50 fan, so the
    # two lines are visually comparable and the P50 sits below baseline as expected)
    baseline_annual = np.median(annual_energies_baseline, axis=0)

    lifetime_baseline = np.sum(baseline_annual)
    lifetime_p50 = np.sum(p50_annual)
    lifetime_p90 = np.sum(p90_annual)

    # Headline climate delta: mean of per-draw PAIRED lifetime differences. Because
    # baseline and adjusted share the same weather within each draw (common random
    # numbers), each paired difference isolates the pure climate effect; averaging
    # gives a stable, correctly-signed signal even though it is only ~1-3% of output.
    # Comparing summed percentiles instead would mix mean/median statistics and let
    # weather noise flip the sign.
    lt_base_per_draw = annual_energies_baseline.sum(axis=1)
    lt_adj_per_draw = annual_energies_adjusted.sum(axis=1)
    delta_pct = float(np.mean((lt_adj_per_draw - lt_base_per_draw) / lt_base_per_draw) * 100)

    provenance = {
        "scenario": deltas.scenario,
        "scenario_source": deltas.source or "unspecified",
        "dT_30yr_c": round(float(deltas.dT_per_year[-1]), 2),
        "dT_model_std_source": deltas.std_source or "unspecified",
        "n_draws": n_draws,
        "park_name": park.name,
        "park_lat": park.lat,
        "park_lon": park.lon,
        "park_capacity_kwp": park.capacity_kwp,
        "heat_tail_applied": heat_tail_series is not None,
        "arrhenius_degradation": True,
        "variance_reduction": "common random numbers (baseline & adjusted share weather + params per draw)",
        "cell_temp_model": "faiman" if use_faiman else "noct",
        "wind_exposure": park.wind_exposure if use_faiman else None,
        "effective_wind_ms": round(effective_wind, 2) if use_faiman else None,
    }

    return Prediction(
        years=years,
        baseline_annual=baseline_annual,
        p10=p10_annual,
        p50=p50_annual,
        p90=p90_annual,
        lifetime_p50=lifetime_p50,
        lifetime_p90=lifetime_p90,
        delta_pct=delta_pct,
        provenance=provenance,
    )
