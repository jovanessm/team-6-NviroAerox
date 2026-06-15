from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from EnviroTrustAPI import EnviroTrustClient

app = FastAPI(
    title="EnviroTrust Data Explorer",
    version="1.0",
    description=(
        "Fetches only the data needed for the solar thermal derating model:\n\n"
        "- **heat-wind/timeseries** — yearly temp projections + heatwaves (RCP4.5/8.5) → ClimateDeltas\n"
        "- **heat-wind/daily** — historical daily temps → BaselineWeather typical year\n"
        "- **wildfire/timeseries** — extreme-heat days per year → heat-tail lever\n"
        "- **climate-risk/score** — location heat risk score\n"
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
    return {"status": "ok", "docs": "/docs"}


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
