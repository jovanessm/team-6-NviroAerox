import {
  ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useState, useMemo } from 'react';
import './ParkForecast.css';

export interface ParkEntry {
  name:     string;
  type:     string;
  state:    string;
  lat:      number;
  lon:      number;
  capacity: number; // MWp
  risk:     number; // heat risk 0–10
}

interface Props {
  park: ParkEntry;
  onClose: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SLIDER_MIN     = 0.5;
const SLIDER_MAX     = 4.0;
const SLIDER_DEFAULT = 2.0;
const PRICE_EUR_PER_MWH = 74;

const SSP_MARKS = [
  { temp: 1.5, label: 'Low emissions',  sub: 'SSP1-2.6' },
  { temp: 2.5, label: 'Middle road',    sub: 'SSP2-4.5' },
  { temp: 3.5, label: 'High emissions', sub: 'SSP5-8.5' },
] as const;

// ── Data model ────────────────────────────────────────────────────────────────

interface Row {
  year:     number;
  baseline: number;
  p50:      number;
  p90:      number; // absolute bottom of uncertainty band
  p10:      number; // absolute top of uncertainty band
  band:     number; // p10 - p90, used for stacked area height
  dT:       number;
  thermal:  number;
  degrad:   number;
  histYear: number;
}

function buildWarmingData(capacity: number, risk: number, totalWarming: number): Row[] {
  const BASE       = capacity * 0.95; // ~950 kWh/kWp/yr → GWh
  const DEGRAD     = 0.005;
  const GAMMA      = -0.004;
  const dTperYear  = totalWarming / 30;
  const riskFactor = 1 + (risk - 5.5) * 0.03; // higher heat-risk parks lose more

  return Array.from({ length: 30 }, (_, i) => {
    const yr           = i + 1;
    const degradFactor = Math.pow(1 - DEGRAD, yr - 1);
    const baseline     = +(BASE * degradFactor).toFixed(2);
    const dT           = +(dTperYear * yr).toFixed(3);
    const climLoss     = (GAMMA * dT - 0.00008 * dT * dT) * riskFactor;
    const p50         = +(baseline * (1 + climLoss)).toFixed(2);
    const sigma       = baseline * (0.022 + yr * 0.0012);
    const p90         = +(p50 - 1.28 * sigma).toFixed(2); // downside
    const p10         = +(p50 + 0.84 * sigma).toFixed(2); // upside
    return {
      year: yr,
      baseline,
      p50,
      p90,
      p10,
      band:     +(p10 - p90).toFixed(2),
      dT,
      thermal:  +(climLoss * 100).toFixed(3),
      degrad:   +((1 - degradFactor) * 100).toFixed(1),
      histYear: 2000 + ((yr * 7 + 3) % 23),
    };
  });
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function warmingColor(temp: number): { line: string; band: string } {
  if (temp <= 1.5) return { line: '#3b82f6', band: 'rgba(59,130,246,0.22)' };
  if (temp <= 2.5) return { line: '#f97316', band: 'rgba(249,115,22,0.24)' };
  return                  { line: '#ef4444', band: 'rgba(239,68,68,0.22)'  };
}

function sliderPct(temp: number) {
  return ((temp - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmt(gwh: number) {
  return gwh >= 1000 ? `${(gwh / 1000).toFixed(2)} TWh` : `${gwh.toFixed(0)} GWh`;
}

function toRevM(gwh: number) {
  return +((gwh * PRICE_EUR_PER_MWH * 1000) / 1e6).toFixed(1);
}

function fmtRev(m: number)  { return `€${m.toFixed(1)}M`; }

function fmtGap(gap: number, pct: number) {
  const sign = gap < 0 ? '−' : '+';
  return `${sign}€${Math.abs(gap).toFixed(1)}M (${sign}${Math.abs(pct).toFixed(1)}%)`;
}

// ── Glossary ──────────────────────────────────────────────────────────────────

function Term({ children, tip, className }: { children: React.ReactNode; tip: string; className?: string }) {
  return (
    <span className={`term-wrap${className ? ' ' + className : ''}`}>
      <span className="term">{children}</span>
      <span className="term-tip">{tip}</span>
    </span>
  );
}

const TWH_TIP = 'Terawatt-hour: 1 TWh = one trillion watt-hours. A large solar park produces 1–3 TWh over its lifetime — enough to power roughly 250,000 homes for a year.';
const GWH_TIP = 'Gigawatt-hour: 1 GWh = one billion watt-hours. A mid-sized solar park generates 50–150 GWh per year — roughly enough for 15,000–45,000 homes.';

function FmtValue({ gwh }: { gwh: number }) {
  if (gwh >= 1000) {
    return <>{(gwh / 1000).toFixed(2)} <Term tip={TWH_TIP}>TWh</Term></>;
  }
  return <>{gwh.toFixed(0)} <Term tip={GWH_TIP}>GWh</Term></>;
}

const SSP_TIPS: Record<string, string> = {
  'SSP1-2.6': 'Low-emissions pathway — the world sharply cuts fossil fuel use, limiting warming to around 1.5–2°C above pre-industrial levels.',
  'SSP2-4.5': 'Middle-road pathway — moderate climate action, projecting roughly 2–3°C of warming by 2100.',
  'SSP5-8.5': 'High-emissions pathway — limited climate action, projecting 3–5°C of warming by 2100. The most severe risk benchmark.',
};

// ── Report generation (no external deps — opens a styled HTML blob) ───────────

function buildSvgChart(data: Row[], colorLine: string, colorBand: string): string {
  const W = 660, H = 170;
  const PL = 42, PR = 8, PT = 10, PB = 26;
  const cW = W - PL - PR, cH = H - PT - PB;

  const allY = data.flatMap(d => [d.p90, d.p10, d.baseline]);
  const yMin = Math.min(...allY) - 0.5;
  const yMax = Math.max(...allY) + 0.5;

  const sx = (yr: number) => PL + ((yr - 1) / 29) * cW;
  const sy = (v: number)  => PT + (1 - (v - yMin) / (yMax - yMin)) * cH;
  const pts = (fn: (d: Row) => number) =>
    data.map(d => `${sx(d.year).toFixed(1)},${sy(fn(d)).toFixed(1)}`).join(' ');

  const bandFwd  = data.map(d =>
    `${sx(d.year).toFixed(1)},${sy(d.p10).toFixed(1)}`).join(' ');
  const bandBack = data.slice().reverse().map(d =>
    `${sx(d.year).toFixed(1)},${sy(d.p90).toFixed(1)}`).join(' ');

  const yTicks = [0, 1, 2, 3].map(i => yMin + (yMax - yMin) * (i / 3));
  const xTicks = [5, 10, 15, 20, 25, 30];

  const gridLines   = yTicks.map(v =>
    `<line x1="${PL}" y1="${sy(v).toFixed(1)}" x2="${W - PR}" y2="${sy(v).toFixed(1)}" stroke="#e5e7eb" stroke-width="0.5"/>`
  ).join('');
  const yLabels     = yTicks.map(v =>
    `<text x="${PL - 4}" y="${(sy(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="9" font-family="sans-serif" fill="#9ca3af">${v.toFixed(0)}</text>`
  ).join('');
  const xLabels     = xTicks.map(yr =>
    `<text x="${sx(yr).toFixed(1)}" y="${H}" text-anchor="middle" font-size="9" font-family="sans-serif" fill="#9ca3af">${yr}</text>`
  ).join('');

  return [
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">`,
    gridLines,
    `<polygon points="${bandFwd} ${bandBack}" fill="${colorBand}"/>`,
    `<polyline points="${pts(d => d.baseline)}" fill="none" stroke="#374151" stroke-width="1.5" stroke-dasharray="5,3"/>`,
    `<polyline points="${pts(d => d.p50)}" fill="none" stroke="${colorLine}" stroke-width="2"/>`,
    yLabels, xLabels,
    `<text x="9" y="${(PT + cH / 2).toFixed(0)}" text-anchor="middle" font-size="9" font-family="sans-serif" fill="#9ca3af" transform="rotate(-90,9,${(PT + cH / 2).toFixed(0)})">GWh/yr</text>`,
    `</svg>`,
  ].join('');
}

function generateReportHtml(
  park: ParkEntry,
  data: Row[],
  warmingLevel: number,
  colors: { line: string; band: string },
  lifetimeBaseline: number,
  lifetimeP50: number,
  dp50: number,
  revBaseline: number,
  revP50: number,
  revP90: number,
  gapM_p50: number,
  gapM_p90: number,
  gapPct_p50: number,
  gapPct_p90: number,
): string {
  const date      = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const refId     = park.name.replace(/\s+/g, '-').toUpperCase().slice(0, 8) + '-' + Date.now().toString(36).toUpperCase().slice(-5);
  const fmtG      = (n: number) => n >= 1000 ? (n / 1000).toFixed(2) + ' TWh' : n.toFixed(0) + ' GWh';
  const fmtR      = (n: number) => '€' + Math.abs(n).toFixed(1) + 'M';
  const scenario  = warmingLevel <= 1.6 ? 'SSP1-2.6 — Low emissions' : warmingLevel <= 2.6 ? 'SSP2-4.5 — Middle road' : 'SSP5-8.5 — High emissions';
  const riskLvl   = park.risk >= 7 ? 'High' : park.risk >= 5 ? 'Moderate' : 'Low';
  const riskColor = park.risk >= 7 ? '#dc2626' : park.risk >= 5 ? '#d97706' : '#059669';
  const chartSvg  = buildSvgChart(data, colors.line, colors.band);

  const annual5Rows = data.slice(0, 5).map(d => {
    const yr   = 2024 + d.year - 1;
    const base = (d.baseline * PRICE_EUR_PER_MWH * 1000) / 1e6;
    const p50  = (d.p50      * PRICE_EUR_PER_MWH * 1000) / 1e6;
    const gap  = p50 - base;
    return '<tr><td>' + yr + '</td><td>' + fmtR(base) + '</td><td>' + fmtR(p50) +
           '</td><td class="neg">−' + fmtR(Math.abs(gap)) +
           ' (' + Math.abs((gap / base) * 100).toFixed(1) + '%)</td></tr>';
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Climate Risk Report — ${park.name}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;background:#fff;color:#111;font-size:12px;line-height:1.5}
.print-bar{background:#f9fafb;border-bottom:1px solid #e5e7eb;padding:10px 44px;display:flex;align-items:center;justify-content:space-between}
.print-bar span{font-size:11px;color:#888}
.print-btn{background:#111;color:#fff;border:none;padding:8px 20px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
.print-btn:hover{background:#374151}
.page{max-width:760px;margin:0 auto;padding:36px 44px 28px}
.rpt-hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #111;margin-bottom:22px}
.rpt-brand{font-size:16px;font-weight:800;letter-spacing:-0.03em}
.rpt-brand-sub{font-size:10px;color:#888;margin-top:2px}
.rpt-doc-meta{text-align:right;font-size:10px;color:#888;line-height:1.7}
.rpt-doc-type{font-size:11px;font-weight:700;color:#111}
.rpt-park{margin-bottom:14px}
.rpt-park-name{font-size:20px;font-weight:700;letter-spacing:-0.03em;margin-bottom:3px}
.rpt-park-meta{font-size:11px;color:#666}
.rpt-pill{display:inline-block;margin-top:8px;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:3px 10px;border-radius:99px;border:1.5px solid ${colors.line};color:${colors.line}}
.rpt-heat{display:flex;align-items:center;gap:14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;margin-bottom:18px}
.rpt-heat-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:2px}
.rpt-heat-val{font-size:22px;font-weight:800;color:${riskColor};line-height:1}
.rpt-heat-lvl{font-size:11px;font-weight:700;color:${riskColor}}
.rpt-heat-desc{font-size:11px;color:#666;flex:1}
.rpt-headline{display:grid;grid-template-columns:1fr 1fr 1fr;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:20px}
.rpt-hl{padding:12px 16px}
.rpt-hl+.rpt-hl{border-left:1px solid #e5e7eb}
.rpt-hl-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:4px}
.rpt-hl-val{font-size:18px;font-weight:700;letter-spacing:-0.03em}
.rpt-hl-delta{font-size:11px;font-weight:600;color:#dc2626;margin-top:2px}
.rpt-hl-sub{font-size:10px;color:#888;margin-top:2px}
.sec-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:8px}
.rpt-chart-wrap{border:1px solid #e5e7eb;border-radius:8px;padding:12px 8px 6px;margin-bottom:6px}
.rpt-legend{display:flex;gap:20px;font-size:9px;color:#666;padding:6px 8px 14px 48px}
.sw{display:inline-block;width:16px;height:2px;vertical-align:middle;margin-right:4px;border-radius:1px}
.sw-dash{display:inline-block;width:16px;border-top:1.5px dashed #374151;vertical-align:middle;margin-right:4px}
.sw-band{display:inline-block;width:16px;height:8px;vertical-align:middle;margin-right:4px;border-radius:2px}
table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:18px}
thead tr{background:#f9fafb;border-bottom:1px solid #e5e7eb}
th{padding:7px 12px;text-align:right;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#888}
th:first-child{text-align:left}
td{padding:7px 12px;text-align:right;border-bottom:1px solid #f3f4f6}
td:first-child{text-align:left;color:#555}
.neg{color:#dc2626;font-weight:600}
.rpt-footer{border-top:1px solid #e5e7eb;padding-top:10px;font-size:9px;color:#aaa;display:flex;justify-content:space-between;gap:20px}
@media print{
  .print-bar{display:none!important}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{padding:0;max-width:none}
  @page{margin:16mm 20mm}
}
</style>
</head>
<body>
<div class="print-bar">
  <span>NviroTrust Climate Risk Report — ${park.name}</span>
  <button class="print-btn" onclick="window.print()">Save as PDF</button>
</div>
<div class="page">
  <div class="rpt-hdr">
    <div>
      <div class="rpt-brand">NviroTrust</div>
      <div class="rpt-brand-sub">Power, Seen From Orbit &nbsp;&middot;&nbsp; EnviroTrust Challenge 2026</div>
    </div>
    <div class="rpt-doc-meta">
      <div class="rpt-doc-type">Climate Risk Assessment</div>
      <div>${date}</div>
      <div>Ref: NVT-${refId}</div>
    </div>
  </div>

  <div class="rpt-park">
    <div class="rpt-park-name">${park.name}</div>
    <div class="rpt-park-meta">${park.state} &nbsp;&middot;&nbsp; ${park.lat.toFixed(3)}&deg;N, ${park.lon.toFixed(3)}&deg;E &nbsp;&middot;&nbsp; ${park.capacity} MWp &nbsp;&middot;&nbsp; Solar PV</div>
    <div class="rpt-pill">+${warmingLevel.toFixed(1)}&deg;C by 2055 &nbsp;&middot;&nbsp; ${scenario}</div>
  </div>

  <div class="rpt-heat">
    <div>
      <div class="rpt-heat-lbl">Climate Heat Risk</div>
      <div class="rpt-heat-val">${park.risk.toFixed(1)}<span style="font-size:11px;font-weight:400;color:#888">/10</span></div>
    </div>
    <div class="rpt-heat-lvl">${riskLvl}</div>
    <div class="rpt-heat-desc">Exposure to extreme heat days through 2055. Higher ambient temperatures reduce panel efficiency via thermal derating and accelerate cell degradation via the Arrhenius effect, compounding losses over the asset lifetime.</div>
  </div>

  <div class="rpt-headline">
    <div class="rpt-hl">
      <div class="rpt-hl-lbl">Industry Standard</div>
      <div class="rpt-hl-val">${fmtG(lifetimeBaseline)}</div>
      <div class="rpt-hl-sub">30-year total output</div>
    </div>
    <div class="rpt-hl">
      <div class="rpt-hl-lbl">Climate-Adjusted &middot; +${warmingLevel.toFixed(1)}&deg;C</div>
      <div class="rpt-hl-val" style="color:${colors.line}">${fmtG(lifetimeP50)}</div>
      <div class="rpt-hl-delta">${dp50.toFixed(1)}% vs industry</div>
    </div>
    <div class="rpt-hl">
      <div class="rpt-hl-lbl">Revenue at Risk (P50)</div>
      <div class="rpt-hl-val" style="color:#dc2626">${fmtR(gapM_p50)}</div>
      <div class="rpt-hl-sub">shortfall vs assumption</div>
    </div>
  </div>

  <div class="sec-lbl">30-year output forecast &mdash; GWh per year</div>
  <div class="rpt-chart-wrap">${chartSvg}</div>
  <div class="rpt-legend">
    <span><span class="sw" style="background:${colors.line};height:2px"></span>Climate-adjusted (P50)</span>
    <span><span class="sw-dash"></span>Industry assumption</span>
    <span><span class="sw-band" style="background:${colors.band}"></span>Likely range (P10&ndash;P90)</span>
  </div>

  <div class="sec-lbl">Lifetime Revenue Summary (30 years &middot; &euro;${PRICE_EUR_PER_MWH}/MWh)</div>
  <table>
    <thead><tr><th></th><th>Industry Assumption</th><th>Expected (P50)</th><th>Conservative (P90)</th></tr></thead>
    <tbody>
      <tr><td>30-yr revenue</td><td>${fmtR(revBaseline)}</td><td>${fmtR(revP50)}</td><td>${fmtR(revP90)}</td></tr>
      <tr><td>Shortfall vs assumption</td><td>&mdash;</td>
        <td class="neg">&minus;${fmtR(Math.abs(gapM_p50))} (${Math.abs(gapPct_p50).toFixed(1)}%)</td>
        <td class="neg">&minus;${fmtR(Math.abs(gapM_p90))} (${Math.abs(gapPct_p90).toFixed(1)}%)</td>
      </tr>
    </tbody>
  </table>

  <div class="sec-lbl">Annual Revenue &mdash; First 5 Years (&euro;M)</div>
  <table>
    <thead><tr><th>Year</th><th>Industry Standard</th><th>Expected (P50)</th><th>Shortfall</th></tr></thead>
    <tbody>${annual5Rows}</tbody>
  </table>

  <div class="rpt-footer">
    <div>
      <strong>NviroTrust</strong> &middot; Climate Risk Assessment<br>
      Scenario: ${scenario} &middot; +${warmingLevel.toFixed(1)}&deg;C total warming by 2055<br>
      Price assumption: &euro;${PRICE_EUR_PER_MWH}/MWh &middot; Illustrative only &mdash; not a financial forecast
    </div>
    <div style="text-align:right">
      Generated ${date}<br>
      Physics: NOCT thermal derating + Arrhenius degradation<br>
      Climate source: CDS/CMIP6 delta method &middot; Park specs: MaStR registry
    </div>
  </div>
</div>
</body>
</html>`;
}

// ── Warming slider ────────────────────────────────────────────────────────────

interface SliderProps {
  value:    number;
  onChange: (v: number) => void;
}

function WarmingSlider({ value, onChange }: SliderProps) {
  const pct    = sliderPct(value);
  const colors = warmingColor(value);

  return (
    <div className="warming-section">
      <div className="warming-header">
        <span className="warming-label">Projected warming by 2055</span>
        <span className="warming-value" style={{ color: colors.line }}>
          +{value.toFixed(1)}°C
        </span>
      </div>

      <div className="warming-track-wrap">
        <input
          type="range"
          min={SLIDER_MIN}
          max={SLIDER_MAX}
          step={0.1}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="warming-slider"
          style={{
            '--w-color': colors.line,
            '--w-pct':   `${pct}%`,
          } as React.CSSProperties}
        />

        <div className="warming-marks">
          {SSP_MARKS.map((m, i) => (
            <div
              key={m.temp}
              className={`warming-mark${value >= m.temp - 0.25 && value <= m.temp + 0.25 ? ' active' : ''}`}
              style={{ left: `${sliderPct(m.temp)}%` }}
            >
              <div className="warming-mark-tick" />
              <div className="warming-mark-label">{m.label}</div>
              <div className="warming-mark-temp">
                {m.temp}°C ·{' '}
                <Term
                  tip={SSP_TIPS[m.sub]}
                  className={i === 0 ? 'tip-right' : i === SSP_MARKS.length - 1 ? 'tip-left' : undefined}
                >
                  {m.sub}
                </Term>
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="warming-explainer">
        Drag to set how much average temperatures rise by 2055. The tick marks show
        the three standard climate pathways used by scientists worldwide.
      </p>
    </div>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface TooltipProps {
  active?:      boolean;
  label?:       number;
  data:         Row[];
  warmingLevel: number;
}

function ForecastTooltip({ active, label, data, warmingLevel }: TooltipProps) {
  if (!active || label == null) return null;
  const row    = data.find(d => d.year === Number(label));
  if (!row) return null;
  const colors = warmingColor(warmingLevel);

  return (
    <div className="prov-tooltip">
      <div className="prov-header">Year {label} &nbsp;·&nbsp; {2025 + Number(label)}</div>
      <div className="prov-baseline">
        Industry standard &nbsp;<strong>{row.baseline.toFixed(1)} GWh/yr</strong>
      </div>
      <div className="prov-scenario" style={{ borderLeftColor: colors.line }}>
        <div className="prov-name">Climate-adjusted · +{warmingLevel.toFixed(1)}°C by 2055</div>
        <div className="prov-grid">
          <span>Expected output</span>            <span>{row.p50.toFixed(1)} GWh/yr</span>
          <span>Likely range</span>               <span>{row.p90.toFixed(1)} – {row.p10.toFixed(1)} GWh</span>
          <span>Warming at this year</span>       <span>+{row.dT.toFixed(2)}°C above baseline</span>
          <span>Heat reduces output by</span>     <span>{Math.abs(row.thermal).toFixed(2)}%</span>
          <span>Age-related panel decline</span>  <span>−{row.degrad.toFixed(1)}%</span>
          <span>Weather sampled from</span>       <span>{row.histYear}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ParkForecast({ park, onClose }: Props) {
  const [warmingLevel, setWarmingLevel] = useState(SLIDER_DEFAULT);

  const data = useMemo(
    () => buildWarmingData(park.capacity, park.risk, warmingLevel),
    [park.capacity, park.risk, warmingLevel],
  );
  const colors = warmingColor(warmingLevel);

  // Lifetime energy (GWh)
  const lifetimeBaseline = data.reduce((s, d) => s + d.baseline, 0);
  const lifetimeP50      = data.reduce((s, d) => s + d.p50,      0);
  const lifetimeP90      = data.reduce((s, d) => s + d.p90,      0); // downside
  const lifetimeP10      = data.reduce((s, d) => s + d.p10,      0); // upside
  const dp50             = ((lifetimeP50 - lifetimeBaseline) / lifetimeBaseline) * 100;

  // Lifetime revenue (€M)
  const revBaseline = toRevM(lifetimeBaseline);
  const revP50      = toRevM(lifetimeP50);
  const revP90      = toRevM(lifetimeP90);
  const revP10      = toRevM(lifetimeP10);
  const gapM_p50    = +(revP50 - revBaseline).toFixed(1);
  const gapPct_p50  = +((gapM_p50 / revBaseline) * 100).toFixed(1);
  const gapM_p90    = +(revP90 - revBaseline).toFixed(1);
  const gapPct_p90  = +((gapM_p90 / revBaseline) * 100).toFixed(1);

  // Annual first 5 years
  const annual5 = data.slice(0, 5).map(d => ({
    year:     2024 + d.year - 1,
    baseline: toRevM(d.baseline),
    p50:      toRevM(d.p50),
    p10:      toRevM(d.p10),
  }));

  const yMin     = Math.floor(Math.min(...data.map(d => d.p90)) - 1);
  const yMax     = Math.ceil(data[0].baseline + 1);
  const score    = park.risk.toFixed(1);
  const scoreNum = park.risk;

  function downloadReport() {
    const html = generateReportHtml(
      park, data, warmingLevel, colors,
      lifetimeBaseline, lifetimeP50, dp50,
      revBaseline, revP50, revP90,
      gapM_p50, gapM_p90, gapPct_p50, gapPct_p90,
    );
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div className="park-forecast">

      {/* ── Park header ──────────────────────────────────── */}
      <div className="forecast-top">
        <div className="forecast-park-info">
          <span className={`forecast-badge ${park.type}`}>{park.type}</span>
          <h2 className="forecast-park-name">{park.name}</h2>
          <p className="forecast-park-meta">{park.state} &nbsp;·&nbsp; {park.lat.toFixed(3)}, {park.lon.toFixed(3)}</p>
        </div>
        <div className="forecast-actions">
          <button className="report-btn" onClick={downloadReport} title="Download PDF report">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download Report
          </button>
          <button className="forecast-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

      {/* ── Headline cards ────────────────────────────────── */}
      <div className="forecast-headline">
        <div className="hl-item">
          <div className="hl-label">
            <Term tip="The method banks and insurers typically use: take historical average weather and assume the climate stays exactly the same for all 30 years. No adjustment for temperature trends.">
              Industry Standard
            </Term>
          </div>
          <div className="hl-value"><FmtValue gwh={lifetimeBaseline} /></div>
          <div className="hl-sub">30-year total output</div>
        </div>
        <div className="hl-sep" />
        <div className="hl-item">
          <div className="hl-label">
            Climate-Adjusted ·{' '}
            <Term tip="How much average temperatures are projected to rise by 2055 above the pre-industrial baseline — the international reference used by climate scientists for all warming targets.">
              +{warmingLevel.toFixed(1)}°C
            </Term>
          </div>
          <div className="hl-value" style={{ color: colors.line }}><FmtValue gwh={lifetimeP50} /></div>
          <div className={`hl-delta ${dp50 < 0 ? 'neg' : 'pos'}`}>{dp50.toFixed(1)}%</div>
        </div>
        <div className="hl-sep" />
        <div className="hl-item">
          <div className="hl-label">
            <Term tip="The earnings gap between the standard forecast and our climate-adjusted forecast — revenue the industry model counts that may not materialise as temperatures rise over the park's lifetime.">
              Revenue at Risk
            </Term>
          </div>
          <div className="hl-value">{fmtRev(Math.abs(gapM_p50))}</div>
          <div className="hl-sub">vs industry standard</div>
        </div>
      </div>

      {/* ── Warming slider ────────────────────────────────── */}
      <WarmingSlider value={warmingLevel} onChange={setWarmingLevel} />

      {/* ── Legend ───────────────────────────────────────── */}
      <div className="forecast-legend">
        <span className="legend-scen">
          <span className="legend-swatch" style={{ background: colors.line }} />
          Climate-adjusted forecast
        </span>
        <span className="legend-scen" style={{ color: 'var(--text-muted)' }}>
          <span className="legend-swatch" style={{ background: colors.band.replace(/[\d.]+\)$/, '0.7)') }} />
          Likely range of outcomes
        </span>
        <span className="legend-baseline">
          <span className="legend-dash" />
          <Term tip="The standard forecast: uses historical average weather and assumes the climate stays exactly the same for all 30 years. This is the baseline that appears in most prospectuses.">
            Industry assumption
          </Term>{' '}(no climate change)
        </span>
      </div>

      {/* ── Fan chart ─────────────────────────────────────── */}
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
              <ForecastTooltip
                active={props.active}
                label={props.label as number}
                data={data}
                warmingLevel={warmingLevel}
              />
            )} />

            {/* Uncertainty band: p90 is the transparent base, band stacks on top */}
            <Area type="monotone" dataKey="p90"  stackId="fan" fill="transparent"  stroke="none" isAnimationActive={false} legendType="none" />
            <Area type="monotone" dataKey="band" stackId="fan" fill={colors.band}  stroke="none" isAnimationActive={false} legendType="none" />

            {/* P50 and baseline lines */}
            <Line type="monotone" dataKey="p50"      stroke={colors.line}        strokeWidth={2}   dot={false} isAnimationActive={false} legendType="none" />
            <Line type="monotone" dataKey="baseline" stroke="var(--slate-900)"   strokeWidth={2}   strokeDasharray="5 3" dot={false} isAnimationActive={false} legendType="none" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="forecast-hint">Hover any year to see what's driving the numbers · the gap between lines is the climate adjustment</p>

      {/* ── Finance section ───────────────────────────────── */}
      <div className="finance-divider" />
      <div className="finance-section">

        {/* Heat risk */}
        <div className="heat-risk-row">
          <span className="heat-risk-label">
            <Term tip="A score from 0–10 measuring how much extreme heat events are projected to affect this park's output through 2055. Higher = more heat exposure. Hotter panels produce less power and degrade faster over time.">
              Climate Heat Risk
            </Term>
          </span>
          <span className="heat-risk-score" style={{ color: scoreNum >= 7 ? '#dc2626' : scoreNum >= 5 ? '#d97706' : '#059669' }}>
            {score}<span className="heat-risk-denom">/10</span>
          </span>
          <span className="heat-risk-note">how exposed this park is to extreme heat days through 2055 — hotter panels produce less power and degrade faster</span>
        </div>

        {/* Lifetime revenue */}
        <div className="finance-block">
          <div className="finance-block-title">Lifetime Revenue (30 years) · +{warmingLevel.toFixed(1)}°C scenario</div>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Industry assumption</th>
                  <th>Most likely outcome</th>
                  <th>Conservative estimate</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="row-label">30-yr revenue</td>
                  <td>{fmtRev(revBaseline)}</td>
                  <td>{fmtRev(revP50)}</td>
                  <td>{fmtRev(revP90)}</td>
                </tr>
                <tr>
                  <td className="row-label">Best case</td>
                  <td className="em-dash">—</td>
                  <td>{fmtRev(revP10)}</td>
                  <td className="em-dash">—</td>
                </tr>
                <tr>
                  <td className="row-label">Shortfall vs assumption</td>
                  <td className="em-dash">—</td>
                  <td className={gapM_p50 < 0 ? 'gap-neg' : 'gap-pos'}>{fmtGap(gapM_p50, gapPct_p50)}</td>
                  <td className={gapM_p90 < 0 ? 'gap-neg' : 'gap-pos'}>{fmtGap(gapM_p90, gapPct_p90)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="finance-note">
            Price assumption: €{PRICE_EUR_PER_MWH}/<Term tip="Megawatt-hour: 1,000 kWh — the standard unit for electricity pricing. At €74/MWh, the park earns €74 for every megawatt-hour it delivers to the grid.">MWh</Term> · illustrative, not a forecast
          </p>
        </div>

        {/* Annual first 5 years */}
        <div className="finance-block">
          <div className="finance-block-title">Annual Revenue — first 5 years · +{warmingLevel.toFixed(1)}°C</div>
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
                    <td>{fmtRev(r.p10)}</td>
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
