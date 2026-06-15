# CLAUDE.md — `model/` working guide

Personal/local context for building the prediction model. **Supplements the root `CLAUDE.md`** —
project constraints, settled decisions, and the data contract live there; read it first. This
file is the implementation detail for the `model/` module only.

---

## What this seat actually is

Not ML training. There are no per-park labels, and a learned model would bake in the historical
climate — the exact thing the project attacks. **The "model" is a deterministic physics core +
a Monte Carlo uncertainty engine.** That is the winning, explainable position. Do not train,
fit, or regress anything on weather→output. (The only fitting allowed: calibrating one scalar,
the performance ratio, against PVGIS — see Calibration.)

---

## The physics (closed-form, the hot path)

Per hour, given plane-of-array irradiance `G` (W/m²) and ambient temp `T_amb` (°C):

```
T_cell = T_amb + (NOCT - 20)/800 * G                      # NOCT cell-temp model
P_dc   = P_rated * (G/1000) * (1 + gamma*(T_cell - 25))   # kW; STC = 1000 W/m², 25°C
P_ac   = P_dc * PR_nonthermal                             # kW
E_year = sum(P_ac over 8760 h)                            # kWh
```

Defaults: `gamma = -0.004 /°C`, `NOCT = 45 °C`, `PR_nonthermal ≈ 0.87`.

