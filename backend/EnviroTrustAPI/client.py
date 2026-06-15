import os
import requests
from dotenv import load_dotenv

load_dotenv()

BASE_URL = "https://api.envirotrust.eu"


class EnviroTrustClient:
    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.getenv("ENVIROTRUST_API_KEY")
        if not self.api_key:
            raise ValueError("ENVIROTRUST_API_KEY not set")
        self.session = requests.Session()
        self.session.headers.update({"X-API-Key": self.api_key})

    def _get(self, path: str, params: dict) -> dict:
        response = self.session.get(f"{BASE_URL}{path}", params=params, timeout=30)
        response.raise_for_status()
        return response.json()

    def get_heat_wind_timeseries(self, lat: float, lon: float, from_year: int = 2024, to_year: int = 2054) -> dict:
        return self._get("/api/heat-wind/timeseries", {
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
