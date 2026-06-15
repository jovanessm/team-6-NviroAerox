"""
CMIP6 Future Climate Fetcher via Open-Meteo Climate API — EnviroTrust
======================================================================
Fetches daily CMIP6 future projections for 20 German renewable energy parks,
covering 2024–2050.

✅ No API key required
✅ No account required
✅ No queue — data returned in seconds per location
✅ Powered by Open-Meteo Climate API (https://open-meteo.com/en/docs/climate-api)

Variables fetched:
  - temperature_2m_mean      → daily mean ambient temp (°C) — thermal derating signal
  - temperature_2m_max       → daily max temp (°C) — heat-tail lever
  - shortwave_radiation_sum  → daily GHI (MJ/m²) — solar irradiance

Model: EC_Earth3P_HR (European consortium — best coverage for Germany)

Install dependencies:
  pip install requests pandas

Usage:
  python main.py                    # fetch all 20 parks
  python main.py --park 0           # fetch only park index 0
  python main.py --dry-run          # preview without downloading
"""

import requests
import pandas as pd
import time
import logging
import argparse
from datetime import date
from pathlib import Path

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
OUTPUT_DIR  = Path("future_data")
START_DATE  = "2024-01-01"
END_DATE    = "2050-12-31"
API_URL     = "https://climate-api.open-meteo.com/v1/climate"
MODEL       = "EC_Earth3P_HR"

VARIABLES = [
    "temperature_2m_mean",      # °C — thermal derating signal (headline)
    "temperature_2m_max",       # °C — heat-tail lever
    "shortwave_radiation_sum",  # MJ/m² — solar irradiance (GHI)
]

# ── 9 German solar parks (mirrors CDS Data/main.py) ─────────────────────────
PARKS = [
    # (name, type, state, lat, lon)
    ("Eggebek_Solar_Park",                 "solar", "Schleswig-Holstein",  54.629,  9.343),
    ("Solarpark_Weesow_Willmersdorf",      "solar", "Brandenburg",         52.652, 13.694),
    ("Solarpark_Gottesgabe_Neuhardenberg", "solar", "Brandenburg",         52.640, 14.189),
    ("Brandenburg_Briest_Solarpark",       "solar", "Brandenburg",         52.437, 12.451),
    ("Finsterwalde_Solar_Park",            "solar", "Brandenburg",         51.571, 13.750),
    ("Krughuette_Solar_Park",              "solar", "Saxony-Anhalt",       51.527, 11.521),
    ("Solarpark_Meuro",                    "solar", "Brandenburg_Saxony",  51.530, 14.010),
    ("Ernsthof_Solar_Park",                "solar", "Baden-Wuerttemberg",  49.707,  9.475),
    ("Lauingen_Energy_Park",               "solar", "Bavaria",             48.537, 10.424),
    ("Strasskirchen_Solar_Park",           "solar", "Bavaria",             48.809, 12.755),
    ("Solarpark_Pocking",                  "solar", "Bavaria",             48.368, 13.299),
]

def _fetch_park_data(lat, lon, retry=3):
    """Fetch full date range in one request — climate API handles 26-year spans fine."""
    params = {
        "latitude":   lat,
        "longitude":  lon,
        "start_date": START_DATE,
        "end_date":   END_DATE,
        "models":     MODEL,
        "daily":      ",".join(VARIABLES),
        "timezone":   "UTC",
    }
    for attempt in range(1, retry + 1):
        try:
            r = requests.get(API_URL, params=params, timeout=120)
            r.raise_for_status()
            return pd.DataFrame(r.json()["daily"])
        except requests.exceptions.HTTPError as e:
            log.warning(f"    HTTP {e.response.status_code} attempt {attempt}: {e}")
        except requests.exceptions.RequestException as e:
            log.warning(f"    Request error attempt {attempt}: {e}")
        except Exception as e:
            log.warning(f"    Unexpected error attempt {attempt}: {e}")
        if attempt < retry:
            wait = 60 * attempt
            log.info(f"    Retrying in {wait}s ...")
            time.sleep(wait)
    return None


def fetch_park(park: tuple, dry_run: bool = False) -> None:
    name, ptype, state, lat, lon = park

    OUTPUT_DIR.mkdir(exist_ok=True)
    out_file = OUTPUT_DIR / f"{name}.csv"

    if out_file.exists():
        log.info(f"  SKIP  {name}  (already downloaded → {out_file})")
        return

    if dry_run:
        log.info(f"  DRY   {name}  ({ptype}, {state})  lat={lat}, lon={lon}")
        return

    log.info(f"  FETCH {name}  ({ptype}, {state})  {START_DATE} → {END_DATE}")
    df = _fetch_park_data(lat, lon)
    if df is None:
        log.error(f"  FAILED {name}")
        return

    df.rename(columns={"time": "date"}, inplace=True)
    df.insert(0, "park",  name)
    df.insert(1, "type",  ptype)
    df.insert(2, "state", state)
    df.insert(3, "lat",   lat)
    df.insert(4, "lon",   lon)

    df.to_csv(out_file, index=False)
    rows = len(df)
    size_kb = out_file.stat().st_size / 1024
    log.info(f"  DONE  {name}  → {out_file}  ({rows:,} rows, {size_kb:.0f} KB)")


def main(park_index: int = None, dry_run: bool = False) -> None:
    parks = [PARKS[park_index]] if park_index is not None else PARKS

    log.info("EnviroTrust CMIP6 Future Fetcher — Open-Meteo Climate API")
    log.info(f"Model: {MODEL}  |  Parks: {len(parks)}  |  Period: {START_DATE} → {END_DATE}")
    log.info(f"Output: {OUTPUT_DIR.resolve()}")
    if dry_run:
        log.info("DRY RUN — no files will be written")
    log.info("")

    for i, park in enumerate(parks, 1):
        log.info(f"[{i}/{len(parks)}] {park[0]}")
        fetch_park(park, dry_run)
        if not dry_run and i < len(parks):
            time.sleep(5)

    log.info("")
    log.info("✓ All done.")
    if not dry_run:
        files = list(OUTPUT_DIR.glob("*.csv"))
        total_mb = sum(f.stat().st_size for f in files) / (1024 * 1024)
        log.info(f"  {len(files)} CSV files  |  {total_mb:.1f} MB total")


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Fetch CMIP6 future climate projections for 20 German renewable parks via Open-Meteo (no API key)."
    )
    parser.add_argument(
        "--park",
        type=int,
        default=None,
        metavar="INDEX",
        help=f"Fetch only one park by index (0–{len(PARKS)-1}). Omit to fetch all.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview what would be fetched without downloading anything.",
    )
    args = parser.parse_args()

    if args.park is not None and not (0 <= args.park < len(PARKS)):
        parser.error(f"--park must be 0–{len(PARKS)-1}")

    main(park_index=args.park, dry_run=args.dry_run)
