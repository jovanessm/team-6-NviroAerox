"""Panel degradation over time."""

import numpy as np
from model.config import DEGRADATION_RATE_DEFAULT


def degradation_factor(
    years: np.ndarray,
    d0: float = DEGRADATION_RATE_DEFAULT,
    accelerated: bool = False,
    dT_per_year: np.ndarray = None,
) -> np.ndarray:
    """
    Compute annual degradation factor for each year.

    Standard: (1 - d0)^t, cumulative loss = prod over t.
    Accelerated (Arrhenius): d(t) = d0 * 2^(ΔT(t)/10), where panel ages faster in hotter years.

    Args:
        years: year indices, shape (n_years,), 0..N-1
        d0: base degradation rate, fraction/year
        accelerated: whether to apply temperature-accelerated degradation
        dT_per_year: temperature delta per year (°C), shape (n_years,); required if accelerated=True

    Returns:
        Degradation factor per year (1 - d(t)), shape (n_years,)
    """
    if not accelerated:
        # Compounding: efficiency at start of year t = (1 - d0)^t
        # Year 0 → 1.0 (new panel), year 30 → ~0.808 at 0.7%/yr
        return (1 - d0) ** years.astype(float)

    if dT_per_year is None:
        raise ValueError("dT_per_year required for accelerated degradation")

    # Arrhenius: per-year rate d(t) = d0 * 2^(ΔT(t)/10) — doubles per 10°C
    # Cumulative: factor(t) = prod_{s=0}^{t-1} (1 - d(s)), so year 0 = 1.0
    d_t = d0 * np.power(2, dT_per_year / 10)
    n = len(d_t)
    factors = np.ones(n)
    if n > 1:
        factors[1:] = np.cumprod((1 - d_t)[:-1])
    return factors
