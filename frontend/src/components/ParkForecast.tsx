import {
  ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useMemo } from 'react';
import './ParkForecast.css';

export interface ParkEntry {
<<<<<<< HEAD
  name:     string;
  type:     string;
  state:    string;
  lat:      number;
  lon:      number;
  capacity: number;
  risk:     number;
=======
  name:         string;
  type:         string;
  state:        string;
  lat:          number;
  lon:          number;
  capacity:     number; // MWp
  risk:         number; // heat risk 0–10
  windExposure: number; // fraction of open-field wind at panel surface (from GRW satellite)
  meanWindMs:   number; // ERA5 mean wind_speed_10m, m/s
>>>>>>> f83c0a7e48d12eefd763fdadb77b8969cc8a5c5d
}

interface Props {
  park: ParkEntry;
  onClose: () => void;
}

// ── SSP Scenarios ─────────────────────────────────────────────────────────────

const SSP_SCENARIOS = [
  {
    id:   's1' as const,
    label: 'SSP1-2.6',
    name:  'Low emissions',
    temp:  1.5,
    line:  '#3b82f6',
    band:  'rgba(59,130,246,0.16)',
    tip:   'Low-emissions pathway — the world sharply cuts fossil fuel use, limiting warming to around 1.5–2°C above pre-industrial levels.',
  },
  {
    id:   's2' as const,
    label: 'SSP2-4.5',
    name:  'Middle road',
    temp:  2.5,
    line:  '#f97316',
    band:  'rgba(249,115,22,0.18)',
    tip:   'Middle-road pathway — moderate climate action, projecting roughly 2–3°C of warming by 2100.',
  },
  {
    id:   's3' as const,
    label: 'SSP5-8.5',
    name:  'High emissions',
    temp:  3.5,
    line:  '#ef4444',
    band:  'rgba(239,68,68,0.16)',
    tip:   'High-emissions pathway — limited climate action, projecting 3–5°C of warming by 2100. The most severe risk benchmark.',
  },
] as const;

const PRICE_EUR_PER_MWH = 74;

// ── Data model ────────────────────────────────────────────────────────────────

interface Row {
  year:     number;
  baseline: number;
  p50:      number;
  p90:      number;
  p10:      number;
  band:     number;
  dT:       number;
  thermal:  number;
  degrad:   number;
}

<<<<<<< HEAD
// One recharts row merging all three scenarios + the shared baseline
interface MultiRow {
  year:     number;
  baseline: number;
  s1_p90: number; s1_band: number; s1_p50: number;
  s2_p90: number; s2_band: number; s2_p50: number;
  s3_p90: number; s3_band: number; s3_p50: number;
  _s1: Row; _s2: Row; _s3: Row;
}

