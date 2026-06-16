import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { PARKS } from '../data/parks';
import type { ParkEntry } from '../data/parks';
import './ParkMap.css';

interface Props {
  onParkClick?: (park: ParkEntry) => void;
  selectedParkName?: string | null;
}

export function ParkMap({ onParkClick, selectedParkName }: Props) {
  return (
    <div className="park-map-wrapper">
      <div className="park-map-header">
        <h2>{PARKS.length} German Solar Parks</h2>
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
                Solar &middot; {park.state}<br />
                {park.capacity_mwp} MWp &middot; est. {park.commissioned}<br />
                {park.lat.toFixed(3)}, {park.lon.toFixed(3)}
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
