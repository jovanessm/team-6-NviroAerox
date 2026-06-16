"""
Fetch mean wind speed (10 m) for each German solar park from Open-Meteo ERA5 archive.

Saves a single JSON: {park_name: mean_wind_m_s, ...}
Used by model/precompute.py --model faiman to set BaselineWeather.mean_wind_speed.

Retry and sleep pattern mirrors backend/CDS Data/main.py so you can switch
VPN mid-run or let it retry through rate limits without losing progress.

Usage:
    python "backend/GRW Data/fetch_wind_speed.py"              # all parks
    python "backend/GRW Data/fetch_wind_speed.py" --park 0    # one park
    python "backend/GRW Data/fetch_wind_speed.py" --dry-run   # preview

Output: backend/GRW Data/wind_speed.json
"""

import sys
import json
import time
import logging
import argparse

import requests
import numpy as np
from pathlib import Path
from datetime import date, timedelta

_repo_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_repo_root))

from model.parks import ALL_PARKS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

API_URL = "https://archive-api.open-meteo.com/v1/archive"
START_DATE = "2000-01-01"
END_DATE = (date.today() - timedelta(days=1)).isoformat()  # same as CDS Data/main.py
OUTPUT_PATH = Path(__file__).parent / "wind_speed.json"

# Sleep between parks — change VPN, avoid rate limits
SLEEP_BETWEEN_PARKS = 5   # seconds
RETRY_BASE_WAIT = 15      # seconds × attempt number (mirrors CDS Data/main.py)
REQUEST_TIMEOUT = 300     # seconds


def _fetch_mean_wind(lat: float, lon: float, retry: int = 3) -> float | None:
    """Fetch hourly wind_speed_10m, return the mean over the full period."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": START_DATE,
        "end_date": END_DATE,
        "hourly": "wind_speed_10m",
        "models": "era5",
        "timezone": "UTC",
        "wind_speed_unit": "ms",
    }
    for attempt in range(1, retry + 1):
        try:
            r = requests.get(API_URL, params=params, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()
            values = [v for v in r.json()["hourly"]["wind_speed_10m"] if v is not None]
            if not values:
                log.warning("    No wind values returned")
                return None
            return float(np.mean(values))
        except requests.exceptions.HTTPError as e:
            log.warning(f"    HTTP {e.response.status_code} attempt {attempt}: {e}")
        except requests.exceptions.RequestException as e:
            log.warning(f"    Request error attempt {attempt}: {e}")
        except Exception as e:
            log.warning(f"    Unexpected error attempt {attempt}: {e}")
        if attempt < retry:
            wait = RETRY_BASE_WAIT * attempt
            log.info(f"    Retrying in {wait}s …")
            time.sleep(wait)
    return None


def main(park_index: int | None = None, dry_run: bool = False) -> None:
    parks = [ALL_PARKS[park_index]] if park_index is not None else ALL_PARKS

    log.info("Wind speed fetcher — Open-Meteo ERA5 archive")
    log.info(f"Parks  : {len(parks)}  |  Period: {START_DATE} → {END_DATE}")
    log.info(f"Output : {OUTPUT_PATH.resolve()}")
    if dry_run:
        log.info("DRY RUN — no files will be written")
    log.info("")

    # Resume: load existing results
    existing: dict[str, float] = {}
    if OUTPUT_PATH.exists():
        with open(OUTPUT_PATH) as f:
            existing = json.load(f)
        log.info(f"Resuming — {len(existing)} parks already cached in {OUTPUT_PATH.name}")

    results = dict(existing)

    for i, park in enumerate(parks, 1):
        log.info(f"[{i}/{len(parks)}] {park.name}")

        if park.name in results:
            log.info(f"  SKIP — already fetched ({results[park.name]:.2f} m/s)")
            continue

        if dry_run:
            log.info(f"  DRY   lat={park.lat}, lon={park.lon}")
            continue

        log.info(f"  FETCH  lat={park.lat}, lon={park.lon}  {START_DATE}→{END_DATE} ...")
        mean_wind = _fetch_mean_wind(park.lat, park.lon)

        if mean_wind is None:
            log.error(f"  FAILED — {park.name} skipped (will retry next run)")
        else:
            results[park.name] = round(mean_wind, 3)
            log.info(f"  mean wind_speed_10m = {mean_wind:.2f} m/s")

            # Write after every successful park so progress survives interruption
            OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(OUTPUT_PATH, "w") as f:
                json.dump(results, f, indent=2)

        if i < len(parks):
            time.sleep(SLEEP_BETWEEN_PARKS)

    log.info("")
    log.info(f"✓ Done — {len(results)}/{len(ALL_PARKS)} parks in {OUTPUT_PATH.name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Fetch mean ERA5 wind_speed_10m for each solar park via Open-Meteo."
    )
    parser.add_argument(
        "--park", type=int, default=None, metavar="INDEX",
        help=f"Fetch only one park by index (0–{len(ALL_PARKS) - 1}). Omit to fetch all.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Preview parks without fetching",
    )
    args = parser.parse_args()

    if args.park is not None and not (0 <= args.park < len(ALL_PARKS)):
        parser.error(f"--park must be 0–{len(ALL_PARKS) - 1}")

    main(park_index=args.park, dry_run=args.dry_run)
