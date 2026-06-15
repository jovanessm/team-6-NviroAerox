"""
ERA5 Climate Data Fetcher via Open-Meteo — EnviroTrust
=======================================================
Fetches hourly ERA5 data for 20 renewable energy park locations across Germany,
covering 2000–2026.

✅ No API key required
✅ No account required
✅ No queue — data returned in seconds per location
✅ Powered by Open-Meteo (https://open-meteo.com), which serves ERA5 data
   directly via a free HTTP API

Variables fetched (wind + solar yield modelling):
  - wind_speed_10m          → wind speed at 10m, km/h
  - wind_speed_100m         → wind speed at turbine hub height 100m, km/h
  - wind_direction_10m      → wind direction at 10m, degrees
  - wind_direction_100m     → wind direction at 100m, degrees
  - shortwave_radiation     → solar irradiance GHI at surface, W/m²
  - temperature_2m          → air temperature at 2m, °C
  - surface_pressure        → atmospheric pressure, hPa
  - cloud_cover             → total cloud cover, %

Install dependencies:
  pip install requests pandas tqdm

Usage:
  python fetch_era5_parks.py                    # fetch all 20 parks
  python fetch_era5_parks.py --park 0           # fetch only park index 0
  python fetch_era5_parks.py --park 0 --dry-run # preview without downloading
"""

import requests
import pandas as pd
import time
import logging
import argparse
from datetime import date, timedelta
from pathlib import Path

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
OUTPUT_DIR  = Path("era5_data")
START_DATE  = "2000-01-01"
END_DATE    = (date.today() - timedelta(days=1)).isoformat()  # archive only has past data
API_URL     = "https://archive-api.open-meteo.com/v1/archive"

# Open-Meteo variable names for ERA5
VARIABLES = [
    "wind_speed_10m",       # Wind speed at 10m (km/h)
    "wind_speed_100m",      # Wind speed at 100m hub height (km/h)
    "wind_direction_10m",   # Wind direction at 10m (degrees)
    "wind_direction_100m",  # Wind direction at 100m (degrees)
    "shortwave_radiation",  # Solar irradiance GHI (W/m²)
    "temperature_2m",       # Air temperature at 2m (°C)
    "surface_pressure",     # Atmospheric pressure (hPa)
    "cloud_cover",          # Total cloud cover (%)
]

# ── 20 German renewable energy parks ─────────────────────────────────────────
PARKS = [
    # (name, type, state, lat, lon)
    ("Buergerwindpark_Reussenkoge",        "wind",  "Schleswig-Holstein",      54.627,  8.902),
    ("Windpark_Holtriem",                  "wind",  "Lower_Saxony",            53.610,  7.429),
    ("Eggebek_Solar_Park",                 "solar", "Schleswig-Holstein",      54.629,  9.343),
    ("Windpark_Kessin",                    "wind",  "Mecklenburg-Vorpommern",  53.727, 13.329),
    ("Solarpark_Weesow_Willmersdorf",      "solar", "Brandenburg",             52.652, 13.694),
    ("Solarpark_Gottesgabe_Neuhardenberg", "solar", "Brandenburg",             52.640, 14.189),
    ("Brandenburg_Briest_Solarpark",       "solar", "Brandenburg",             52.437, 12.451),
    ("Finsterwalde_Solar_Park",            "solar", "Brandenburg",             51.571, 13.750),
    ("Krughuette_Solar_Park",              "solar", "Saxony-Anhalt",           51.527, 11.521),
    ("Windpark_Druiberg",                  "wind",  "Saxony-Anhalt",           51.870, 11.020),
    ("Hesselbach_Wind_Farm",               "wind",  "North_Rhine-Westphalia",  50.908,  8.384),
    ("Windpark_Harz",                      "wind",  "Lower_Saxony",            51.750, 10.750),
    ("Windpark_Odervorland",               "wind",  "Brandenburg",             52.250, 14.650),
    ("Windpark_Veenhusen",                 "wind",  "Lower_Saxony",            53.310,  7.580),
    ("Solarpark_Meuro",                    "solar", "Brandenburg_Saxony",      51.530, 14.010),
    ("Windpark_Hohe_Geest",                "wind",  "Schleswig-Holstein",      54.050,  9.200),
    ("Ernsthof_Solar_Park",                "solar", "Baden-Wuerttemberg",      49.707,  9.475),
    ("Lauingen_Energy_Park",               "solar", "Bavaria",                 48.537, 10.424),
    ("Strasskirchen_Solar_Park",           "solar", "Bavaria",                 48.809, 12.755),
    ("Solarpark_Pocking",                  "solar", "Bavaria",                 48.368, 13.299),
]


