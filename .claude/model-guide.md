# Model Implementation Guide

Working context for building the prediction model. **Supplements the root `CLAUDE.md`** —
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

Defaults (`config.py`): `gamma = -0.0045 /°C` (Trina TSM-PC05 datasheet), `NOCT = 45 °C`,
`PR_nonthermal = 0.87`, `d0 = 0.007/yr` (Trina warranty, max 0.7%/yr).

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

For year `t` in `0..N-1` (N = 30, `LIFETIME_YEARS`):

- **Baseline ("standard method"):** a sampled historical year, no climate shift,
  `E_base(t) = E_year_base * (1-d0)^t`.
- **Climate-adjusted:** the **same** sampled year (common random numbers — see uncertainty
  engine), temperature shifted by the scenario delta `T_amb(t) = T_amb + ΔT(t)`, re-run the core →
  `E_year_adj(t)`, then apply accelerated degradation.
- Degradation default `d0 = 0.007/yr`. Keep degradation in **both** lines so the reported delta
  is purely climate.

**Two levers make the climate signal material (mean derating alone is small — see Sanity).**
Both are wired in and both belong only in the adjusted line:

- **Temperature-accelerated degradation:** `d(t) = d0 * 2**(ΔT(t)/10)` (degradation ~doubles per
  10 °C, Arrhenius). Compounds over 30 years. Cumulative factor = `prod over t of (1 - d(t))`.
  (`degradation.py`, `accelerated=True`.)
- **Heat-tail:** on top of the mean ΔT shift, add an extra bump to the hottest 10% of hours.
  The bump is `0.5 * ΔT(t)` — hot extremes in Central Europe warm ~1.5× the mean (IPCC AR6 WGI
  Ch.11), so the hottest hours get the mean shift plus half again. Derived from the same CMIP6
  ensemble (`cmip6.heat_tail_from_deltas`), **not** the EnviroTrust wildfire day-count (noise).

---

## The uncertainty engine (the centerpiece)

Monte Carlo, output shape `(n_draws, n_years)`. `n_draws ≈ 3000`. **Seed the RNG** for
reproducible demos. Vectorize with numpy broadcasting — no per-draw Python loop.

Four sources, sampled per draw:

1. **Scenario (RCP).** Discrete branches `{RCP2.6, RCP4.5, RCP8.5}`. **Run each separately;
   never average them.** Each yields its own fan. (RCP not SSP — see ΔT source below.)
2. **Climate-model spread.** `ΔT(t) = dT_mean(t) + m * dT_std(t)` where `m ~ N(0,1)` is drawn
   **once per draw** and shared across all years. **Do NOT sample ΔT independently per year** —
   that decorrelates the trajectory (a "hot" model stays hot) and underestimates the real spread.
3. **Interannual weather.** Resample whole historical years from the multi-year baseline for each
   future year. Resampling real years (not adding noise) preserves the temp↔irradiance correlation.
4. **Parameters.** `gamma ~ N(-0.0045, 2e-4)`, `PR ~ N(0.87, 0.02)`, `d0 ~ N(0.007, 5e-4)` per draw.

**Common random numbers (critical).** Within each draw/year the baseline and adjusted paths share
the **same** sampled weather year *and* the same parameter draws — they differ only by the climate
signal (ΔT + heat-tail + Arrhenius). This cancels interannual GHI variance (~5–10%) from the delta
instead of letting it swamp the ~0.3–0.6% climate signal. The headline `delta_pct` is the **mean of
per-draw paired lifetime differences**, not a difference of summed percentiles (which would mix
mean/median statistics and can flip the sign). Without CRN the lifetime delta came out the wrong
sign — RCP8.5 looked better than RCP4.5.

Aggregate per scenario → `P10/P50/P90` per year (the fan, from the adjusted distribution; includes
weather spread) and a lifetime-energy distribution → `lifetime_p50`, `lifetime_p90`, `delta_pct`.
The baseline flat line is the **median** sampled year (same statistic as the P50 fan).

**Variance decomposition (do if time):** at each horizon, split total variance into weather /
model-spread / scenario contributions. Run with model-spread frozen to isolate weather; difference
gives model-spread; variance of per-scenario means gives scenario. This is the strongest "what the
data can't say" artifact and the intellectual money-shot.

