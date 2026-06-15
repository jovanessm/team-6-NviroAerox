import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { ParkEntry } from './ParkForecast';
import './ParkMap.css';

const PARKS: ParkEntry[] = [
  { name: 'Buergerwindpark Reussenkoge',        type: 'wind',  state: 'Schleswig-Holstein',      lat: 54.627, lon:  8.902 },
  { name: 'Windpark Holtriem',                  type: 'wind',  state: 'Lower Saxony',             lat: 53.610, lon:  7.429 },
  { name: 'Eggebek Solar Park',                 type: 'solar', state: 'Schleswig-Holstein',       lat: 54.629, lon:  9.343 },
  { name: 'Windpark Kessin',                    type: 'wind',  state: 'Mecklenburg-Vorpommern',   lat: 53.727, lon: 13.329 },
  { name: 'Solarpark Weesow-Willmersdorf',      type: 'solar', state: 'Brandenburg',              lat: 52.652, lon: 13.694 },
  { name: 'Solarpark Gottesgabe Neuhardenberg', type: 'solar', state: 'Brandenburg',              lat: 52.640, lon: 14.189 },
  { name: 'Brandenburg Briest Solarpark',       type: 'solar', state: 'Brandenburg',              lat: 52.437, lon: 12.451 },
  { name: 'Finsterwalde Solar Park',            type: 'solar', state: 'Brandenburg',              lat: 51.571, lon: 13.750 },
  { name: 'Krughuette Solar Park',              type: 'solar', state: 'Saxony-Anhalt',            lat: 51.527, lon: 11.521 },
  { name: 'Windpark Druiberg',                  type: 'wind',  state: 'Saxony-Anhalt',            lat: 51.870, lon: 11.020 },
  { name: 'Hesselbach Wind Farm',               type: 'wind',  state: 'North Rhine-Westphalia',   lat: 50.908, lon:  8.384 },
  { name: 'Windpark Harz',                      type: 'wind',  state: 'Lower Saxony',             lat: 51.750, lon: 10.750 },
  { name: 'Windpark Odervorland',               type: 'wind',  state: 'Brandenburg',              lat: 52.250, lon: 14.650 },
  { name: 'Windpark Veenhusen',                 type: 'wind',  state: 'Lower Saxony',             lat: 53.310, lon:  7.580 },
  { name: 'Solarpark Meuro',                    type: 'solar', state: 'Brandenburg/Saxony',       lat: 51.530, lon: 14.010 },
  { name: 'Windpark Hohe Geest',                type: 'wind',  state: 'Schleswig-Holstein',       lat: 54.050, lon:  9.200 },
  { name: 'Ernsthof Solar Park',                type: 'solar', state: 'Baden-Württemberg',        lat: 49.707, lon:  9.475 },
  { name: 'Lauingen Energy Park',               type: 'solar', state: 'Bavaria',                  lat: 48.537, lon: 10.424 },
  { name: 'Strasskirchen Solar Park',           type: 'solar', state: 'Bavaria',                  lat: 48.809, lon: 12.755 },
  { name: 'Solarpark Pocking',                  type: 'solar', state: 'Bavaria',                  lat: 48.368, lon: 13.299 },
];

interface Props {
  onParkClick?: (park: ParkEntry) => void;
  selectedParkName?: string | null;
}

export function ParkMap({ onParkClick, selectedParkName }: Props) {
  return (
    <div className="park-map-wrapper">
      <div className="park-map-header">
        <h2>20 German Renewable Parks</h2>
        <div className="park-map-legend">
          <span className="legend-item"><span className="legend-dot solar" /> Solar</span>
          <span className="legend-item"><span className="legend-dot wind" /> Wind</span>
          {onParkClick && <span className="legend-hint">Click a park to forecast</span>}
        </div>
      </div>
      <MapContainer center={[51.5, 10.5]} zoom={6} className="park-map" scrollWheelZoom={false}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {PARKS.map((park) => {
          const isSelected = park.name === selectedParkName;
          const isSolar    = park.type === 'solar';
          return (
            <CircleMarker
              key={park.name}
              center={[park.lat, park.lon]}
              radius={isSelected ? 11 : 8}
              pathOptions={{
                color:       isSelected ? '#10b981' : (isSolar ? '#f59e0b' : '#3b82f6'),
                fillColor:   isSelected ? '#34d399' : (isSolar ? '#fbbf24' : '#60a5fa'),
                fillOpacity: 0.9,
                weight:      isSelected ? 3 : 2,
              }}
              eventHandlers={{ click: () => onParkClick?.(park) }}
            >
              <Tooltip>
                <strong>{park.name}</strong><br />
                {park.type.charAt(0).toUpperCase() + park.type.slice(1)} &middot; {park.state}<br />
                {park.lat.toFixed(3)}, {park.lon.toFixed(3)}
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
