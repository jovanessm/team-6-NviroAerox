import {
  ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useMemo } from 'react';
import './ParkForecast.css';

export interface ParkEntry {
  name: string;
  type: string;
  state: string;
  lat: number;
  lon: number;
}

interface Props {
  park: ParkEntry;
  onClose: () => void;
}

// Plain-language scenario labels throughout
const SCENARIOS = [
  { key: 'ssp126', label: 'Low Warming',      dTperYear: 0.018, line: '#3b82f6', band: 'rgba(59,130,246,0.18)' },
  { key: 'ssp245', label: 'Moderate Warming',  dTperYear: 0.040, line: '#f97316', band: 'rgba(249,115,22,0.20)' },
  { key: 'ssp585', label: 'High Emissions',    dTperYear: 0.065, line: '#ef4444', band: 'rgba(239,68,68,0.18)' },
] as const;

const PRICE_EUR_PER_MWH = 74;

type Row = Record<string, number>;

function buildMockData(type: string): Row[] {
  const BASE   = type === 'solar' ? 75.2 : 118.5;
  const DEGRAD = 0.005;
  const GAMMA  = -0.004;

  return Array.from({ length: 30 }, (_, i) => {
    const yr = i + 1;
    const degradFactor = Math.pow(1 - DEGRAD, yr - 1);
    const baseline = +(BASE * degradFactor).toFixed(2);
    const row: Row = { year: yr, baseline };

    for (const s of SCENARIOS) {
      const dT       = s.dTperYear * yr;
      const climLoss = GAMMA * dT - 0.00008 * dT * dT;
      const p50      = +(baseline * (1 + climLoss)).toFixed(2);
      const sigma    = baseline * (0.022 + yr * 0.0012);
      const p90      = +(p50 - 1.28 * sigma).toFixed(2); // downside (conservative)
      const p10      = +(p50 + 0.84 * sigma).toFixed(2); // upside (optimistic)
      const band     = +(p10 - p90).toFixed(2);

      row[`${s.key}_p90`]      = p90;
      row[`${s.key}_p50`]      = p50;
      row[`${s.key}_p10`]      = p10;
      row[`${s.key}_band`]     = band;
      row[`${s.key}_dT`]       = +dT.toFixed(2);
      row[`${s.key}_histYear`] = 2000 + ((yr * 7 + 3) % 23);
      row[`${s.key}_thermal`]  = +(climLoss * 100).toFixed(3);
      row[`${s.key}_degrad`]   = +((1 - degradFactor) * 100).toFixed(1);
    }
    return row;
  });
}

function toRevM(gwh: number) {
  return +((gwh * PRICE_EUR_PER_MWH * 1000) / 1e6).toFixed(1);
}

function fmtRev(m: number) { return `€${m.toFixed(1)}M`; }

function fmtGap(gap: number, pct: number) {
  const sign = gap < 0 ? '−' : '+';
  return `${sign}€${Math.abs(gap).toFixed(1)}M (${sign}${Math.abs(pct).toFixed(1)}%)`;
}

function heatRiskScore(name: string, type: string): string {
  const base = type === 'solar' ? 6.2 : 3.5;
  const hash = name.split('').reduce((h, c) => ((h * 31) + c.charCodeAt(0)) & 0xffff, 0);
  return Math.min(9.99, base + (hash % 380) / 100).toFixed(2);
}

function fmt(gwh: number) {
  return gwh >= 1000 ? `${(gwh / 1000).toFixed(2)} TWh` : `${gwh.toFixed(0)} GWh`;
}

function deltaPct(adjusted: number, baseline: number) {
  return (((adjusted - baseline) / baseline) * 100).toFixed(1);
}

