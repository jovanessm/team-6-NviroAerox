"""
Extract wind exposure factors from Microsoft Global Renewables Watch GeoPackage.

Spatially joins solar park polygons to our 10 German parks, sums polygon
areas within a 3 km radius, and derives a wind_exposure factor per park.

No GDAL/geopandas required — uses sqlite3 + GeoPackage R-tree index.

DEVNOTE: currently only runable locally with the large GeoPackage file, 
but could be adapted to run in a cloud function if we upload the GPKG to a bucket and use a cloud SQL instance for spatial queries.  

Usage:
    python "backend/GRW Data/extract_wind_exposure.py"
    python "backend/GRW Data/extract_wind_exposure.py" --gpkg ~/Downloads/solar_all_2024q2_v1.gpkg
    python "backend/GRW Data/extract_wind_exposure.py" --dry-run

Output: backend/GRW Data/wind_exposure.json
"""

import sys
import json
import math
import struct
import sqlite3
import argparse
import logging
from pathlib import Path

_repo_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_repo_root))

from model.parks import ALL_PARKS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

GPKG_DEFAULT = Path.home() / "Downloads" / "solar_all_2024q2_v1.gpkg"
OUTPUT_PATH = Path(__file__).parent / "wind_exposure.json"
RADIUS_KM = 3.0


# ── Geometry helpers (no GDAL) ────────────────────────────────────────────────

def _wgs84_to_mercator(lat: float, lon: float) -> tuple[float, float]:
    x = lon * 20037508.34 / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) / (math.pi / 180)
    return x, y * 20037508.34 / 180


def _mercator_to_wgs84(x: float, y: float) -> tuple[float, float]:
    lon = x * 180 / 20037508.34
    lat = math.degrees(2 * math.atan(math.exp(y * math.pi / 20037508.34)) - math.pi / 2)
    return lat, lon


def _parse_gpkg_centroid(blob: bytes) -> tuple[float, float] | None:
    """Extract polygon centroid from GeoPackage binary geometry envelope."""
    if blob[:2] != b'GP':
        return None
    flags = blob[3]
    env_type = (flags >> 1) & 0x07
    if env_type == 0:
        return None
    little_endian = flags & 0x01
    fmt = '<4d' if little_endian else '>4d'
    minx, maxx, miny, maxy = struct.unpack_from(fmt, blob, 8)
    return (minx + maxx) / 2, (miny + maxy) / 2


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


# ── Wind exposure model ───────────────────────────────────────────────────────

def wind_exposure_from_area(total_ha: float) -> float:
    """
    Estimate fraction of open-field wind speed at the average panel surface.

    Larger parks have more interior rows sheltered from wind (wake effect).
    Literature: interior rows at 40–70 % of open-field; edge rows at ~100 %.

    Sigmoid tuned to German utility-scale parks:
        5 ha  → 0.88  (small, mostly edge rows)
        100 ha → 0.75
        200 ha → 0.69
        500 ha → 0.64
    """
    return 0.62 + 0.26 * math.exp(-total_ha / 150)


# ── Main extraction ───────────────────────────────────────────────────────────

def extract(gpkg_path: Path, dry_run: bool = False) -> dict:
    if not gpkg_path.exists():
        raise FileNotFoundError(
            f"GeoPackage not found: {gpkg_path}\n"
            f"Download solar_all_2024q2_v1.gpkg from the GRW releases page and\n"
            f"pass --gpkg <path> or place it in ~/Downloads/"
        )

    log.info(f"GeoPackage : {gpkg_path}  ({gpkg_path.stat().st_size / 1e6:.0f} MB)")
    log.info(f"Radius     : {RADIUS_KM} km")
    log.info(f"Output     : {OUTPUT_PATH.resolve()}")
    if dry_run:
        log.info("DRY RUN — no file will be written")
    log.info("")

    con = sqlite3.connect(gpkg_path)
    results = {}

    log.info(f"{'Park':<45} {'GRW ha':>8} {'N poly':>6} {'Exposure':>9}")
    log.info("-" * 75)

    for park in ALL_PARKS:
        px, py = _wgs84_to_mercator(park.lat, park.lon)
        margin = RADIUS_KM * 1000  # metres → same unit as Web Mercator

        cur = con.cursor()
        cur.execute(
            """
            SELECT geom, area FROM solar_all_2024q2
            WHERE COUNTRY = 'Germany'
            AND fid IN (
                SELECT id FROM rtree_solar_all_2024q2_geom
                WHERE minx <= ? AND maxx >= ? AND miny <= ? AND maxy >= ?
            )
            """,
            (px + margin, px - margin, py + margin, py - margin),
        )

        total_m2 = 0.0
        n_poly = 0
        for blob, area in cur.fetchall():
            centroid = _parse_gpkg_centroid(bytes(blob))
            if centroid is None:
                continue
            cx, cy = centroid
            lat, lon = _mercator_to_wgs84(cx, cy)
            if _haversine_km(park.lat, park.lon, lat, lon) <= RADIUS_KM:
                total_m2 += area
                n_poly += 1

        total_ha = total_m2 / 1e4
        exposure = wind_exposure_from_area(total_ha)
        results[park.name] = {
            "grw_area_ha": round(total_ha, 1),
            "n_polygons": n_poly,
            "wind_exposure": round(exposure, 3),
        }
        log.info(f"{park.name:<45} {total_ha:>8.1f} {n_poly:>6} {exposure:>9.3f}")

    con.close()
    log.info("")

    if not dry_run:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(OUTPUT_PATH, "w") as f:
            json.dump(results, f, indent=2)
        log.info(f"Saved → {OUTPUT_PATH}")
    else:
        log.info("DRY RUN — skipped write")

    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract wind exposure factors from Microsoft GRW GeoPackage."
    )
    parser.add_argument(
        "--gpkg", type=Path, default=GPKG_DEFAULT,
        help=f"Path to solar_all_2024q2_v1.gpkg (default: {GPKG_DEFAULT})",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print results without writing JSON",
    )
    args = parser.parse_args()
    extract(args.gpkg, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
