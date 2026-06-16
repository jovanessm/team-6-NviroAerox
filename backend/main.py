import json
from pathlib import Path
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from EnviroTrustAPI import EnviroTrustClient

CLIMATE_SOURCES = ("cmip6", "envirotrust")
CELL_TEMP_MODELS = ("noct", "faiman")

# 4 precomputed outputs, keyed by (climate, model)
PRECOMPUTED_PATHS = {
    (climate, model): Path(__file__).parent / f"precomputed_{climate}_{model}.json"
    for climate in CLIMATE_SOURCES
    for model in CELL_TEMP_MODELS
}


def _load_precomputed(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path) as f:
        return json.load(f)


# Load all four (climate × model) datasets at startup; serve from memory
_data = {key: _load_precomputed(path) for key, path in PRECOMPUTED_PATHS.items()}
_indexes: dict = {key: {p["id"]: p for p in d.get("parks", [])} for key, d in _data.items()}

# Fallback for park listing: prefer CMIP6 × NOCT, else the first non-empty dataset
_default_data = _data.get(("cmip6", "noct")) or next((d for d in _data.values() if d), {})
_default_index = _indexes.get(("cmip6", "noct")) or next((i for i in _indexes.values() if i), {})


app = FastAPI(
    title="EnviroTrust Solar Model API",
    version="1.0",
    description=(
        "Serves pre-computed solar park lifetime predictions.\n\n"
        "- **GET /api/parks** — list all parks\n"
        "- **GET /api/parks/{id}** — park metadata\n"
        "- **POST /api/predict** — lifetime prediction for a park + scenario\n"
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = EnviroTrustClient()


@app.get("/")
def root():
    return {
        "status": "ok",
        "parks_loaded": len(_default_index),
        "datasets": {f"{c}_{m}": len(_indexes[(c, m)]) for (c, m) in PRECOMPUTED_PATHS},
        "docs": "/docs",
    }


# ── Pre-computed prediction endpoints ─────────────────────────────────────────

@app.get("/api/parks")
def list_parks():
    """All solar parks with metadata (no scenario data)."""
    return [
        {
            "id": p["id"],
            "name": p["name"],
            "lat": p["lat"],
            "lon": p["lon"],
            "capacity_kwp": p["capacity_kwp"],
            "commissioned": p.get("commissioned"),
        }
        for p in _default_data.get("parks", [])
    ]


@app.get("/api/parks/{park_id}")
def get_park(park_id: str):
    """Single park metadata."""
    park = _default_index.get(park_id)
    if not park:
        raise HTTPException(status_code=404, detail=f"Park '{park_id}' not found")
    return {k: v for k, v in park.items() if k != "scenarios"}


@app.post("/api/predict")
def predict(body: dict):
    """
    Return pre-computed prediction for a park + scenario + climate source + model.

    Body: {"parkId": "Eggebek_Solar_Park", "scenario": "RCP4.5",
           "climate": "cmip6", "model": "noct"}
    - scenario defaults to "RCP4.5"
    - climate: "cmip6" (default, CMIP6 ensemble; RCP2.6/4.5/8.5) or
               "envirotrust" (EnviroTrust daily-max field; RCP4.5/8.5 only)
    - model: "noct" (default, standard NOCT T_cell) or "faiman" (Faiman + satellite wind)
    """
    park_id = body.get("parkId") or body.get("park_id")
    scenario = body.get("scenario", "RCP4.5")
    climate = body.get("climate", "cmip6").lower()
    model = body.get("model", "noct").lower()

    if climate not in CLIMATE_SOURCES:
        raise HTTPException(status_code=400, detail=f"climate must be one of {list(CLIMATE_SOURCES)}")
    if model not in CELL_TEMP_MODELS:
        raise HTTPException(status_code=400, detail=f"model must be one of {list(CELL_TEMP_MODELS)}")

    parks_index = _indexes.get((climate, model), {})
    if not parks_index:
        raise HTTPException(
            status_code=503,
            detail=(f"precomputed_{climate}_{model}.json not found — run: "
                    f"python -m model.precompute --climate {climate} --model {model}"),
        )

    park = parks_index.get(park_id)
    if not park:
        raise HTTPException(status_code=404, detail=f"Park '{park_id}' not found")

    scenarios = park.get("scenarios", {})
    if scenario not in scenarios:
        raise HTTPException(
            status_code=404,
            detail=f"Scenario '{scenario}' not found. Available: {list(scenarios.keys())}",
        )

    result = scenarios[scenario]
    return {
        "parkId": park_id,
        "parkName": park["name"],
        "scenario": scenario,
        "climate": climate,
        "model": model,
        "lat": park["lat"],
        "lon": park["lon"],
        "capacity_kwp": park["capacity_kwp"],
        **result,
    }


@app.get("/api/predict/{park_id}")
def predict_get(
    park_id: str,
    scenario: str = Query("RCP4.5"),
    climate: str = Query("cmip6", description="'cmip6' or 'envirotrust'"),
    model: str = Query("noct", description="'noct' or 'faiman'"),
):
    """GET variant of /api/predict for browser-friendly access."""
    return predict({"parkId": park_id, "scenario": scenario, "climate": climate, "model": model})


@app.get("/api/heat-wind/timeseries")
def heat_wind_timeseries(
    lat: float = Query(48.37, description="Latitude"),
    lon: float = Query(10.89, description="Longitude"),
    from_year: int = Query(2024, description="Start year"),
    to_year: int = Query(2054, description="End year"),
):
    try:
        return client.get_heat_wind_timeseries(lat, lon, from_year, to_year)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/climate-risk/score")
def climate_risk_score(
    lat: float = Query(48.37, description="Latitude"),
    lon: float = Query(10.89, description="Longitude"),
):
    try:
        return client.get_climate_risk_score(lat, lon)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/heat-wind/daily", summary="Historical daily temps → builds BaselineWeather typical year")
def heat_wind_daily(
    lat: float = Query(48.37, description="Latitude"),
    lon: float = Query(10.89, description="Longitude"),
    from_date: str = Query("2020-01-01", description="Start date (YYYY-MM-DD)"),
    to_date: str = Query("2023-12-31", description="End date (YYYY-MM-DD)"),
):
    """10 years of daily temps — enough to build a typical year and sample interannual variability."""
    try:
        return client.get_heat_wind_daily(lat, lon, from_date, to_date)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/wildfire/timeseries", summary="Extreme-heat days per year → heat-tail lever in physics model")
def wildfire_timeseries(
    lat: float = Query(48.37, description="Latitude"),
    lon: float = Query(10.89, description="Longitude"),
    from_year: int = Query(2024, description="Start year"),
    to_year: int = Query(2054, description="End year"),
):
    """days_very_high_fire_danger rising over time = proxy for heatwave frequency increase."""
    try:
        return client.get_wildfire_timeseries(lat, lon, from_year, to_year)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
