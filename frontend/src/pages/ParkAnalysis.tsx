import { useState } from 'react';
import { ParkMap } from '../components/ParkMap';
import { ParkForecast } from '../components/ParkForecast';
import type { ParkEntry } from '../components/ParkForecast';
import './ParkAnalysis.css';

export function ParkAnalysis() {
  const [forecastPark, setForecastPark] = useState<ParkEntry | null>(null);

  return (
    <div className="park-analysis">

      <div className="analysis-page-header">
        <h1>Select a Park</h1>
        <p>
          Click any marker to see its 30-year revenue forecast under different climate scenarios.
          20 real operating German parks — solar and wind.
        </p>
      </div>

      <div className="split-layout">

        {/* ── left: sticky map ─────────────────────────── */}
        <div className="split-map">
          <ParkMap
            onParkClick={setForecastPark}
            selectedParkName={forecastPark?.name ?? null}
          />
        </div>

        {/* ── right: forecast data ─────────────────────── */}
        <div className="split-data">
          {forecastPark ? (
            <ParkForecast
              park={forecastPark}
              onClose={() => setForecastPark(null)}
            />
          ) : (
            <div className="no-selection">
              <div className="no-selection-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="10" r="3" />
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                </svg>
              </div>
              <h3>Select a park</h3>
              <p>Click any pin on the map to see its climate-adjusted revenue forecast, heat risk score, and 30-year outlook.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
