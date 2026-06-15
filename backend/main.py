from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from EnviroTrustAPI import EnviroTrustClient

app = FastAPI(title="EnviroTrust Data Explorer", version="1.0")

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
