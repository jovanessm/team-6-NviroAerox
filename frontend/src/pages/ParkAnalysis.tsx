import { useState, useMemo, useRef, useEffect } from 'react';
import { ParkMap } from '../components/ParkMap';
import { ParkForecast } from '../components/ParkForecast';
import { PARKS } from '../data/parks';
import type { ParkEntry } from '../data/parks';
import './ParkAnalysis.css';

// ── Park search bar ───────────────────────────────────────────────────────────

function riskClass(risk: number) {
  if (risk >= 7) return 'risk-high';
  if (risk >= 5) return 'risk-med';
  return 'risk-low';
}

interface SearchProps {
  selected: ParkEntry | null;
  onSelect: (park: ParkEntry) => void;
}

function ParkSearch({ selected, onSelect }: SearchProps) {
  const [query,  setQuery]  = useState('');
  const [open,   setOpen]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef  = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? PARKS.filter(p =>
          p.name.toLowerCase().includes(q) || p.state.toLowerCase().includes(q)
        )
      : PARKS;
    return list.slice(0, 8);
  }, [query]);

  function pick(park: ParkEntry) {
    setQuery('');
    setOpen(false);
    onSelect(park);
  }

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="park-search" ref={wrapRef}>
      <div className={`search-input-wrap${open ? ' focused' : ''}`}>
        <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Search parks by name or state…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
          spellCheck={false}
        />
        {selected && !query && (
          <span className="search-current-tag">
            <span className="sct-dot" style={{ background: selected.risk >= 7 ? '#ef4444' : selected.risk >= 5 ? '#f97316' : '#10b981' }} />
            {selected.name}
          </span>
        )}
        {query && (
          <button className="search-clear-btn" onMouseDown={() => { setQuery(''); inputRef.current?.focus(); }}>
            ✕
          </button>
        )}
      </div>

      {open && (
        <div className="search-dropdown">
          {results.length === 0 ? (
            <div className="search-empty">No parks match "{query}"</div>
          ) : (
            results.map(p => (
              <button
                key={p.id}
                className={`search-result${selected?.id === p.id ? ' active' : ''}`}
                onMouseDown={() => pick(p)}
              >
                <span className="sr-left">
                  <span className="sr-name">{p.name}</span>
                  <span className="sr-meta">{p.state} &middot; {p.capacity_mwp} MWp &middot; est. {p.commissioned}</span>
                </span>
                <span className={`sr-risk ${riskClass(p.risk)}`}>
                  <span className={`sr-risk-dot ${riskClass(p.risk)}`} />
                  {p.risk.toFixed(1)}/10
                </span>
              </button>
            ))
          )}
          <div className="search-footer">
            {results.length} of {PARKS.length} parks
            {query && <span> · type to filter</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ParkAnalysis() {
  const [forecastPark, setForecastPark] = useState<ParkEntry | null>(null);

  return (
    <div className="park-analysis">

      <div className="analysis-page-header">
        <div className="analysis-header-row">
          <div>
            <h1>Analyse a solar park</h1>
            <p>
              Search or click a map pin — you'll see the industry forecast alongside our
              climate-adjusted prediction, with heat risk and revenue gap.
            </p>
          </div>
        </div>
        <ParkSearch selected={forecastPark} onSelect={setForecastPark} />
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
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
              </div>
              <h3>Search or click a pin</h3>
              <p>Use the search bar above or click any pin on the map to open a park's climate risk report.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
