"""
Real German solar park specs from MaStR (Marktstammdatenregister).

Lat/lon from ERA5 fetch coordinates (backend/CDS Data/main.py).
Capacity and orientation from individual MaStR unit records.
Tilt is the midpoint of the reported range (5-20° → 12°, 21-40° → 30°).

Parks without MaStR capacity data are commented out with TODO.
"""

from model.data import ParkSpecs

ALL_PARKS: list[ParkSpecs] = [
    ParkSpecs(
        name="Eggebek_Solar_Park",
        lat=54.629,
        lon=9.343,
        capacity_kwp=16_588.39,   # MaStR SEE961379846180 "Eggebek 4.2"
        azimuth=180.0,             # Süd
        tilt=12.0,                 # midpoint of 5–20° range
        commissioned=2025,
        wind_exposure=0.731,       # GRW: 127.1 ha across 2 polygons
    ),
    ParkSpecs(
        name="Solarpark_Weesow_Willmersdorf",
        lat=52.652,
        lon=13.694,
        capacity_kwp=62_147.28,   # MaStR SEE993157584229 "PV Weesow-Willmersdorf 1"
        azimuth=180.0,             # Süd
        tilt=30.0,                 # midpoint of 21–40° range
        commissioned=2021,
        wind_exposure=0.707,       # GRW: 163.4 ha across 6 polygons
    ),
    ParkSpecs(
        name="Solarpark_Gottesgabe_Neuhardenberg",
        lat=52.640,
        lon=14.189,
        capacity_kwp=22_525.8,    # MaStR SEE955907873113 "Energiepark Neuhardenberg"
        azimuth=180.0,             # Süd
        tilt=30.0,                 # midpoint of 21–40° range
        commissioned=2012,
        wind_exposure=0.735,       # GRW: 122.5 ha across 3 polygons
    ),
    ParkSpecs(
        name="Brandenburg_Briest_Solarpark",
        lat=52.437,
        lon=12.451,
        capacity_kwp=6_067.035,   # MaStR SEE992163974963 "Solarpark Briest V - STWB-Anlage"
        azimuth=180.0,             # Süd
        tilt=30.0,                 # midpoint of 21–40° range
        commissioned=2024,
        wind_exposure=0.693,       # GRW: 191.4 ha across 3 polygons
    ),
    ParkSpecs(
        name="Krughuette_Solar_Park",
        lat=51.527,
        lon=11.521,
        capacity_kwp=19_833.88,   # MaStR SEE984290672089 "PVA Krughütte 4"
        azimuth=180.0,             # Süd
        tilt=12.0,                 # midpoint of 5–20° range
        commissioned=2023,
        wind_exposure=0.814,       # GRW: 44.3 ha across 7 polygons
    ),
    ParkSpecs(
        name="Solarpark_Meuro",
        lat=51.530,
        lon=14.010,
        capacity_kwp=17_223.12,   # MaStR SEE911324943570 "Solar Meuro I"
        azimuth=180.0,             # Süd
        tilt=30.0,                 # midpoint of 21–40° range
        commissioned=2021,
        wind_exposure=0.765,       # GRW: 87.9 ha across 6 polygons
    ),
    # Ernsthof_Solar_Park EXCLUDED — MaStR SEE974150665368 is a rooftop
    # (Gebäudesolaranlage, 192 kWp). Our model targets Freiflächensolaranlagen.
    # TODO: find the correct ground-mounted MaStR unit for this location.

    ParkSpecs(
        name="Lauingen_Energy_Park",
        lat=48.537,
        lon=10.424,
        capacity_kwp=16_174.78,   # MaStR SEE932532939322 "PVA Lauingen"
        azimuth=180.0,             # primary Süd; secondary Süd-West omitted (minor)
        tilt=12.0,                 # midpoint of 5–20° range
        commissioned=2024,
        wind_exposure=0.787,       # GRW: 66.7 ha across 3 polygons
    ),
    ParkSpecs(
        name="Strasskirchen_Solar_Park",
        lat=48.809,
        lon=12.755,
        capacity_kwp=54_356.0,    # MaStR SEE978697638670 "PVA-Straßkirchen"
        azimuth=180.0,             # Süd
        tilt=12.0,                 # midpoint of 5–20° range
        commissioned=2025,
        wind_exposure=0.738,       # GRW: 118.8 ha across 10 polygons
    ),
    ParkSpecs(
        name="Finsterwalde_Solar_Park",
        lat=51.571,
        lon=13.750,
        capacity_kwp=9_251.76,    # MaStR SEE901235278670 "Solarpark Finsterwalde I BA 2"
        azimuth=180.0,             # Süd
        tilt=30.0,                 # midpoint of 21–40° range
        wind_exposure=0.700,       # GRW: 176.3 ha across 4 polygons
    ),
    ParkSpecs(
        name="Solarpark_Pocking",
        lat=48.368,
        lon=13.299,
        capacity_kwp=1_819.44,    # MaStR SEE977632068008 "Pocking II"
        azimuth=180.0,             # Süd
        tilt=12.0,                 # midpoint of 5–20° range
        commissioned=2024,
        wind_exposure=0.793,       # GRW: 60.9 ha across 1 polygon
    ),
]

PARKS_BY_NAME: dict[str, ParkSpecs] = {p.name: p for p in ALL_PARKS}
