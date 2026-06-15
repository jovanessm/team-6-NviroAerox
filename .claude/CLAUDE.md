# CLAUDE.md

Context for working on this repo. Read before writing code. The decisions below are
**settled** — do not relitigate them mid-build, and flag (don't silently override) anything
that conflicts with them.

---

## What we're building

A tool that predicts the **lifetime energy output of real, operating German solar parks**
under a shifting climate, and shows how that prediction differs from the standard
history-based method. Hackathon entry for the EnviroTrust "Power, Seen From Orbit" challenge.

**One-sentence product:** the industry estimates a park's 30-year output from a "typical year"
built on past weather and holds it flat; we re-run the physics under Copernicus temperature
projections and show the gap, with an honest uncertainty band.

**User we pitch to:** a lender / insurer / owner doing due diligence or revaluation — someone
whose money rides on a number that was set on a climate that has since moved.

**Framing:** forecast-vs-forecast (standard method vs climate-adjusted). **NOT** forecast-vs-actuals
— per-park generation is not public in Germany (SMARD/ENTSO-E are zonal, MaStR is specs only).
Do not build anything that depends on real per-park output.

---

## Hard constraints (from the brief — these are guardrails, not suggestions)

1. **Real park, real specs.** Location, layout, and hardware come from public registries
   (Marktstammdatenregister). The site and hardware may NOT be invented. Climate inputs may be
   modeled/scenario-based.
2. **Every prediction carries uncertainty.** A single lifetime figure with no range/scenario/
   confidence is not a valid output. Everything ships as a distribution (P50/P90), per scenario.
3. **Explainable.** Any number must trace back to its inputs and assumptions. Carry a provenance
   object alongside every result so the UI can show "the inputs behind this point."

**Partner bonus:** the Copernicus *forward-looking projection* must visibly **move the number**.
The whole point is that the climate dimension changes the result vs leaning on historical weather.

---

## Settled technical decisions (and why)

- **Solar, not wind.** Temperature projections are high-confidence; wind projections are weak,
  noisy signal. Solar thermal derating is the cleanest physics-to-money chain and the best way
  to earn the partner bonus defensibly.
- **Climate dimension = thermal derating.** Rising ambient temp → lower panel efficiency.
  Temperature is the **headline signal**. Do NOT lean on irradiance/cloud-cover projections —
  they are nearly as uncertain as wind; include only if clearly labeled low-confidence, or omit.
- **No ML training.** There are no per-park labels, and a learned model would bake in the
  historical climate — the exact thing we're attacking. The "model" is a deterministic physics
  core + Monte Carlo uncertainty propagation. This is what makes it explainable. ML only appears
  as a *future-work scaling story* in the pitch (emulate the physics to score many parks fast).
- **Delta method for the climate signal.** Do NOT ingest and bias-correct full CMIP6 fields
  (it eats a day). Pull only the *temperature change signal* (ΔT per year for the grid cell, a
  few models × 2–3 SSPs) and superimpose it on the historical baseline. Robust, fast, and still
  earns the bonus because the projection is what moves the number.
- **Don't average SSP scenarios.** Run them as separate branches and show the spread.

---

## Magnitude honesty (important — protects the Q&A)

Mean-temperature derating alone is **small** (~1% lifetime for ~1–1.5°C warming at −0.4%/°C).
Do NOT headline an inflated number. To make the effect material *without cheating*, use:

- **Heat-tail:** rising frequency of extreme-heat days, where loss is disproportionate.
- **Temperature-accelerated degradation:** hotter panels age faster (Arrhenius, ~doubles per
  10°C); compounds over 30 years. This is the differentiated story.

Report what the physics gives, **with the band**. If the honest delta is 2–4%, say 2–4%.
Integrity here is a scored criterion ("knows what the data can and cannot say").

---

## Architecture & module split

Four parallel modules. Agree the data contract first; everyone builds against stubs.

| Module | Owner | Responsibility |
|---|---|---|
| `data/` | data | MaStR park specs, Open-Meteo/ERA5 baseline weather, CDS temperature deltas |
| `model/` | model | physics core + uncertainty engine + provenance (the prediction) |
| `app/` | frontend | Streamlit/web UI: pick park → fan chart (baseline vs adjusted) + headline + trace |
| `finance/` + pitch | finance | money translation (DSCR, revenue gap — illustrative), business case, pitch |

**Open question to resolve at kickoff:** the EnviroTrust "Climate Risks API" is likely hazard
*indicators*, not forward temperature *trajectories*. Confirm with the partner whether it returns
the time series we need and whether using it counts for the Copernicus bonus. Plan as if we still
need raw CDS for the temperature signal.

---

## The data contract (lock this hour one)

```python
# Inputs to model/
@dataclass
class ParkSpecs:          # from MaStR
    name: str
    lat: float; lon: float
    capacity_kwp: float
    gamma: float = -0.004        # power temp coefficient, 1/°C
    noct_c: float = 45.0
    tilt: float | None = None
    commissioned: int | None = None

@dataclass
class BaselineWeather:     # from Open-Meteo / ERA5, multi-year hourly
    ghi: np.ndarray          # W/m2, hourly
    temp_amb: np.ndarray     # °C, hourly
    # enough years to build a typical year AND sample interannual variability

@dataclass
class ClimateDeltas:       # from CDS (delta method)
    scenario: str            # "SSP1-2.6" | "SSP2-4.5" | "SSP5-8.5"
    dT_per_year: np.ndarray  # °C added to ambient, shape (n_years,)
    dT_model_std: np.ndarray # ensemble spread per year, shape (n_years,)

# Output from model/ (per scenario)
@dataclass
class Prediction:
    years: np.ndarray
    baseline_annual: np.ndarray      # flat-climate "standard method" line
    p10: np.ndarray; p50: np.ndarray; p90: np.ndarray   # climate-adjusted fan
    lifetime_p50: float; lifetime_p90: float
    delta_pct: float                 # lifetime adjusted vs baseline
    provenance: dict                 # inputs/assumptions behind any point
```

Stub these with fake-but-shaped data on day one so the frontend integrates immediately.

---

## The model (`model/`)

1. **Physics core — pure, deterministic, one year.** Closed-form NOCT:
   - `T_cell = T_amb + (NOCT - 20)/800 * GHI`
   - `P = capacity_kwp * (GHI/1000) * (1 + gamma * (T_cell - 25))`
   - sum hourly → annual energy, apply a performance-ratio loss stack (inverter/soiling/wiring).
   - Closed-form, NOT pvlib in the hot path — it's explainable and fast. Use pvlib *once* to
     calibrate PR, then set aside.
2. **Baseline.** Typical year held flat across all years (+ degradation). The lender's-view line.
3. **Climate-adjusted.** Each year, shift the typical year's temperature by `dT_per_year[t]`,
   re-run the core. Keep degradation in both lines so the delta is purely climate.
4. **Uncertainty engine (the centerpiece).** Monte Carlo over:
   - scenario (separate branches, never averaged)
   - climate-model spread (sample ΔT trajectory from `dT_model_std`)
   - interannual weather (sample different historical years)
   - parameters (γ, PR, degradation rate as small distributions)
   → P50/P90 fans + lifetime distribution. Add a **variance decomposition** (which source
   dominates at each horizon) if time allows — it's the best answer to "what the data can't say."

**Public API:** `simulate(park, baseline_weather, deltas, n_draws) -> Prediction` per scenario.

---

## Conventions

- **Python.** Physics core is a pure, unit-tested function; all randomness lives in the wrapper.
- **Validate the baseline against PVGIS** for the park's coordinates ("matches PVGIS within X%"
  is a Q&A win). Assert sane bounds: German specific yield ≈ 950–1050 kWh/kWp/yr — throw on
  out-of-range inputs rather than ship garbage.