CHUNK_YEARS = 2  # fetch in 2-year windows to avoid timeouts


def _year_chunks(start: str, end: str):
    """Yield (chunk_start, chunk_end) pairs in CHUNK_YEARS-sized windows."""
    s = date.fromisoformat(start)
    e = date.fromisoformat(end)
    while s <= e:
        chunk_end = date(min(s.year + CHUNK_YEARS - 1, e.year), 12, 31)
        if chunk_end > e:
            chunk_end = e
        yield s.isoformat(), chunk_end.isoformat()
        s = date(s.year + CHUNK_YEARS, 1, 1)


def _fetch_chunk(lat, lon, start, end, retry=3):
    params = {
        "latitude":        lat,
        "longitude":       lon,
        "start_date":      start,
        "end_date":        end,
        "hourly":          ",".join(VARIABLES),
        "models":          "era5",
        "timezone":        "UTC",
        "wind_speed_unit": "ms",
    }
    for attempt in range(1, retry + 1):
        try:
            r = requests.get(API_URL, params=params, timeout=120)
            r.raise_for_status()
            return pd.DataFrame(r.json()["hourly"])
        except requests.exceptions.HTTPError as e:
            log.warning(f"    HTTP {e.response.status_code} ({start}→{end}) attempt {attempt}: {e}")
        except requests.exceptions.RequestException as e:
            log.warning(f"    Request error ({start}→{end}) attempt {attempt}: {e}")
        except Exception as e:
            log.warning(f"    Unexpected error ({start}→{end}) attempt {attempt}: {e}")
        if attempt < retry:
            wait = 15 * attempt
            log.info(f"    Retrying in {wait}s …")
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

    chunks = list(_year_chunks(START_DATE, END_DATE))
    log.info(f"  FETCH {name}  ({ptype}, {state})  {len(chunks)} chunks × {CHUNK_YEARS}yr")

    frames = []
    for i, (c_start, c_end) in enumerate(chunks, 1):
        log.info(f"    chunk {i}/{len(chunks)}  {c_start} → {c_end}")
        df_chunk = _fetch_chunk(lat, lon, c_start, c_end)
        if df_chunk is None:
            log.error(f"  FAILED {name} — chunk {c_start}→{c_end} could not be fetched")
            return
        frames.append(df_chunk)
        if i < len(chunks):
            time.sleep(1)

    df = pd.concat(frames, ignore_index=True)
    df.rename(columns={"time": "datetime"}, inplace=True)
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

    log.info(f"EnviroTrust ERA5 Fetcher — Open-Meteo")
    log.info(f"Parks: {len(parks)}  |  Period: {START_DATE} → {END_DATE}")
    log.info(f"Output: {OUTPUT_DIR.resolve()}")
    if dry_run:
        log.info("DRY RUN — no files will be written")
    log.info("")

    for i, park in enumerate(parks, 1):
        log.info(f"[{i}/{len(parks)}] {park[0]}")
        fetch_park(park, dry_run=dry_run)
        # Be polite to the free API — small pause between requests
        if not dry_run and i < len(parks):
            time.sleep(1)

    log.info("")
    log.info("✓ All done.")
    if not dry_run:
        files = list(OUTPUT_DIR.glob("*.csv"))
        total_mb = sum(f.stat().st_size for f in files) / (1024 * 1024)
        log.info(f"  {len(files)} CSV files  |  {total_mb:.1f} MB total")


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Fetch ERA5 data for 20 German renewable energy parks via Open-Meteo (no API key needed)."
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