**Critical: do not double-count thermal losses.** Overall PV performance ratios (~0.80) already
bundle ~5–8% thermal loss. We model temperature *explicitly* (it's our climate lever), so the PR
here must contain only **non-thermal** losses (inverter, soiling, wiring, mismatch, availability)
— hence ~0.87, not 0.80. Folding thermal into PR would silently cancel the effect we're selling.

**GHI vs POA:** if the data feed is GHI (horizontal) and the array is tilted, you're
underestimating in-plane irradiance. Acceptable shortcut: treat GHI as `G` and absorb the
transposition gap into PR via the PVGIS calibration. If tilt/azimuth are known and there's time,
apply a simple transposition factor instead. Document whichever you choose.

Keep the core a **pure function**: `(typical_year, specs) -> E_year`. No randomness, no I/O.

---

## The lifetime loop

For year `t` in `0..N-1` (N ≈ 30–35):

- **Baseline ("standard method"):** typical year held flat, `E_base(t) = E_year_base * (1-d)^t`.
- **Climate-adjusted:** shift the typical year's temperature by the scenario delta,
  `T_amb(t) = T_amb_base + ΔT(t)`, re-run the core → `E_year_adj(t)`, then apply degradation.
- Degradation default `d = 0.005/yr`. Keep degradation in **both** lines so the reported delta
  is purely climate.

**Two optional levers to make the climate signal material (it's small otherwise — see Sanity).**
Both are defensible and both belong only in the adjusted line:

- **Temperature-accelerated degradation:** `d(t) = d0 * 2**(ΔT(t)/10)` (degradation ~doubles per
  10 °C, Arrhenius rule-of-thumb). Compounds over 30 years — this is the lever that moves lifetime
  energy a few %. Cumulative factor = `prod over t of (1 - d(t))`.
- **Heat-tail:** on top of the mean ΔT shift, add a small extra bump to the hottest X% of hours
  to represent more frequent/intense heatwaves, where derate bites hardest.

---

## The uncertainty engine (the centerpiece)

Monte Carlo, output shape `(n_draws, n_years)`. `n_draws ≈ 3000`. **Seed the RNG** for
reproducible demos. Vectorize with numpy broadcasting — no per-draw Python loop.

Four sources, sampled per draw:

1. **Scenario (SSP).** Discrete branches `{SSP1-2.6, SSP2-4.5, SSP5-8.5}`. **Run each separately;
   never average them.** Each yields its own fan.
2. **Climate-model spread.** `ΔT(t) = dT_mean(t) + m * dT_std(t)` where `m ~ N(0,1)` is drawn
   **once per draw** and shared across all years. **Do NOT sample ΔT independently per year** —
   that decorrelates the trajectory (a "hot" model stays hot) and underestimates the real spread.
3. **Interannual weather.** Resample whole historical years from the multi-year baseline for each
   future year. Resampling real years (not adding noise) preserves the temp↔irradiance correlation.
4. **Parameters.** `gamma ~ N(-0.004, 2e-4)`, `PR ~ N(0.87, 0.02)`, `d0 ~ N(0.005, 5e-4)` per draw.

Aggregate per scenario → `P10/P50/P90` per year (the fan) and a lifetime-energy distribution →
`lifetime_p50`, `lifetime_p90`, `delta_pct` vs baseline.

**Variance decomposition (do if time):** at each horizon, split total variance into weather /
model-spread / scenario contributions. Run with model-spread frozen to isolate weather; difference
gives model-spread; variance of per-scenario means gives scenario. This is the strongest "what the
data can't say" artifact and the intellectual money-shot.

---

## Module layout (`model/`)

```
model/
  config.py        # defaults: gamma, NOCT, PR, d0, n_draws, seed, scenario list
  physics.py       # cell_temp(), dc_power(), annual_energy()  — PURE, unit-tested
  typical_year.py  # build_typical_year(); sample_year() for MC
  climate.py       # apply_delta(); optional heat_tail()
  degradation.py   # degradation_factor() incl. accelerated option
  montecarlo.py    # simulate() — sampling, aggregation, percentiles, provenance
  validate.py      # PVGIS check + sane-bounds asserts
  tests/
```

Public API (matches root contract):

```python
def simulate(park: ParkSpecs,
             baseline: BaselineWeather,
             deltas: ClimateDeltas,        # one scenario
             n_draws: int = 3000) -> Prediction
# returns: years, baseline_annual, p10/p50/p90, lifetime_p50/p90, delta_pct, provenance
```

Run once per scenario; the app gets a `{scenario: Prediction}` dict.

**Provenance:** carry, per year, the central inputs behind the curve (ΔT used, derate %,
degradation %, sampled-year ids) so the UI can explain any point. Explainability is a hard
constraint — build it in, don't bolt it on.

---

## Sanity numbers (assert these; they protect the Q&A)

- German specific yield ≈ **950–1050 kWh/kWp/yr**. Assert baseline lands here or throw.
- Temperature-only derate from ~1–1.5 °C warming ≈ **~1% lifetime** — small. Do not headline a
  big number off mean derating alone.
- With accelerated degradation + heat-tail, a **2–4% lifetime** delta is credible. Report what the
  physics gives, **with the band**. Honesty is scored; overstating loses the jury Q&A.

---

## Calibration & validation

- **PVGIS** (EU's authoritative yield estimator) for the park's lat/lon gives expected annual
  yield. Tune `PR_nonthermal` until the baseline matches within a few %. Calibrate against the
  PVGIS multi-year normal, **not** one noisy historical year. "Baseline matches PVGIS within X%"
  is a killer Q&A line.
- Use pvlib **once** to cross-check the closed-form on a single year, then set it aside (it's not
  explainable enough for the hot path).

---

## Test plan (`pytest`)

- `test_known_value`: at `G=1000`, `T_amb` chosen so `T_cell=25` (i.e. `T_amb = 25 - 31.25`),
  expect `P_dc == P_rated`.
- `test_zero_irradiance`: `G=0` → `P=0` for any temp.
- `test_hotter_is_lower`: raising `T_amb` strictly lowers annual energy (property).
- `test_delta_sign`: climate-adjusted lifetime ≤ baseline.
- `test_yield_bounds`: baseline specific yield ∈ [900, 1100].
- `test_reproducible`: same seed → identical percentiles.

---

## Dev workflow

1. **Stub the inputs first** — synthetic typical year (a clean sinusoidal GHI + temp) and a linear
   `ΔT(t)`. Build the entire physics core + MC + percentiles against stubs so you're never blocked
   on the data feed. Hand the app a real-shaped `Prediction` on day one.
2. Swap in the real MaStR specs + Open-Meteo baseline + CDS deltas when the data module delivers.
3. `pytest` green → `python -m model.validate` (PVGIS) → expose `simulate()` to the app.

---

## Anti-goals (model-specific)

- ❌ Train / fit / regress anything on weather→output.
- ❌ Average SSP scenarios.
- ❌ Make irradiance/cloud projections a headline driver (uncertain — temperature is the signal).
- ❌ Double-count thermal loss in PR.
- ❌ Sample ΔT independently per year (decorrelates the trajectory).
- ❌ Overfit PR to a single noisy year instead of the PVGIS normal.
- ❌ Overstate the lifetime delta. Report the honest band.
