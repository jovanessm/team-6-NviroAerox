import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { ParkEntry } from './ParkForecast';
import './ParkMap.css';

const PARKS: ParkEntry[] = [
  { name: 'Eggebek Solar Park',                 type: 'solar', state: 'Schleswig-Holstein', lat: 54.629, lon:  9.343, capacity:  65, risk: 5.4, windExposure: 0.731, meanWindMs: 4.165 },
  { name: 'Solarpark Weesow-Willmersdorf',      type: 'solar', state: 'Brandenburg',        lat: 52.652, lon: 13.694, capacity: 187, risk: 7.2, windExposure: 0.707, meanWindMs: 3.551 },
  { name: 'Solarpark Gottesgabe Neuhardenberg', type: 'solar', state: 'Brandenburg',        lat: 52.640, lon: 14.189, capacity:  84, risk: 7.0, windExposure: 0.735, meanWindMs: 3.543 },
  { name: 'Brandenburg Briest Solarpark',       type: 'solar', state: 'Brandenburg',        lat: 52.437, lon: 12.451, capacity:  91, risk: 7.1, windExposure: 0.693, meanWindMs: 3.351 },
  { name: 'Finsterwalde Solar Park',            type: 'solar', state: 'Brandenburg',        lat: 51.571, lon: 13.750, capacity:  80, risk: 7.4, windExposure: 0.700, meanWindMs: 3.358 },
  { name: 'Krughuette Solar Park',              type: 'solar', state: 'Saxony-Anhalt',      lat: 51.527, lon: 11.521, capacity:  52, risk: 6.8, windExposure: 0.814, meanWindMs: 3.273 },
  { name: 'Solarpark Meuro',                    type: 'solar', state: 'Brandenburg/Saxony', lat: 51.530, lon: 14.010, capacity: 166, risk: 7.3, windExposure: 0.765, meanWindMs: 3.417 },
  { name: 'Ernsthof Solar Park',                type: 'solar', state: 'Baden-Württemberg',  lat: 49.707, lon:  9.475, capacity:  70, risk: 6.5, windExposure: 0.750, meanWindMs: 3.500 },
  { name: 'Lauingen Energy Park',               type: 'solar', state: 'Bavaria',            lat: 48.537, lon: 10.424, capacity:  25, risk: 6.3, windExposure: 0.787, meanWindMs: 2.779 },
  { name: 'Strasskirchen Solar Park',           type: 'solar', state: 'Bavaria',            lat: 48.809, lon: 12.755, capacity:  54, risk: 6.2, windExposure: 0.738, meanWindMs: 2.409 },
  { name: 'Solarpark Pocking',                  type: 'solar', state: 'Bavaria',            lat: 48.368, lon: 13.299, capacity:  50, risk: 6.4, windExposure: 0.793, meanWindMs: 2.630 },
];

interface Props {
  onParkClick?: (park: ParkEntry) => void;
  selectedParkName?: string | null;
}

export function ParkMap({ onParkClick, selectedParkName }: Props) {
  return (
    <div className="park-map-wrapper">
      <div className="park-map-header">
        <h2>11 German Solar Parks</h2>
        <div className="park-map-legend">
          <span className="legend-item"><span className="legend-dot solar" /> Solar</span>
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
          return (
            <CircleMarker
              key={park.name}
              center={[park.lat, park.lon]}
              radius={isSelected ? 11 : 8}
              pathOptions={{
                color:       isSelected ? '#10b981' : '#f59e0b',
                fillColor:   isSelected ? '#34d399' : '#fbbf24',
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
