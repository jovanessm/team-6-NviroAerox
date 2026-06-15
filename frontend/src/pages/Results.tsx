import { useLocation, useNavigate } from 'react-router-dom';
import type { PredictionResult, Park } from '../types';
import './Results.css';

interface LocationState {
  result: PredictionResult;
  park: Park;
}

export function Results() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as LocationState;

  if (!state?.result || !state?.park) {
    return (
      <div className="results-error">
        <h1>No results yet</h1>
        <p>Run an analysis first to see climate-adjusted output forecasts.</p>
        <button onClick={() => navigate('/analyze')}>Go to Analyze</button>
      </div>
    );
  }

  const { result, park } = state;

  const scenarios = Object.entries(result.scenarioOutputs).map(([name, data]) => ({
    name,
    ...data,
  }));

  const maxOutput = Math.max(
    ...scenarios.map((s) => s.upper),
    result.baselineOutput
  );

  return (
    <div className="results">
      <div className="results-header">
        <button className="results-back" onClick={() => navigate('/analyze')}>
          ← Back
        </button>
        <h1>Results: {park.name}</h1>
        <div className="park-summary">
          <span className="badge">{park.type.toUpperCase()}</span>
          <span className="capacity">{park.capacity} MW</span>
          <span className="location">
            {park.location.lat.toFixed(3)}°, {park.location.lng.toFixed(3)}°
          </span>
        </div>
      </div>

      <div className="results-content">
        <div className="baseline-card">
          <div>
            <h2>Baseline output</h2>
            <div className="metric-value">
              {(result.baselineOutput / 1e6).toFixed(2)} TWh
            </div>
            <div className="metric-label">30-year lifetime · standard method</div>
          </div>
          {result.historicalOutput && (
            <p className="baseline-note">
              Historical actual: {(result.historicalOutput / 1e6).toFixed(2)} TWh
              {result.divergence && (
                <span className={result.divergence > 0 ? 'positive' : 'negative'}>
                  {' '}{result.divergence > 0 ? '+' : ''}{result.divergence.toFixed(1)}%
                </span>
              )}
            </p>
          )}
        </div>

        <div className="scenarios-section">
          <h2>Climate scenarios</h2>
          <p className="scenarios-description">
            Lifetime output under different emissions pathways — P50 central estimate with P5–P95 uncertainty band.
          </p>
          <div className="scenarios-comparison">
            {scenarios.map((scenario) => (
              <div key={scenario.name} className="scenario-item">
                <h3>{formatScenarioName(scenario.name)}</h3>
                <div className="output-bar">
                  <div
                    className="range-bar"
                    style={{
                      width: `${((scenario.upper - scenario.lower) / maxOutput) * 100}%`,
                      left: `${(scenario.lower / maxOutput) * 100}%`,
                    }}
                  />
                  <div
                    className="output-marker"
                    style={{ left: `${(scenario.output / maxOutput) * 100}%` }}
                  />
                </div>
                <div className="scenario-details">
                  <div className="detail">
                    <span className="label">P50</span>
                    <span className="value">{(scenario.output / 1e6).toFixed(2)} TWh</span>
                  </div>
                  <div className="detail">
                    <span className="label">P5–P95 range</span>
                    <span className="value">
                      {(scenario.lower / 1e6).toFixed(2)}–{(scenario.upper / 1e6).toFixed(2)} TWh
                    </span>
                  </div>
                  <div className="detail">
                    <span className="label">Uncertainty</span>
                    <span className="value">±{scenario.uncertainty.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {result.assumptions && result.assumptions.length > 0 && (
          <div className="assumptions-section">
            <h2>Assumptions & data sources</h2>
            <ul className="assumptions-list">
              {result.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="actions">
          <button className="secondary-button" onClick={() => navigate('/analyze')}>
            Analyze another park
          </button>
        </div>
      </div>
    </div>
  );
}

function formatScenarioName(name: string): string {
  const names: Record<string, string> = {
    historical: 'Historical — baseline',
    ssp126: 'SSP1-2.6 — low emissions',
    ssp245: 'SSP2-4.5 — moderate warming',
    ssp370: 'SSP3-7.0 — high emissions',
    ssp585: 'SSP5-8.5 — very high emissions',
  };
  return names[name] ?? name;
}
