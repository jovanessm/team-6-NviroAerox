"""
SMARD Day-Ahead Electricity Price Fetcher — EnviroTrust
=======================================================
Fetches German day-ahead wholesale electricity prices (€/MWh) from SMARD
(Bundesnetzagentur) for revenue modelling.

Data availability: SMARD prices start ~2011-12-01. Pre-2011 data is not
available on this platform.

✅ No API key required
✅ Official German electricity market data (Bundesnetzagentur)

Output: price_data/germany_dayahead_prices.csv
  columns: datetime (UTC), price_eur_mwh

Usage:
    python fetch_smard_prices.py
"""

import requests
import pandas as pd
import time
import logging
from pathlib import Path
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

OUTPUT_DIR  = Path("price_data")
OUTPUT_FILE = OUTPUT_DIR / "germany_dayahead_prices.csv"

BASE_URL   = "https://www.smard.de/app/chart_data"
FILTER_ID  = 4169      # EPEX Spot DE-LU Day-Ahead auction price
REGION     = "DE-LU"
RESOLUTION = "hour"

# SMARD data starts here — no price data available before this
SMARD_START = datetime(2011, 12, 1)
FETCH_END   = datetime(2026, 6, 15)


def _fetch_index() -> list[int]:
    url = f"{BASE_URL}/{FILTER_ID}/{REGION}/index_{RESOLUTION}.json"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()["timestamps"]


def _fetch_chunk(timestamp_ms: int) -> pd.DataFrame:
    url = (
        f"{BASE_URL}/{FILTER_ID}/{REGION}/"
        f"{FILTER_ID}_{REGION}_{RESOLUTION}_{timestamp_ms}.json"
    )
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    rows = []
    for ts_ms, price in r.json()["series"]:
        if price is not None:
            rows.append({
                "datetime":      pd.Timestamp(ts_ms, unit="ms", tz="UTC"),
                "price_eur_mwh": price,
            })
    return pd.DataFrame(rows)


def main() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)

    log.info("Fetching SMARD price index …")
    all_timestamps = _fetch_index()

    start_ms = int(SMARD_START.timestamp() * 1000)
    end_ms   = int(FETCH_END.timestamp()   * 1000)
    timestamps = [t for t in all_timestamps if start_ms <= t <= end_ms]
    log.info(f"Found {len(timestamps)} chunks in range {SMARD_START.date()} → {FETCH_END.date()}")
    log.info("Note: SMARD data starts ~2011-12-01 — no price data available before that date")

    frames = []
    for i, ts in enumerate(timestamps, 1):
        chunk_date = pd.Timestamp(ts, unit="ms").date()
        log.info(f"  [{i}/{len(timestamps)}]  {chunk_date}")
        try:
            df_chunk = _fetch_chunk(ts)
            frames.append(df_chunk)
        except Exception as e:
            log.warning(f"  Failed chunk {chunk_date}: {e}")
        time.sleep(0.3)

    if not frames:
        log.error("No data fetched — check filter ID or network.")
        return

    df = pd.concat(frames, ignore_index=True)
    df = df.sort_values("datetime").drop_duplicates("datetime").reset_index(drop=True)
    df.to_csv(OUTPUT_FILE, index=False)

    log.info("")
    log.info(f"Saved {len(df):,} hourly rows → {OUTPUT_FILE}")
    log.info(f"Date range : {df['datetime'].min()} → {df['datetime'].max()}")
    log.info(f"Price range: €{df['price_eur_mwh'].min():.1f} – €{df['price_eur_mwh'].max():.1f} /MWh")
    log.info(f"File size  : {OUTPUT_FILE.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