function buildRows(capacity: number, risk: number, totalWarming: number): Row[] {
  const BASE       = capacity * 0.95;
=======
function faimanBaselineBoost(windExposure: number, meanWindMs: number): number {
  const effectiveWind  = windExposure * meanWindMs;
  const meanGhi        = 400; // W/m² — representative Germany daylight GHI
  const noctDelta      = meanGhi * (45 - 20) / 800; // °C NOCT heating above ambient
  const faimanDelta    = meanGhi / (25 + 6.84 * effectiveWind); // °C Faiman heating
  const coolerBy       = noctDelta - faimanDelta; // Faiman panels run this many °C cooler
  return coolerBy * 0.004; // power fraction recovered (|γ| = 0.004 /°C)
}

function buildWarmingData(capacity: number, risk: number, totalWarming: number, windBoost = 0): Row[] {
  const BASE       = capacity * 0.95 * (1 + windBoost); // ~950 kWh/kWp/yr → GWh; Faiman adds wind cooling
>>>>>>> f83c0a7e48d12eefd763fdadb77b8969cc8a5c5d
  const DEGRAD     = 0.005;
  const GAMMA      = -0.004;
  const dTperYear  = totalWarming / 30;
  const riskFactor = 1 + (risk - 5.5) * 0.03;

  return Array.from({ length: 30 }, (_, i) => {
    const yr           = i + 1;
    const degradFactor = Math.pow(1 - DEGRAD, yr - 1);
    const baseline     = +(BASE * degradFactor).toFixed(2);
    const dT           = +(dTperYear * yr).toFixed(3);
    const climLoss     = (GAMMA * dT - 0.00008 * dT * dT) * riskFactor;
    const p50         = +(baseline * (1 + climLoss)).toFixed(2);
    const sigma       = baseline * (0.022 + yr * 0.0012);
    const p90         = +(p50 - 1.28 * sigma).toFixed(2);
    const p10         = +(p50 + 0.84 * sigma).toFixed(2);
    return {
      year: yr,
      baseline,
      p50,
      p90,
      p10,
      band:    +(p10 - p90).toFixed(2),
      dT,
      thermal: +(climLoss * 100).toFixed(3),
      degrad:  +((1 - degradFactor) * 100).toFixed(1),
    };
  });
}

function buildMultiData(capacity: number, risk: number): MultiRow[] {
  const [d1, d2, d3] = SSP_SCENARIOS.map(s => buildRows(capacity, risk, s.temp));
  return d1.map((r1, i) => {
    const r2 = d2[i], r3 = d3[i];
    return {
      year:     r1.year,
      baseline: r1.baseline,
      s1_p90: r1.p90, s1_band: r1.band, s1_p50: r1.p50,
      s2_p90: r2.p90, s2_band: r2.band, s2_p50: r2.p50,
      s3_p90: r3.p90, s3_band: r3.band, s3_p50: r3.p50,
      _s1: r1, _s2: r2, _s3: r3,
    };
  });
}

// ── Per-scenario lifetime stats ───────────────────────────────────────────────

interface ScenStats {
  lifetimeP50: number;
  lifetimeP90: number;
  revP50:      number;
  revP90:      number;
  lossPct:     number;
  gapM:        number;
  gapPct:      number;
}

function makeStats(
  data: MultiRow[],
  p50Key: 's1_p50' | 's2_p50' | 's3_p50',
  p90Key: 's1_p90' | 's2_p90' | 's3_p90',
  lifetimeBaseline: number,
  revBaseline: number,
): ScenStats {
  const lifetimeP50 = data.reduce((s, d) => s + d[p50Key], 0);
  const lifetimeP90 = data.reduce((s, d) => s + d[p90Key], 0);
  const revP50      = toRevM(lifetimeP50);
  const revP90      = toRevM(lifetimeP90);
  const lossPct     = ((lifetimeP50 - lifetimeBaseline) / lifetimeBaseline) * 100;
  const gapM        = +(revP50 - revBaseline).toFixed(1);
  const gapPct      = +((gapM / revBaseline) * 100).toFixed(1);
  return { lifetimeP50, lifetimeP90, revP50, revP90, lossPct, gapM, gapPct };
}

// ── Formatting ────────────────────────────────────────────────────────────────

function toRevM(gwh: number) {
  return +((gwh * PRICE_EUR_PER_MWH * 1000) / 1e6).toFixed(1);
}

function fmtRev(m: number) { return `€${Math.abs(m).toFixed(1)}M`; }

// ── Glossary term ─────────────────────────────────────────────────────────────

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
  if (gwh >= 1000) return <>{(gwh / 1000).toFixed(2)} <Term tip={TWH_TIP}>TWh</Term></>;
  return <>{gwh.toFixed(0)} <Term tip={GWH_TIP}>GWh</Term></>;
}

// ── SVG chart for report ──────────────────────────────────────────────────────

