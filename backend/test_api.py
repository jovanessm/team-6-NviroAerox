"""
Run: python test_api.py
"""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from EnviroTrustAPI import EnviroTrustClient

# Placeholder coords — Bavarian solar region (Germany)
LAT = 48.37
LON = 10.89

if __name__ == "__main__":
    client = EnviroTrustClient()
    print(f"API key loaded: {client.api_key[:6]}...\n")

    print("=== /api/heat-wind/timeseries (2024–2054) ===")
    try:
        data = client.get_heat_wind_timeseries(LAT, LON, from_year=2024, to_year=2054)
        sample = data[:3] if isinstance(data, list) else data
        print(json.dumps(sample, indent=2))
    except Exception as e:
        print(f"ERROR: {e}")

    print("\n=== /api/climate_risk/risk_score ===")
    try:
        data = client.get_climate_risk_score(LAT, LON)
        print(json.dumps(data, indent=2))
    except Exception as e:
        print(f"ERROR: {e}")