---

## The ΔT signal source (where the climate dimension comes from)

**Use the CMIP6 multi-model ensemble, not the EnviroTrust temperature field.** The EnviroTrust
"daily max temperature" series is an annual *extreme* (hottest single day), swings ±2–3 °C
year-to-year, and carries **no usable warming trend** — at most parks it trends toward *cooling*
under RCP8.5. It is unusable as the thermal-derating driver. (Its wildfire day-count is noise too.)

Instead (`cmip6.py`):

- Pull `temperature_2m_mean` from the **Open-Meteo Climate API, 7 HighResMIP models** (all SSP5-8.5),
  2024–2050, per park lat/lon. Cached to `backend/cmip6_cache/`.
- Fit each model's annual-mean warming **trend** (denoises ~0.5 °C interannual wiggle to a clean
  slope). `ΔT(t) = mean slope × t`; `dT_std(t) = across-model std × t` — a **real** ensemble spread,
  replacing the old 30%-of-delta proxy.
- The ensemble is SSP5-8.5, so it **is** RCP8.5. RCP4.5 = ensemble × 0.80, RCP2.6 = ensemble × 0.60
  (IPCC AR6 WGI Central Europe near-term ratios vs SSP5-8.5: ~1.6/1.2/2.0 °C by 2041–60).
- Mean ambient temp is the correct derating variable anyway (CLAUDE.md: temperature is the signal).

Result: ~0.6–1.2 °C warming over 30 yr, ordered RCP2.6 < RCP4.5 < RCP8.5 at every park, all models
agreeing on the sign. `source` / `std_source` ride on `ClimateDeltas` into every `Prediction.provenance`.

## Module layout (`model/`)

```
model/
  config.py            # defaults: gamma, NOCT, PR, d0, n_draws, seed, scenario list, yield bounds
  physics.py           # cell_temp(), dc_power(), annual_energy()  — PURE, unit-tested
  typical_year.py      # build_typical_year(); sample_year() for MC
  cmip6.py             # CMIP6 ensemble fetch → ClimateDeltas + heat_tail; scenario scaling
  climate.py           # apply_delta(); heat_tail()
  degradation.py       # degradation_factor() incl. accelerated (Arrhenius) option
  montecarlo.py        # simulate() — CRN sampling, aggregation, percentiles, provenance
  validate.py          # check_specific_yield() + validate_prediction() asserts
  finance.py           # energy_to_revenue() — illustrative € translation (SMARD price)
  parks.py             # the 10 real MaStR parks (specs + ERA5 lat/lon)
  cmip6.py             # CMIP6 ensemble ΔT (default climate source; RCP2.6/4.5/8.5)
  envirotrust.py       # EnviroTrust daily-max ΔT (comparison source; RCP4.5/8.5, warming forced)
  precompute.py        # all parks × scenarios → backend/precomputed_{climate}_{model}.json (4 files)
  pvgis_calibration.py # baseline-vs-PVGIS check (see Calibration)
  tests/
```

(`cmip6.py` is the headline ΔT driver. `envirotrust.py` re-introduces the EnviroTrust daily-max
field — not as the climate driver, but as the second leg of a CMIP6-vs-EnviroTrust source
comparison; its noisy/cooling trend is forced to a warming direction and stamped into provenance.)

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

- German specific yield spans north→south. Bounds asserted in `config.py` are **800–1200
  kWh/kWp/yr** (Schleswig-Holstein typical year ≈ 860–960; Bavaria ≈ 1000–1050). `simulate()` calls
  `check_specific_yield()` on the typical year before the MC loop and throws if out of range.
- Temperature-only derate from ~1 °C warming ≈ **a few tenths of a percent lifetime** — small.
- **What we actually report:** with the CMIP6 ensemble (~0.6–1.2 °C near-term warming) plus
  accelerated degradation + heat-tail, the honest lifetime delta is **~0.3% (RCP2.6) → ~0.6%
  (RCP8.5)**, ordered correctly at every park. This is below the 2–4% the levers *could* give under
  larger warming — the near-term HighResMIP trend is modest. **Report what the physics gives, with
  the band.** Honesty is scored; the correctly-signed monotonic ordering across scenarios is the win,
  not the magnitude.

