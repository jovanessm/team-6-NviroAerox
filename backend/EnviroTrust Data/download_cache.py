"""
Pre-download EnviroTrust API data for all static parks and save as CSV.

Saves to backend/EnviroTrust Data/cache/{lat}_{lon}_timeseries.csv
                                        {lat}_{lon}_wildfire.csv

Run once (needs ENVIROTRUST_API_KEY in env or backend/.env):
    python "backend/EnviroTrust Data/download_cache.py"
    python "backend/EnviroTrust Data/download_cache.py" --dry-run
"""

import sys
import time
import logging
import argparse
import pandas as pd
from pathlib import Path
from dotenv import load_dotenv

_repo_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_repo_root))
sys.path.insert(0, str(_repo_root / "backend"))

load_dotenv(Path(__file__).parent.parent / ".env")

from model.parks import ALL_PARKS
from EnviroTrustAPI.client import EnviroTrustClient, _cache_key

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).parent / "cache"
FROM_YEAR = 2024
TO_YEAR = 2054


def download_park(client: EnviroTrustClient, park, dry_run: bool = False) -> bool:
    key = _cache_key(park.lat, park.lon)
    ts_path = CACHE_DIR / f"{key}_timeseries.csv"
    wf_path = CACHE_DIR / f"{key}_wildfire.csv"

    if ts_path.exists() and wf_path.exists():
        log.info(f"  SKIP {park.name} — cache already exists")
        return True

    if dry_run:
        log.info(f"  DRY  {park.name}  lat={park.lat}, lon={park.lon}  →  {ts_path.name}, {wf_path.name}")
        return True

    log.info(f"  FETCH {park.name}  (lat={park.lat}, lon={park.lon})")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    if not ts_path.exists():
        try:
            raw = client.get_heat_wind_timeseries(park.lat, park.lon, FROM_YEAR, TO_YEAR)
            rows = raw["heat_wind_timeseries_data"]
            df = pd.DataFrame(rows)
            df.to_csv(ts_path, index=False)
            log.info(f"    timeseries → {ts_path.name}  ({len(df)} rows)")
            time.sleep(2)
        except Exception as e:
            log.error(f"    timeseries FAILED: {e}")
            return False

    if not wf_path.exists():
        try:
            raw = client.get_wildfire_timeseries(park.lat, park.lon, FROM_YEAR, TO_YEAR)
            data = raw["wildfire_risk_timeseries_data"]
            rows = [{"year": int(yr), **vals} for yr, vals in data.items()]
            df = pd.DataFrame(rows).sort_values("year")
            df.to_csv(wf_path, index=False)
            log.info(f"    wildfire   → {wf_path.name}  ({len(df)} rows)")
            time.sleep(2)
        except Exception as e:
            log.error(f"    wildfire FAILED: {e}")
            return False

    return True


def main(dry_run: bool = False) -> None:
    log.info("EnviroTrust cache downloader")
    log.info(f"Parks: {len(ALL_PARKS)}  |  Period: {FROM_YEAR}–{TO_YEAR}")
    log.info(f"Output: {CACHE_DIR.resolve()}")
    if dry_run:
        log.info("DRY RUN — no files will be written")

    client = None if dry_run else EnviroTrustClient()

    failed = []
    for i, park in enumerate(ALL_PARKS, 1):
        log.info(f"\n[{i}/{len(ALL_PARKS)}] {park.name}")
        ok = download_park(client, park, dry_run)
        if not ok:
            failed.append(park.name)
        if not dry_run and i < len(ALL_PARKS):
            time.sleep(3)

    log.info("\n✓ Done.")
    if failed:
        log.warning(f"Failed ({len(failed)}): {', '.join(failed)}")
    else:
        files = list(CACHE_DIR.glob("*.csv")) if CACHE_DIR.exists() else []
        log.info(f"{len(files)} CSV files in {CACHE_DIR.name}/")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pre-download EnviroTrust API data for all parks.")
    parser.add_argument("--dry-run", action="store_true", help="Preview without downloading")
    args = parser.parse_args()
    main(dry_run=args.dry_run)
