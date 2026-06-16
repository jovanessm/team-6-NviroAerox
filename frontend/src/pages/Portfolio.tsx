import { useState, useMemo } from 'react';
import { PARKS } from '../data/parks';
import './Portfolio.css';

// ── Derive portfolio rows from real precomputed data (RCP4.5 = SSP2-4.5) ─────

interface ParkRow {
  name:        string;
  state:       string;
  capacity:    number; // MWp
  risk:        number;
  baseline:    number; // 30-yr GWh (industry standard)
  adjusted:    number; // 30-yr GWh P50 climate-adjusted
  lossPct:     number; // % delta vs baseline
  revenueGap:  number; // €M gap
  revBaseline: number; // €M baseline revenue
}

const ALL_ROWS: ParkRow[] = PARKS.map(p => {
  const s = p.scenarios['RCP4.5'];
  return {
    name:        p.name,
    state:       p.state,
    capacity:    p.capacity_mwp,
    risk:        p.risk,
    baseline:    s.lifetime_baseline_gwh,
    adjusted:    s.lifetime_p50_gwh,
    lossPct:     s.delta_pct,
    revenueGap:  s.finance.revenue_gap_meur,
    revBaseline: s.finance.lifetime_baseline_meur,
  };
});

// ── Sort + filter helpers ─────────────────────────────────────────────────────

type SortKey = 'risk' | 'lossPct' | 'revenueGap' | 'baseline' | 'capacity' | 'name' | 'state';
type SortDir = 'asc' | 'desc';