---

## Calibration & validation

- **PVGIS** (EU's authoritative yield estimator). `model/pvgis_calibration.py` compares our
  typical-year baseline to PVGIS-ERA5 for all 10 parks. **Current result: +8.4% (systematic).**
  Cause: the closed-form NOCT core omits spectral + angular-reflection corrections PVGIS applies.
  - **Why it doesn't undermine the result:** the offset sits equally on the baseline and the
    adjusted line (same physics), so it **cancels in the delta**. The climate signal comes purely
    from ΔT, which is independent of the absolute calibration. Say this directly in Q&A.
  - **Open option:** re-tune `PR_nonthermal` down (~0.80) to absorb the +8% so the baseline matches
    PVGIS within a few %. Not yet done — we widened the yield bounds instead and documented the
    offset. Either is defensible; tuning PR makes the "matches PVGIS within X%" line cleaner.
- Use pvlib **once** to cross-check the closed-form on a single year, then set it aside (it's not
  explainable enough for the hot path).

---

## Test plan (`pytest`) — all implemented, 11 passing

`model/tests/test_physics.py`:
- `test_known_value`: at `G=1000`, `T_cell=25` → `P_dc == P_rated`.
- `test_zero_irradiance`: `G=0` → `P=0` for any temp.
- `test_hotter_is_lower`: raising `T_amb` strictly lowers annual energy (property).
- `test_delta_sign`: with a large unambiguous warming signal, RCP8.5 lifetime P50 < RCP4.5.
- `test_yield_bounds`: multi-year **mean** specific yield ∈ [800, 1200] (use the mean, not one
  noisy year).
- `test_reproducible`: same seed → identical `p50` and `baseline_annual`.

`model/tests/test_cmip6_pipeline.py`:
- `test_full_pipeline_cmip6`: cached CMIP6 ensemble → 3 scenarios → `simulate()`; asserts warming
  ordered RCP2.6<RCP4.5<RCP8.5, fans monotone (p10≤p50≤p90), every delta a small **loss**, and
  lifetime loss grows with warming. Skips if ERA5/CMIP6 cache absent.

---

## Dev workflow

1. Real MaStR specs (`parks.py`) + ERA5 baseline (`backend/CDS Data/era5_data/`) + CMIP6 ensemble
   deltas (`cmip6.py`, cached) are all wired. `simulate()` is the public entry point.
2. Regenerate results: `python -m model.precompute --all` → the 4 `backend/precomputed_{climate}_{model}.json`
   files (10 parks × scenarios, served instantly by the backend API). A single combo is
   `--climate {cmip6,envirotrust} --model {noct,faiman}`; use `--dry-run` to validate data without MC.
3. `pytest` green → `python -m model.pvgis_calibration` (PVGIS check) → results flow to the app via
   the `precomputed_*.json` files.

**Note for the app team:** the frontend `ParkForecast.tsx` still uses a synthetic `buildWarmingData()`
+ continuous warming slider — it does not yet read the real 3-scenario numbers from the API. The
model output is correct and waiting; wiring it in is the app team's task.

---

## Anti-goals (model-specific)

- ❌ Train / fit / regress anything on weather→output.
- ❌ Average RCP scenarios.
- ❌ Make irradiance/cloud projections a headline driver (uncertain — temperature is the signal).
- ❌ Double-count thermal loss in PR.
- ❌ Sample ΔT independently per year (decorrelates the trajectory).
- ❌ Use the EnviroTrust daily-max-temp or wildfire fields as a climate trend — they're annual
  extremes / counts, pure noise, no usable signal (RCP8.5 trended toward *cooling*). Use the CMIP6
  mean-temp ensemble.
- ❌ Compute the climate delta from a difference of summed percentiles — mixes mean/median and can
  flip the sign. Use paired per-draw differences (common random numbers).
- ❌ Overfit PR to a single noisy year instead of the PVGIS normal.
- ❌ Overstate the lifetime delta. Report the honest band.