function ForecastTooltip({ active, label, data }: { active?: boolean; label?: number; data: Row[] }) {
  if (!active || label == null) return null;
  const row = data.find(d => d.year === Number(label));
  if (!row) return null;

  return (
    <div className="prov-tooltip">
      <div className="prov-header">Year {label} &nbsp;·&nbsp; {2025 + Number(label)}</div>
      <div className="prov-baseline">
        Standard forecast &nbsp;<strong>{row.baseline.toFixed(1)} GWh/yr</strong>
      </div>
      {SCENARIOS.map(s => (
        <div key={s.key} className="prov-scenario" style={{ borderLeftColor: s.line }}>
          <div className="prov-name">{s.label}</div>
          <div className="prov-grid">
            <span>Expected output</span><span>{row[`${s.key}_p50`].toFixed(1)} GWh/yr</span>
            <span>Projected warming</span><span>+{row[`${s.key}_dT`]}°C</span>
            <span>Reference year</span><span>{row[`${s.key}_histYear`]}</span>
            <span>Heat efficiency loss</span><span>{row[`${s.key}_thermal`]}%</span>
            <span>Panel ageing loss</span><span>−{row[`${s.key}_degrad`]}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ParkForecast({ park, onClose }: Props) {
  const data = useMemo(() => buildMockData(park.type), [park.type]);

  // Energy lifetimes (GWh)
  const lifetimeBaseline = data.reduce((s, d) => s + d.baseline,     0);
  const lifetimeP50_245  = data.reduce((s, d) => s + d['ssp245_p50'], 0);
  const lifetimeP50_585  = data.reduce((s, d) => s + d['ssp585_p50'], 0);
  const lifetimeP90_245  = data.reduce((s, d) => s + d['ssp245_p10'], 0); // optimistic upper
  const lifetimeP90_585  = data.reduce((s, d) => s + d['ssp585_p10'], 0);
  const lifetimePess     = data.reduce((s, d) => s + d['ssp585_p90'], 0); // conservative downside

  const dp50 = deltaPct(lifetimeP50_245, lifetimeBaseline);
  const dp90 = deltaPct(lifetimePess,    lifetimeBaseline);

  // Revenue lifetimes (€M)
  const revBaseline = toRevM(lifetimeBaseline);
  const revP50_245  = toRevM(lifetimeP50_245);
  const revP50_585  = toRevM(lifetimeP50_585);
  const revP90_245  = toRevM(lifetimeP90_245);
  const revP90_585  = toRevM(lifetimeP90_585);

  const gapM_245   = +(revP50_245 - revBaseline).toFixed(1);
  const gapPct_245 = +((gapM_245  / revBaseline) * 100).toFixed(1);
  const gapM_585   = +(revP50_585 - revBaseline).toFixed(1);
  const gapPct_585 = +((gapM_585  / revBaseline) * 100).toFixed(1);

  // Annual revenue first 5 years
  const annual5 = data.slice(0, 5).map(d => ({
    year:     2024 + d.year - 1,
    baseline: toRevM(d.baseline),
    p50:      toRevM(d['ssp245_p50']),
    p90:      toRevM(d['ssp245_p10']),
  }));

  const yMin = Math.floor(Math.min(...data.map(d => d['ssp585_p90'])) - 1);
  const yMax = Math.ceil(data[0].baseline + 1);

  const score    = heatRiskScore(park.name, park.type);
  const scoreNum = parseFloat(score);

  return (
    <div className="park-forecast">

      {/* ── header ─────────────────────────────────────── */}
      <div className="forecast-top">
        <div className="forecast-park-info">
          <span className={`forecast-badge ${park.type}`}>{park.type}</span>
          <h2 className="forecast-park-name">{park.name}</h2>
          <p className="forecast-park-meta">{park.state} &nbsp;·&nbsp; {park.lat.toFixed(3)}, {park.lon.toFixed(3)}</p>
        </div>
        <button className="forecast-close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      {/* ── summary headline ───────────────────────────── */}
      <div className="forecast-headline">
        <div className="hl-item">
          <div className="hl-label">Industry Standard</div>
          <div className="hl-value">{fmt(lifetimeBaseline)}</div>
          <div className="hl-sub">30-year total output</div>
        </div>
        <div className="hl-sep" />
        <div className="hl-item">
          <div className="hl-label">Expected · Moderate Warming</div>
          <div className="hl-value">{fmt(lifetimeP50_245)}</div>
          <div className={`hl-delta ${Number(dp50) < 0 ? 'neg' : 'pos'}`}>{dp50}%</div>
        </div>
        <div className="hl-sep" />
        <div className="hl-item">
          <div className="hl-label">Downside · High Emissions</div>
          <div className="hl-value">{fmt(lifetimePess)}</div>
          <div className={`hl-delta ${Number(dp90) < 0 ? 'neg' : 'pos'}`}>{dp90}%</div>
        </div>
      </div>

      {/* ── chart legend ───────────────────────────────── */}
      <div className="forecast-legend">
        {SCENARIOS.map(s => (
          <span key={s.key} className="legend-scen">
            <span className="legend-swatch" style={{ background: s.line }} />
            {s.label}
          </span>
        ))}
        <span className="legend-baseline">
          <span className="legend-dash" />
          Industry Standard
        </span>
      </div>

      {/* ── fan chart ──────────────────────────────────── */}
      <div className="forecast-chart-wrap">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="year"
              tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
              tickLine={false} axisLine={false}
              label={{ value: 'years', position: 'insideRight', offset: -4, fontSize: 11, fill: 'var(--text-muted)', dy: 2 }}
            />
            <YAxis
              type="number" domain={[yMin, yMax]}
              tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
              tickLine={false} axisLine={false}
              tickFormatter={v => v.toFixed(0)} width={36}
              label={{ value: 'GWh/yr', angle: -90, position: 'insideLeft', offset: 14, fontSize: 11, fill: 'var(--text-muted)' }}
            />
            <Tooltip content={(props) => (
              <ForecastTooltip active={props.active} label={props.label as number} data={data} />
            )} />

            <Area type="monotone" dataKey="ssp585_p90" stackId="ssp585" fill="transparent" stroke="none" isAnimationActive={false} legendType="none" />
            <Area type="monotone" dataKey="ssp585_band" stackId="ssp585" fill="rgba(239,68,68,0.15)" stroke="none" isAnimationActive={false} legendType="none" />
            <Area type="monotone" dataKey="ssp245_p90" stackId="ssp245" fill="transparent" stroke="none" isAnimationActive={false} legendType="none" />
            <Area type="monotone" dataKey="ssp245_band" stackId="ssp245" fill="rgba(249,115,22,0.20)" stroke="none" isAnimationActive={false} legendType="none" />
            <Area type="monotone" dataKey="ssp126_p90" stackId="ssp126" fill="transparent" stroke="none" isAnimationActive={false} legendType="none" />
            <Area type="monotone" dataKey="ssp126_band" stackId="ssp126" fill="rgba(59,130,246,0.20)" stroke="none" isAnimationActive={false} legendType="none" />

            <Line type="monotone" dataKey="ssp585_p50" stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} legendType="none" />
            <Line type="monotone" dataKey="ssp245_p50" stroke="#f97316" strokeWidth={1.5} dot={false} isAnimationActive={false} legendType="none" />
            <Line type="monotone" dataKey="ssp126_p50" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} legendType="none" />
            <Line type="monotone" dataKey="baseline" stroke="var(--slate-900)" strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} legendType="none" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="forecast-hint">Hover any year to see what's driving the forecast</p>

      {/* ── financial section ──────────────────────────── */}
      <div className="finance-divider" />
      <div className="finance-section">

        {/* heat risk */}
        <div className="heat-risk-row">
          <span className="heat-risk-label">Climate Heat Risk</span>
          <span className="heat-risk-score" style={{ color: scoreNum >= 7 ? '#dc2626' : scoreNum >= 5 ? '#d97706' : '#059669' }}>
            {score}<span className="heat-risk-denom">/10</span>
          </span>
          <span className="heat-risk-note">likelihood of extreme heat days over the next 30 years</span>
        </div>

        {/* lifetime revenue */}
        <div className="finance-block">
          <div className="finance-block-title">Lifetime Revenue (30 years)</div>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Industry Standard</th>
                  <th>Moderate Warming</th>
                  <th>High Emissions</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="row-label">Expected</td>
                  <td>{fmtRev(revBaseline)}</td>
                  <td>{fmtRev(revP50_245)}</td>
                  <td>{fmtRev(revP50_585)}</td>
                </tr>
                <tr>
                  <td className="row-label">Optimistic</td>
                  <td className="em-dash">—</td>
                  <td>{fmtRev(revP90_245)}</td>
                  <td>{fmtRev(revP90_585)}</td>
                </tr>
                <tr>
                  <td className="row-label">vs Industry Standard</td>
                  <td className="em-dash">—</td>
                  <td className={gapM_245 < 0 ? 'gap-neg' : 'gap-pos'}>{fmtGap(gapM_245, gapPct_245)}</td>
                  <td className={gapM_585 < 0 ? 'gap-neg' : 'gap-pos'}>{fmtGap(gapM_585, gapPct_585)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="finance-note">Price assumption: €{PRICE_EUR_PER_MWH}/MWh · illustrative, not a forecast</p>
        </div>

        {/* annual first 5 years */}
        <div className="finance-block">
          <div className="finance-block-title">Annual Revenue — first 5 years · Moderate Warming</div>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Industry Standard</th>
                  <th>Expected</th>
                  <th>Optimistic</th>
                </tr>
              </thead>
              <tbody>
                {annual5.map(r => (
                  <tr key={r.year}>
                    <td className="row-label">{r.year}</td>
                    <td>{fmtRev(r.baseline)}</td>
                    <td>{fmtRev(r.p50)}</td>
                    <td>{fmtRev(r.p90)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