function sortRows(rows: ParkRow[], key: SortKey, dir: SortDir): ParkRow[] {
  return [...rows].sort((a, b) => {
    const av = a[key] as number | string | null;
    const bv = b[key] as number | string | null;
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function riskColor(score: number): string {
  if (score >= 7)  return 'risk-high';
  if (score >= 5)  return 'risk-med';
  return 'risk-low';
}

function lossColor(pct: number | null): string {
  if (pct === null) return '';
  if (pct <= -2.2)  return 'risk-high';
  if (pct <= -1.8)  return 'risk-med';
  return 'risk-low';
}

function riskDot(cls: string) {
  return <span className={`risk-dot ${cls}`} />;
}

// ── Sort header cell ──────────────────────────────────────────────────────────

interface ThProps {
  label:    string;
  hint?:    string;
  sortKey:  SortKey;
  current:  SortKey;
  dir:      SortDir;
  onSort:   (k: SortKey) => void;
  align?:   'left' | 'right';
}

function Th({ label, hint, sortKey, current, dir, onSort, align = 'right' }: ThProps) {
  const active = current === sortKey;
  return (
    <th
      className={`ptable-th ${align} ${active ? 'active' : ''}`}
      onClick={() => onSort(sortKey)}
    >
      <span className="th-inner">
        <span className="th-label">{label}</span>
        {hint && <span className="th-hint">{hint}</span>}
        <span className="th-arrow">{active ? (dir === 'desc' ? '↓' : '↑') : '↕'}</span>
      </span>
    </th>
  );
}

// ── Summary stat card ─────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Portfolio() {
  const [search,  setSearch]  = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('risk');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'state' ? 'asc' : 'desc');
    }
  }

  const filtered = useMemo(() => {
    let rows = ALL_ROWS;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        r.name.toLowerCase().includes(q) || r.state.toLowerCase().includes(q)
      );
    }
    return sortRows(rows, sortKey, sortDir);
  }, [search, sortKey, sortDir]);

  const avgRisk       = filtered.length
    ? (filtered.reduce((s, r) => s + r.risk, 0) / filtered.length).toFixed(1)
    : '—';
  const totalRevGap   = filtered.reduce((s, r) => s + r.revenueGap, 0);
  const totalBaseline = filtered.reduce((s, r) => s + r.baseline, 0);

  return (
    <div className="portfolio">

      {/* ── Page header ──────────────────────────────────── */}
      <div className="portfolio-header">
        <div>
          <h1>Portfolio Risk Overview</h1>
          <p>
            All {ALL_ROWS.length} solar parks ranked by climate exposure at <strong>+2.5°C by 2055</strong> — the
            SSP2-4.5 "middle road" scenario. Click any column header to re-sort.
          </p>
        </div>
      </div>

      {/* ── Summary cards ────────────────────────────────── */}
      <div className="portfolio-stats">
        <StatCard
          label="Parks shown"
          value={`${filtered.length} / ${ALL_ROWS.length}`}
          sub="solar parks"
        />
        <StatCard
          label="Avg heat risk"
          value={`${avgRisk} / 10`}
          sub="across shown parks"
        />
        <StatCard
          label="Total revenue at risk"
          value={`−€${Math.abs(totalRevGap).toFixed(0)}M`}
          sub="solar parks · vs industry assumption"
        />
        <StatCard
          label="Combined 30-yr output"
          value={totalBaseline >= 1000
            ? `${(totalBaseline / 1000).toFixed(1)} TWh`
            : `${totalBaseline.toFixed(0)} GWh`}
          sub="industry standard baseline"
        />
      </div>

      {/* ── Filters ──────────────────────────────────────── */}
      <div className="portfolio-filters">
        <div className="search-wrap">
          <svg className="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            className="search-input"
            placeholder="Search by park name or state…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')} aria-label="Clear">✕</button>
          )}
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────── */}
      <div className="ptable-wrap">
        {filtered.length === 0 ? (
          <div className="ptable-empty">No parks match your search.</div>
        ) : (
          <table className="ptable">
            <thead>
              <tr>
                <th className="ptable-th left rank-col">#</th>
                <Th label="Park"  sortKey="name"  current={sortKey} dir={sortDir} onSort={handleSort} align="left" />
                <Th label="State" sortKey="state" current={sortKey} dir={sortDir} onSort={handleSort} align="left" />
                <Th label="Capacity" hint="MWp / MW"      sortKey="capacity"   current={sortKey} dir={sortDir} onSort={handleSort} />
                <Th label="Heat Risk" hint="/ 10"         sortKey="risk"       current={sortKey} dir={sortDir} onSort={handleSort} />
                <Th label="Output Loss" hint="at +2.5°C"  sortKey="lossPct"    current={sortKey} dir={sortDir} onSort={handleSort} />
                <Th label="Revenue Gap" hint="30 yr · €M" sortKey="revenueGap" current={sortKey} dir={sortDir} onSort={handleSort} />
                <Th label="30-yr Output" hint="GWh baseline" sortKey="baseline" current={sortKey} dir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={row.name} className="ptable-row">
                  <td className="ptd rank">{i + 1}</td>
                  <td className="ptd name-cell">
                    <span className="park-name">{row.name}</span>
                  </td>
                  <td className="ptd state-cell">{row.state}</td>
                  <td className="ptd num">{row.capacity}</td>
                  <td className={`ptd num risk-cell ${riskColor(row.risk)}`}>
                    {riskDot(riskColor(row.risk))}
                    {row.risk.toFixed(1)}
                  </td>
                  <td className={`ptd num ${lossColor(row.lossPct)}`}>
                    {row.lossPct.toFixed(2)}%
                  </td>
                  <td className="ptd num rev-gap">
                    −€{Math.abs(row.revenueGap).toFixed(1)}M
                  </td>
                  <td className="ptd num muted">
                    {row.baseline >= 1000
                      ? `${(row.baseline / 1000).toFixed(2)} TWh`
                      : `${row.baseline.toFixed(0)} GWh`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Footer note ──────────────────────────────────── */}
      <p className="portfolio-note">
        Scenario: SSP2-4.5 / RCP4.5 · 3,000 Monte Carlo draws · Price: SMARD day-ahead mean ·
        Output loss = P50 climate-adjusted vs industry baseline — open a park in Analyze for the full uncertainty fan.
      </p>

    </div>
  );
}
