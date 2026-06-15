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
from model.physics import annual_energy
from model.typical_year import build_typical_year, sample_year
from model.degradation import degradation_factor
from model.climate import apply_delta, heat_tail


def simulate(
    park: ParkSpecs,
    baseline: BaselineWeather,
    deltas: ClimateDeltas,
    n_draws: int = N_DRAWS_DEFAULT,
    seed: int = RNG_SEED,
    heat_tail_series: np.ndarray | None = None,
) -> Prediction:
    """
    Run Monte Carlo simulation for one scenario.

    Samples four uncertainty sources:
    1. Climate-model spread (ΔT ensemble, correlated across years per draw)
    2. Interannual weather (resample whole historical years)
    3. Parameter uncertainty (gamma, PR, degradation rate)
    4. Scenario (fixed by input ClimateDeltas — run once per scenario)

    Optionally applies heat-tail derating per year (from EnviroTrust wildfire timeseries).

    Args:
        park: solar park specs (capacity, gamma, NOCT)
        baseline: multi-year historical weather (GHI + temp)
        deltas: temperature change projections for one scenario
        n_draws: number of MC draws
        seed: RNG seed for reproducibility
        heat_tail_series: optional extra dT per year for hottest hours, shape (n_years,)

    Returns:
        Prediction with p10/p50/p90 fans and lifetime stats
    """
    rng = np.random.default_rng(seed)

    typical_ghi, typical_temp = build_typical_year(baseline.ghi, baseline.temp_amb)
    n_years = len(deltas.dT_per_year)
    years = np.arange(n_years)

    # Storage: (n_draws, n_years)
    annual_energies_adjusted = np.zeros((n_draws, n_years))
    annual_energies_baseline = np.zeros((n_draws, n_years))

    for draw in range(n_draws):
        # Sample parameters once per draw
        gamma = rng.normal(park.gamma, 2e-4)
        pr = rng.normal(PR_NONTHERMAL_DEFAULT, 0.02)
        d0 = rng.normal(DEGRADATION_RATE_DEFAULT, 5e-4)

        # Baseline: typical year flat, only degradation
        e_year_base = annual_energy(
            typical_ghi,
            typical_temp,
            park.capacity_kwp,
            gamma=gamma,
            noct=park.noct_c,
            pr_nonthermal=pr,
        )
        deg_factors = degradation_factor(years, d0=d0)
        annual_energies_baseline[draw, :] = e_year_base * deg_factors

        # Sample climate-model scalar once per draw (correlated across years)
        m = rng.standard_normal()

        for year in range(n_years):
            dT = deltas.dT_per_year[year] + m * deltas.dT_model_std[year]

            # Resample a historical year, shift temperature by climate delta
            ghi_sampled, temp_sampled = sample_year(baseline.ghi, baseline.temp_amb, rng)
            temp_shifted = apply_delta(temp_sampled, dT)

            # Apply heat-tail: extra bump on hottest hours from wildfire/heatwave data
            if heat_tail_series is not None:
                temp_shifted = heat_tail(temp_shifted, dT_extra=heat_tail_series[year])

            e_year_adj = annual_energy(
                ghi_sampled,
                temp_shifted,
                park.capacity_kwp,
                gamma=gamma,
                noct=park.noct_c,
                pr_nonthermal=pr,
            )

            annual_energies_adjusted[draw, year] = e_year_adj * deg_factors[year]

    # Aggregate percentiles per year
    p10_annual = np.percentile(annual_energies_adjusted, 10, axis=0)
    p50_annual = np.percentile(annual_energies_adjusted, 50, axis=0)
    p90_annual = np.percentile(annual_energies_adjusted, 90, axis=0)
    baseline_annual = np.mean(annual_energies_baseline, axis=0)

    lifetime_baseline = np.sum(baseline_annual)
    lifetime_p50 = np.sum(p50_annual)
    lifetime_p90 = np.sum(p90_annual)
    delta_pct = (lifetime_p50 - lifetime_baseline) / lifetime_baseline * 100

    provenance = {
        "scenario": deltas.scenario,
        "n_draws": n_draws,
        "park_name": park.name,
        "park_lat": park.lat,
        "park_lon": park.lon,
        "park_capacity_kwp": park.capacity_kwp,
        "heat_tail_applied": heat_tail_series is not None,
        "dT_model_std_source": "EnviroTrust proxy (30% of delta)",
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