function buildSvgChart(data: MultiRow[]): string {
  const W = 660, H = 175;
  const PL = 42, PR = 8, PT = 10, PB = 26;
  const cW = W - PL - PR, cH = H - PT - PB;

  const allY = data.flatMap(d => [d.s3_p90, d.s1_p90 + d.s1_band, d.baseline]);
  const yMin = Math.min(...allY) - 0.5;
  const yMax = Math.max(...allY) + 0.5;

  const sx = (yr: number) => PL + ((yr - 1) / 29) * cW;
  const sy = (v: number)  => PT + (1 - (v - yMin) / (yMax - yMin)) * cH;

  function bandPoly(topFn: (d: MultiRow) => number, botFn: (d: MultiRow) => number) {
    const fwd  = data.map(d => `${sx(d.year).toFixed(1)},${sy(topFn(d)).toFixed(1)}`).join(' ');
    const back = data.slice().reverse().map(d => `${sx(d.year).toFixed(1)},${sy(botFn(d)).toFixed(1)}`).join(' ');
    return `${fwd} ${back}`;
  }

  function pts(fn: (d: MultiRow) => number) {
    return data.map(d => `${sx(d.year).toFixed(1)},${sy(fn(d)).toFixed(1)}`).join(' ');
  }

  const yTicks = [0, 1, 2, 3].map(i => yMin + (yMax - yMin) * (i / 3));
  const xTicks = [5, 10, 15, 20, 25, 30];
  const gridLines = yTicks.map(v =>
    `<line x1="${PL}" y1="${sy(v).toFixed(1)}" x2="${W-PR}" y2="${sy(v).toFixed(1)}" stroke="#e5e7eb" stroke-width="0.5"/>`).join('');
  const yLabels = yTicks.map(v =>
    `<text x="${PL-4}" y="${(sy(v)+3.5).toFixed(1)}" text-anchor="end" font-size="9" font-family="sans-serif" fill="#9ca3af">${v.toFixed(0)}</text>`).join('');
  const xLabels = xTicks.map(yr =>
    `<text x="${sx(yr).toFixed(1)}" y="${H}" text-anchor="middle" font-size="9" font-family="sans-serif" fill="#9ca3af">${yr}</text>`).join('');

  return [
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">`,
    gridLines,
    `<polygon points="${bandPoly(d => d.s3_p90+d.s3_band, d => d.s3_p90)}" fill="rgba(239,68,68,0.13)"/>`,
    `<polygon points="${bandPoly(d => d.s2_p90+d.s2_band, d => d.s2_p90)}" fill="rgba(249,115,22,0.15)"/>`,
    `<polygon points="${bandPoly(d => d.s1_p90+d.s1_band, d => d.s1_p90)}" fill="rgba(59,130,246,0.15)"/>`,
    `<polyline points="${pts(d => d.baseline)}" fill="none" stroke="#374151" stroke-width="1.5" stroke-dasharray="5,3"/>`,
    `<polyline points="${pts(d => d.s3_p50)}" fill="none" stroke="#ef4444" stroke-width="1.5"/>`,
    `<polyline points="${pts(d => d.s2_p50)}" fill="none" stroke="#f97316" stroke-width="2"/>`,
    `<polyline points="${pts(d => d.s1_p50)}" fill="none" stroke="#3b82f6" stroke-width="1.5"/>`,
    yLabels, xLabels,
    `<text x="9" y="${(PT+cH/2).toFixed(0)}" text-anchor="middle" font-size="9" font-family="sans-serif" fill="#9ca3af" transform="rotate(-90,9,${(PT+cH/2).toFixed(0)})">GWh/yr</text>`,
    `</svg>`,
  ].join('');
}

// ── Report HTML ───────────────────────────────────────────────────────────────

