import os
import json
import requests
import pandas as pd
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_URL = "https://api.envirotrust.eu"
CACHE_DIR = Path(__file__).parent.parent / "EnviroTrust Data" / "cache"


def _cache_key(lat: float, lon: float) -> str:
    return f"{lat:.3f}_{lon:.3f}"


def _load_timeseries_csv(lat: float, lon: float) -> list[dict] | None:
    path = CACHE_DIR / f"{_cache_key(lat, lon)}_timeseries.csv"
    if not path.exists():
        return None
    df = pd.read_csv(path)
    return df.to_dict(orient="records")


def _load_wildfire_csv(lat: float, lon: float) -> dict | None:
    path = CACHE_DIR / f"{_cache_key(lat, lon)}_wildfire.csv"
    if not path.exists():
        return None
    df = pd.read_csv(path)
    return {
        str(int(row["year"])): {k: v for k, v in row.items() if k != "year"}
        for _, row in df.iterrows()
    }


class EnviroTrustClient:
    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.getenv("ENVIROTRUST_API_KEY")
        self._session: requests.Session | None = None

    def _get_session(self) -> requests.Session:
        if self._session is None:
            if not self.api_key:
                raise ValueError("ENVIROTRUST_API_KEY not set and no local cache found")
            self._session = requests.Session()
            self._session.headers.update({"X-API-Key": self.api_key})
        return self._session

    def _get(self, path: str, params: dict) -> dict:
        response = self._get_session().get(f"{BASE_URL}{path}", params=params, timeout=30)
        response.raise_for_status()
        return response.json()

    def get_heat_wind_timeseries(self, lat: float, lon: float, from_year: int = 2024, to_year: int = 2054) -> dict:
        cached = _load_timeseries_csv(lat, lon)
        if cached is not None:
            return {"heat_wind_timeseries_data": cached}
        return self._get("/api/heat-wind/timeseries", {
            "latitude": lat,
            "longitude": lon,
            "from_year": from_year,
            "to_year": to_year,
        })

    def get_wildfire_timeseries(self, lat: float, lon: float, from_year: int = 2024, to_year: int = 2054) -> dict:
        cached = _load_wildfire_csv(lat, lon)
        if cached is not None:
            return {"wildfire_risk_timeseries_data": cached}
        return self._get("/api/wildfire/timeseries", {
            "latitude": lat,
            "longitude": lon,
            "from_year": from_year,
            "to_year": to_year,
        })

    def get_climate_risk_score(self, lat: float, lon: float) -> dict:
        return self._get("/api/climate_risk/risk_score", {
            "latitude": lat,
            "longitude": lon,
        })

    def get_heat_wind_daily(self, lat: float, lon: float, from_date: str | None = None, to_date: str | None = None) -> dict:
        params: dict = {"latitude": lat, "longitude": lon}
        if from_date:
            params["from_date"] = from_date
        if to_date:
            params["to_date"] = to_date
        return self._get("/api/heat-wind/daily", params)