- **Provenance everywhere.** Every Prediction carries the inputs/assumptions that produced it.
- Seed RNG for reproducible demos. Keep defaults (γ, NOCT, PR, degradation) in one config block.
- Tests: `pytest`. App: `streamlit run app/app.py`. Deps: `requirements.txt`.

---

## Anti-goals (do NOT do these)

- ❌ Train an ML model on weather → output. (No labels; bakes in past climate; un-explainable.)
- ❌ Hunt for per-park actual generation. (Not public in Germany. Kill on sight.)
- ❌ Build a broad platform / VLM satellite ingestion. Solar parks only (wind excluded — signal is weak).
- ❌ Average SSP scenarios into one line.
- ❌ Lean on irradiance/cloud projections as a headline driver.
- ❌ Overstate the lifetime delta. Report the honest band.
- ❌ Invent park specs or location.

---

## Demo target (what the code must serve)

One screen: pick a solar park from the map → annual output over 30 years, **flat baseline
line vs climate-trending P50 with a shaded scenario band**, one headline ("standard method:
X GWh lifetime; climate-adjusted P50: X−n%, P90: X−m%"), and a click that reveals the inputs
behind any point. Results are pre-computed at deploy time — UI response is instant.
Hits all three hard constraints, maxes the partner bonus, demos in 90 seconds.