function generateReportHtml(
  park:             ParkEntry,
  data:             MultiRow[],
  lifetimeBaseline: number,
<<<<<<< HEAD
  revBaseline:      number,
  stats:            [ScenStats, ScenStats, ScenStats],
=======
  lifetimeP50: number,
  dp50: number,
  revBaseline: number,
  revP50: number,
  revP90: number,
  gapM_p50: number,
  gapM_p90: number,
  gapPct_p50: number,
  gapPct_p90: number,
  useFaiman = false,
  effectiveWindMs = 0,
>>>>>>> f83c0a7e48d12eefd763fdadb77b8969cc8a5c5d
): string {
  const date      = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const refId     = park.name.replace(/\s+/g, '-').toUpperCase().slice(0, 8) + '-' + Date.now().toString(36).toUpperCase().slice(-5);
  const fmtG      = (n: number) => n >= 1000 ? (n/1000).toFixed(2)+' TWh' : n.toFixed(0)+' GWh';
  const fmtR      = (n: number) => '€'+Math.abs(n).toFixed(1)+'M';
  const riskLvl   = park.risk >= 7 ? 'High' : park.risk >= 5 ? 'Moderate' : 'Low';
  const riskColor = park.risk >= 7 ? '#dc2626' : park.risk >= 5 ? '#d97706' : '#059669';
  const chartSvg  = buildSvgChart(data);
  const [s1, s2, s3] = stats;

  const scenRows = SSP_SCENARIOS.map((scen, i) => {
    const s = stats[i];
    return `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${scen.line};margin-right:6px;vertical-align:middle"></span>${scen.label} · ${scen.name} · +${scen.temp}°C</td><td>${fmtG(s.lifetimeP50)}</td><td class="neg">${s.lossPct.toFixed(2)}%</td><td class="neg">−${fmtR(s.gapM)}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
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
.rpt-heat{display:flex;align-items:center;gap:14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;margin-bottom:18px}
.rpt-heat-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:2px}
.rpt-heat-val{font-size:22px;font-weight:800;color:${riskColor};line-height:1}
.rpt-heat-lvl{font-size:11px;font-weight:700;color:${riskColor}}
.rpt-heat-desc{font-size:11px;color:#666;flex:1}
.rpt-headline{display:grid;grid-template-columns:1fr 1fr;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:20px}
.rpt-hl{padding:12px 16px}.rpt-hl+.rpt-hl{border-left:1px solid #e5e7eb}
.rpt-hl-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:4px}
.rpt-hl-val{font-size:18px;font-weight:700;letter-spacing:-0.03em}
.rpt-hl-sub{font-size:10px;color:#888;margin-top:2px}
.sec-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:8px}
.rpt-chart-wrap{border:1px solid #e5e7eb;border-radius:8px;padding:12px 8px 6px;margin-bottom:6px}
.rpt-legend{display:flex;flex-wrap:wrap;gap:16px;font-size:9px;color:#666;padding:6px 8px 14px 48px}
.sw{display:inline-block;width:14px;height:2px;vertical-align:middle;margin-right:4px;border-radius:1px}
.sw-dash{display:inline-block;width:14px;border-top:1.5px dashed #374151;vertical-align:middle;margin-right:4px}
table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:18px}
thead tr{background:#f9fafb;border-bottom:1px solid #e5e7eb}
th{padding:7px 12px;text-align:right;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#888}
th:first-child{text-align:left}
td{padding:7px 12px;text-align:right;border-bottom:1px solid #f3f4f6}
td:first-child{text-align:left;color:#555}
.neg{color:#dc2626;font-weight:600}
.rpt-footer{border-top:1px solid #e5e7eb;padding-top:10px;font-size:9px;color:#aaa;display:flex;justify-content:space-between;gap:20px}
@media print{.print-bar{display:none!important}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{padding:0;max-width:none}@page{margin:16mm 20mm}}
</style></head><body>
<div class="print-bar">
  <span>NviroTrust Climate Risk Report — ${park.name}</span>
  <button class="print-btn" onclick="window.print()">Save as PDF</button>
</div>
<div class="page">
  <div class="rpt-hdr">
    <div><div class="rpt-brand">NviroTrust</div><div class="rpt-brand-sub">Power, Seen From Orbit &middot; EnviroTrust Challenge 2026</div></div>
    <div class="rpt-doc-meta"><div class="rpt-doc-type">Climate Risk Assessment</div><div>${date}</div><div>Ref: NVT-${refId}</div></div>
  </div>
  <div class="rpt-park">
    <div class="rpt-park-name">${park.name}</div>
    <div class="rpt-park-meta">${park.state} &middot; ${park.lat.toFixed(3)}&deg;N, ${park.lon.toFixed(3)}&deg;E &middot; ${park.capacity} MWp &middot; Solar PV</div>
  </div>
  <div class="rpt-heat">
    <div><div class="rpt-heat-lbl">Climate Heat Risk</div><div class="rpt-heat-val">${park.risk.toFixed(1)}<span style="font-size:11px;font-weight:400;color:#888">/10</span></div></div>
    <div class="rpt-heat-lvl">${riskLvl}</div>
    <div class="rpt-heat-desc">Exposure to extreme heat days through 2055. Higher ambient temperatures reduce panel efficiency via thermal derating and accelerate cell degradation via the Arrhenius effect, compounding losses over the asset lifetime.</div>
  </div>
  <div class="rpt-headline">
    <div class="rpt-hl">
      <div class="rpt-hl-lbl">Industry Standard (baseline)</div>
      <div class="rpt-hl-val">${fmtG(lifetimeBaseline)}</div>
      <div class="rpt-hl-sub">30-year total · ${fmtR(revBaseline)} revenue</div>
    </div>
    <div class="rpt-hl">
      <div class="rpt-hl-lbl">Middle Road SSP2-4.5 · Expected (P50)</div>
      <div class="rpt-hl-val" style="color:#f97316">${fmtG(s2.lifetimeP50)}</div>
      <div class="rpt-hl-sub" style="color:#dc2626">${s2.lossPct.toFixed(2)}% vs industry · −${fmtR(s2.gapM)} shortfall</div>
    </div>
  </div>
  <div class="sec-lbl">30-year output forecast — GWh per year · all three scenarios</div>
  <div class="rpt-chart-wrap">${chartSvg}</div>
  <div class="rpt-legend">
    <span><span class="sw" style="background:#3b82f6"></span>SSP1-2.6 Low emissions +1.5°C</span>
    <span><span class="sw" style="background:#f97316"></span>SSP2-4.5 Middle road +2.5°C</span>
    <span><span class="sw" style="background:#ef4444"></span>SSP5-8.5 High emissions +3.5°C</span>
    <span><span class="sw-dash"></span>Industry assumption</span>
  </div>
  <div class="sec-lbl">Scenario comparison — 30-year P50 expected output</div>
  <table>
    <thead><tr><th>Scenario</th><th>Expected Output</th><th>Output Loss</th><th>Revenue Shortfall</th></tr></thead>
    <tbody>${scenRows}</tbody>
  </table>
  <div class="sec-lbl">Lifetime revenue summary (30 years · €${PRICE_EUR_PER_MWH}/MWh)</div>
  <table>
    <thead><tr><th></th><th>Industry</th><th>SSP1-2.6</th><th>SSP2-4.5</th><th>SSP5-8.5</th></tr></thead>
    <tbody>
      <tr><td>30-yr revenue</td><td>${fmtR(revBaseline)}</td><td>${fmtR(s1.revP50)}</td><td>${fmtR(s2.revP50)}</td><td>${fmtR(s3.revP50)}</td></tr>
      <tr><td>Shortfall vs industry</td><td>&mdash;</td><td class="neg">−${fmtR(s1.gapM)} (${Math.abs(s1.gapPct).toFixed(1)}%)</td><td class="neg">−${fmtR(s2.gapM)} (${Math.abs(s2.gapPct).toFixed(1)}%)</td><td class="neg">−${fmtR(s3.gapM)} (${Math.abs(s3.gapPct).toFixed(1)}%)</td></tr>
      <tr><td>Conservative (P90)</td><td>&mdash;</td><td>${fmtR(s1.revP90)}</td><td>${fmtR(s2.revP90)}</td><td>${fmtR(s3.revP90)}</td></tr>
    </tbody>
  </table>
  <div class="rpt-footer">
<<<<<<< HEAD
    <div><strong>NviroTrust</strong> &middot; Climate Risk Assessment<br>Scenarios: SSP1-2.6 (+1.5°C) / SSP2-4.5 (+2.5°C) / SSP5-8.5 (+3.5°C) warming by 2055<br>Price assumption: €${PRICE_EUR_PER_MWH}/MWh · Illustrative only — not a financial forecast</div>
    <div style="text-align:right">Generated ${date}<br>Physics: NOCT thermal derating + Arrhenius degradation<br>Climate: CDS/CMIP6 delta method · Park specs: MaStR registry</div>
=======
    <div>
      <strong>NviroTrust</strong> &middot; Climate Risk Assessment<br>
      Scenario: ${scenario} &middot; +${warmingLevel.toFixed(1)}&deg;C total warming by 2055<br>
      Price assumption: &euro;${PRICE_EUR_PER_MWH}/MWh &middot; Illustrative only &mdash; not a financial forecast
    </div>
    <div style="text-align:right">
      Generated ${date}<br>
      Physics: ${useFaiman
        ? `Faiman wind-cooling model · ERA5 wind ${effectiveWindMs.toFixed(2)} m/s effective · Arrhenius degradation`
        : 'NOCT thermal derating · Arrhenius degradation'
      }<br>
      Climate source: CDS/CMIP6 delta method &middot; Park specs: MaStR registry${useFaiman ? ' &middot; Wind geometry: Microsoft GRW' : ''}
    </div>
>>>>>>> f83c0a7e48d12eefd763fdadb77b8969cc8a5c5d
  </div>
</div></body></html>`;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface TooltipProps {
<<<<<<< HEAD
  active?: boolean;
  label?:  number;
  data:    MultiRow[];
}

function ForecastTooltip({ active, label, data }: TooltipProps) {
=======
  active?:         boolean;
  label?:          number;
  data:            Row[];
  warmingLevel:    number;
  useFaiman?:      boolean;
  windExposure?:   number;
  effectiveWindMs?: number;
}

function ForecastTooltip({ active, label, data, warmingLevel, useFaiman, windExposure, effectiveWindMs }: TooltipProps) {
>>>>>>> f83c0a7e48d12eefd763fdadb77b8969cc8a5c5d
  if (!active || label == null) return null;
  const row = data.find(d => d.year === Number(label));
  if (!row) return null;

  const rows: Array<{ scen: typeof SSP_SCENARIOS[number]; r: Row }> = [
    { scen: SSP_SCENARIOS[0], r: row._s1 },
    { scen: SSP_SCENARIOS[1], r: row._s2 },
    { scen: SSP_SCENARIOS[2], r: row._s3 },
  ];

  return (
    <div className="prov-tooltip">
      <div className="prov-header">Year {label} &nbsp;·&nbsp; {2025 + Number(label)}</div>
      <div className="prov-baseline">
        Industry standard &nbsp;<strong>{row.baseline.toFixed(1)} GWh/yr</strong>
      </div>
<<<<<<< HEAD
      {rows.map(({ scen, r }) => (
        <div key={scen.id} className="prov-scenario" style={{ borderLeftColor: scen.line }}>
          <div className="prov-name" style={{ color: scen.line }}>
            {scen.label} · {scen.name} · +{scen.temp}°C
          </div>
          <div className="prov-grid">
            <span>Expected output</span> <span>{r.p50.toFixed(1)} GWh/yr</span>
            <span>Likely range</span>    <span>{r.p90.toFixed(1)} – {r.p10.toFixed(1)} GWh</span>
            <span>Warming at year</span> <span>+{r.dT.toFixed(2)}°C</span>
            <span>Heat reduces by</span> <span>{Math.abs(r.thermal).toFixed(2)}%</span>
            <span>Panel age loss</span>  <span>−{r.degrad.toFixed(1)}%</span>
          </div>
=======
      <div className="prov-scenario" style={{ borderLeftColor: colors.line }}>
        <div className="prov-name">Climate-adjusted · +{warmingLevel.toFixed(1)}°C by 2055</div>
        <div className="prov-grid">
          <span>Expected output</span>            <span>{row.p50.toFixed(1)} GWh/yr</span>
          <span>Likely range</span>               <span>{row.p90.toFixed(1)} – {row.p10.toFixed(1)} GWh</span>
          <span>Warming at this year</span>       <span>+{row.dT.toFixed(2)}°C above baseline</span>
          <span>Heat reduces output by</span>     <span>{Math.abs(row.thermal).toFixed(2)}%</span>
          <span>Age-related panel decline</span>  <span>−{row.degrad.toFixed(1)}%</span>
          <span>Weather sampled from</span>       <span>{row.histYear}</span>
          {useFaiman && effectiveWindMs != null && (
            <>
              <span>Wind cooling model</span>     <span>Faiman (U0=25, U1=6.84)</span>
              <span>Wind exposure (GRW)</span>     <span>{(windExposure ?? 0.75).toFixed(3)} of open-field</span>
              <span>Effective wind speed</span>   <span>{effectiveWindMs.toFixed(2)} m/s (ERA5 × GRW)</span>
            </>
          )}
>>>>>>> f83c0a7e48d12eefd763fdadb77b8969cc8a5c5d
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ParkForecast({ park, onClose }: Props) {
<<<<<<< HEAD
  const data = useMemo(
    () => buildMultiData(park.capacity, park.risk),
    [park.capacity, park.risk],
=======
  const [warmingLevel, setWarmingLevel] = useState(SLIDER_DEFAULT);
  const [useFaiman,    setUseFaiman]    = useState(false);

  const windBoost     = useFaiman ? faimanBaselineBoost(park.windExposure, park.meanWindMs) : 0;
  const effectiveWind = park.windExposure * park.meanWindMs;

  const data = useMemo(
    () => buildWarmingData(park.capacity, park.risk, warmingLevel, windBoost),
    [park.capacity, park.risk, warmingLevel, windBoost],
>>>>>>> f83c0a7e48d12eefd763fdadb77b8969cc8a5c5d
  );

  const lifetimeBaseline = data.reduce((s, d) => s + d.baseline, 0);
  const revBaseline      = toRevM(lifetimeBaseline);

  const s1 = makeStats(data, 's1_p50', 's1_p90', lifetimeBaseline, revBaseline);
  const s2 = makeStats(data, 's2_p50', 's2_p90', lifetimeBaseline, revBaseline);
  const s3 = makeStats(data, 's3_p50', 's3_p90', lifetimeBaseline, revBaseline);
  const scenStats: [ScenStats, ScenStats, ScenStats] = [s1, s2, s3];

  const yMin = Math.floor(Math.min(...data.map(d => d.s3_p90)) - 1);
  const yMax = Math.ceil(data[0].baseline + 1);

  function downloadReport() {
<<<<<<< HEAD
    const html = generateReportHtml(park, data, lifetimeBaseline, revBaseline, scenStats);
=======
    const html = generateReportHtml(
      park, data, warmingLevel, colors,
      lifetimeBaseline, lifetimeP50, dp50,
      revBaseline, revP50, revP90,
      gapM_p50, gapM_p90, gapPct_p50, gapPct_p90,
      useFaiman, effectiveWind,
    );
>>>>>>> f83c0a7e48d12eefd763fdadb77b8969cc8a5c5d
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
            <Term tip="Middle-road climate pathway (SSP2-4.5) — moderate action, ~2.5°C of warming by 2055. Used as the reference case for lenders and insurers.">
              Middle Road · SSP2-4.5
            </Term>
          </div>
          <div className="hl-value" style={{ color: '#f97316' }}><FmtValue gwh={s2.lifetimeP50} /></div>
          <div className={`hl-delta ${s2.lossPct < 0 ? 'neg' : 'pos'}`}>{s2.lossPct.toFixed(1)}% vs industry</div>
        </div>
        <div className="hl-sep" />
        <div className="hl-item">
          <div className="hl-label">
            <Term tip="The earnings gap between the standard forecast and the middle-road climate-adjusted forecast — revenue the industry model counts that may not materialise as temperatures rise.">
              Revenue at Risk
            </Term>
          </div>
          <div className="hl-value">{fmtRev(s2.gapM)}</div>
          <div className="hl-sub">SSP2-4.5 P50 vs industry</div>
        </div>
      </div>

<<<<<<< HEAD
      {/* ── SSP scenario strip ────────────────────────────── */}
      <div className="ssp-strip">
        {SSP_SCENARIOS.map((scen, i) => {
          const st = scenStats[i];
          return (
            <div key={scen.id} className="ssp-row">
              <span className="ssp-dot" style={{ background: scen.line }} />
              <span className="ssp-scenario-label">
                <Term tip={scen.tip}>{scen.label}</Term>
              </span>
              <span className="ssp-scenario-name">{scen.name} · +{scen.temp}°C</span>
              <span className="ssp-delta">{st.lossPct.toFixed(2)}%</span>
              <span className="ssp-rev">−{fmtRev(st.gapM)}</span>
            </div>
          );
        })}
      </div>
=======
      {/* ── Model toggle ─────────────────────────────────── */}
      <div className="model-toggle-section">
        <div className="model-toggle-label">Cell temperature model</div>
        <div className="model-toggle-pills">
          <button
            className={`model-pill${!useFaiman ? ' active' : ''}`}
            onClick={() => setUseFaiman(false)}
          >
            Standard · NOCT
          </button>
          <button
            className={`model-pill${useFaiman ? ' active' : ''}`}
            onClick={() => setUseFaiman(true)}
          >
            Satellite · Faiman
          </button>
        </div>
        {useFaiman && (
          <div className="model-toggle-meta">
            Wind exposure <strong>{park.windExposure.toFixed(3)}</strong> (Microsoft GRW satellite)
            &nbsp;×&nbsp; ERA5 {park.meanWindMs.toFixed(2)} m/s
            &nbsp;=&nbsp; <strong>{effectiveWind.toFixed(2)} m/s effective</strong>
            &nbsp;→ panels run ~{(faimanBaselineBoost(park.windExposure, park.meanWindMs) * 100).toFixed(1)}% more output vs NOCT
          </div>
        )}
      </div>

      {/* ── Warming slider ────────────────────────────────── */}
      <WarmingSlider value={warmingLevel} onChange={setWarmingLevel} />
>>>>>>> f83c0a7e48d12eefd763fdadb77b8969cc8a5c5d

      {/* ── Legend ───────────────────────────────────────── */}
      <div className="forecast-legend">
        {SSP_SCENARIOS.map(scen => (
          <span key={scen.id} className="legend-scen">
            <span className="legend-swatch" style={{ background: scen.line }} />
            {scen.label}
          </span>
        ))}
        <span className="legend-baseline">
          <span className="legend-dash" />
          <Term tip="The standard forecast: uses historical average weather and holds the climate flat for all 30 years. This is the baseline that appears in most prospectuses.">
            Industry assumption
          </Term>
        </span>
      </div>

      {/* ── Fan chart ─────────────────────────────────────── */}
      <div className="forecast-chart-wrap">
        <ResponsiveContainer width="100%" height={300}>
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
<<<<<<< HEAD
              <ForecastTooltip active={props.active} label={props.label as number} data={data} />
=======
              <ForecastTooltip
                active={props.active}
                label={props.label as number}
                data={data}
                warmingLevel={warmingLevel}
                useFaiman={useFaiman}
                windExposure={park.windExposure}
                effectiveWindMs={effectiveWind}
              />
>>>>>>> f83c0a7e48d12eefd763fdadb77b8969cc8a5c5d
            )} />

            {/* SSP1-2.6 — blue band + line */}
            <Area type="monotone" dataKey="s1_p90"  stackId="s1" fill="transparent"           stroke="none" isAnimationActive={false} legendType="none" />
            <Area type="monotone" dataKey="s1_band" stackId="s1" fill="rgba(59,130,246,0.16)"  stroke="none" isAnimationActive={false} legendType="none" />

            {/* SSP2-4.5 — orange band + line */}
            <Area type="monotone" dataKey="s2_p90"  stackId="s2" fill="transparent"           stroke="none" isAnimationActive={false} legendType="none" />
            <Area type="monotone" dataKey="s2_band" stackId="s2" fill="rgba(249,115,22,0.18)"  stroke="none" isAnimationActive={false} legendType="none" />

            {/* SSP5-8.5 — red band + line */}
            <Area type="monotone" dataKey="s3_p90"  stackId="s3" fill="transparent"           stroke="none" isAnimationActive={false} legendType="none" />
            <Area type="monotone" dataKey="s3_band" stackId="s3" fill="rgba(239,68,68,0.16)"   stroke="none" isAnimationActive={false} legendType="none" />

            {/* P50 lines — SSP5 drawn first so SSP1/2 sit on top */}
            <Line type="monotone" dataKey="s3_p50"  stroke="#ef4444"           strokeWidth={1.5} dot={false} isAnimationActive={false} legendType="none" />
            <Line type="monotone" dataKey="s2_p50"  stroke="#f97316"           strokeWidth={2}   dot={false} isAnimationActive={false} legendType="none" />
            <Line type="monotone" dataKey="s1_p50"  stroke="#3b82f6"           strokeWidth={1.5} dot={false} isAnimationActive={false} legendType="none" />
            <Line type="monotone" dataKey="baseline" stroke="var(--slate-900)" strokeWidth={2}   strokeDasharray="5 3" dot={false} isAnimationActive={false} legendType="none" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="forecast-hint">Hover any year to see all three scenario forecasts · the spread between lines is the climate uncertainty range</p>

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
          <span className="heat-risk-score" style={{ color: park.risk >= 7 ? '#dc2626' : park.risk >= 5 ? '#d97706' : '#059669' }}>
            {park.risk.toFixed(1)}<span className="heat-risk-denom">/10</span>
          </span>
          <span className="heat-risk-note">how exposed this park is to extreme heat days through 2055 — hotter panels produce less power and degrade faster</span>
        </div>

        {/* Lifetime revenue — all 3 scenarios */}
        <div className="finance-block">
          <div className="finance-block-title">Lifetime Revenue (30 years) — all scenarios</div>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Industry</th>
                  <th style={{ color: '#3b82f6' }}>SSP1-2.6</th>
                  <th style={{ color: '#f97316' }}>SSP2-4.5</th>
                  <th style={{ color: '#ef4444' }}>SSP5-8.5</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="row-label">30-yr revenue</td>
                  <td>{fmtRev(revBaseline)}</td>
                  <td>{fmtRev(s1.revP50)}</td>
                  <td>{fmtRev(s2.revP50)}</td>
                  <td>{fmtRev(s3.revP50)}</td>
                </tr>
                <tr>
                  <td className="row-label">Shortfall vs industry</td>
                  <td className="em-dash">—</td>
                  <td className="gap-neg">−{fmtRev(s1.gapM)} ({Math.abs(s1.gapPct).toFixed(1)}%)</td>
                  <td className="gap-neg">−{fmtRev(s2.gapM)} ({Math.abs(s2.gapPct).toFixed(1)}%)</td>
                  <td className="gap-neg">−{fmtRev(s3.gapM)} ({Math.abs(s3.gapPct).toFixed(1)}%)</td>
                </tr>
                <tr>
                  <td className="row-label">Conservative (P90)</td>
                  <td className="em-dash">—</td>
                  <td>{fmtRev(s1.revP90)}</td>
                  <td>{fmtRev(s2.revP90)}</td>
                  <td>{fmtRev(s3.revP90)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="finance-note">
            Price assumption: €{PRICE_EUR_PER_MWH}/<Term tip="Megawatt-hour: 1,000 kWh — the standard unit for electricity pricing. At €74/MWh, the park earns €74 for every megawatt-hour it delivers to the grid.">MWh</Term> · illustrative, not a forecast
          </p>
        </div>

      </div>
    </div>
  );
}
