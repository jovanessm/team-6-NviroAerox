import {
  ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useState, useMemo } from 'react';
import type { ParkEntry } from '../data/parks';
import { ET_FAIMAN_BY_ID, ET_NOCT_BY_ID } from '../data/parks';
import './ParkForecast.css';

export type { ParkEntry };

interface Props {
  park: ParkEntry;
  onClose: () => void;
}

// ── Faiman wind-cooling model ─────────────────────────────────────────────────

function faimanBaselineBoost(windExposure: number, meanWindMs: number): number {
  const effectiveWind = windExposure * meanWindMs;
  const meanGhi       = 400; // W/m² — representative Germany daylight GHI
  const noctDelta     = meanGhi * (45 - 20) / 800; // °C NOCT heating above ambient
  const faimanDelta   = meanGhi / (25 + 6.84 * effectiveWind); // °C Faiman heating
  const coolerBy      = noctDelta - faimanDelta; // Faiman panels run this many °C cooler
  return coolerBy * 0.004; // power fraction recovered (|γ| = 0.004 /°C)
}

// ── SSP / RCP scenario definitions ───────────────────────────────────────────

const SSP_SCENARIOS = [
  {
    id:    's1' as const,
    rcp:   'RCP2.6' as const,
    label: 'SSP1-2.6',
    name:  'Low emissions',
    line:  '#3b82f6',
    band:  'rgba(59,130,246,0.16)',
    tip:   'Low-emissions pathway — the world sharply cuts fossil fuel use, limiting warming to around 1.5–2°C above pre-industrial levels.',
  },
  {
    id:    's2' as const,
    rcp:   'RCP4.5' as const,
    label: 'SSP2-4.5',
    name:  'Middle road',
    line:  '#f97316',
    band:  'rgba(249,115,22,0.18)',
    tip:   'Middle-road pathway — moderate climate action, projecting roughly 2–3°C of warming by 2100.',
  },
  {
    id:    's3' as const,
    rcp:   'RCP8.5' as const,
    label: 'SSP5-8.5',
    name:  'High emissions',
    line:  '#ef4444',
    band:  'rgba(239,68,68,0.16)',
    tip:   'High-emissions pathway — limited climate action, projecting 3–5°C of warming by 2100. The most severe risk benchmark.',
  },
] as const;

// ── Chart data ────────────────────────────────────────────────────────────────

interface TooltipRow {
  year:         number;
  baseline_gwh: number;
  p10_gwh:      number;
  p50_gwh:      number;
  p90_gwh:      number;
  dT:           number; // linear interpolation of dT_30yr_c
}

interface MultiRow {
  year:     number;
  baseline: number;
  // s*_p90 = lower/conservative bound (p10 of distribution); band fills to p90
  s1_p90: number; s1_band: number; s1_p50: number;
  s2_p90: number; s2_band: number; s2_p50: number;
  s3_p90: number; s3_band: number; s3_p50: number;
  _s1: TooltipRow; _s2: TooltipRow; _s3: TooltipRow;
}

function buildMultiData(park: ParkEntry): MultiRow[] {
  // Fall back to RCP4.5 data for the RCP2.6 slot when source lacks it (e.g. EnviroTrust)
  const scens = SSP_SCENARIOS.map(s => {
    const scen = park.scenarios[s.rcp] ?? park.scenarios['RCP4.5'];
    return { years: scen.years, dT30: scen.dT_30yr_c };
  });

  return scens[0].years.map((r1, i) => {
    const r2 = scens[1].years[i];
    const r3 = scens[2].years[i];

    const makeTooltipRow = (r: typeof r1, dT30: number): TooltipRow => ({
      year:         r.year,
      baseline_gwh: r.baseline_gwh,
      p10_gwh:      r.p10_gwh,
      p50_gwh:      r.p50_gwh,
      p90_gwh:      r.p90_gwh,
      dT:           +(dT30 * (r.year / 30)).toFixed(3),
    });

    return {
      year:     r1.year,
      baseline: +r1.baseline_gwh.toFixed(3),
      // p10_gwh = pessimistic lower bound → used as transparent chart base
      // p90_gwh = optimistic upper bound → band fills up to here
      s1_p90: +r1.p10_gwh.toFixed(3), s1_band: +(r1.p90_gwh - r1.p10_gwh).toFixed(3), s1_p50: +r1.p50_gwh.toFixed(3),
      s2_p90: +r2.p10_gwh.toFixed(3), s2_band: +(r2.p90_gwh - r2.p10_gwh).toFixed(3), s2_p50: +r2.p50_gwh.toFixed(3),
      s3_p90: +r3.p10_gwh.toFixed(3), s3_band: +(r3.p90_gwh - r3.p10_gwh).toFixed(3), s3_p50: +r3.p50_gwh.toFixed(3),
      _s1: makeTooltipRow(r1, scens[0].dT30),
      _s2: makeTooltipRow(r2, scens[1].dT30),
      _s3: makeTooltipRow(r3, scens[2].dT30),
    };
  });
}

// ── NOCT scaling helpers ──────────────────────────────────────────────────────

function scaleTooltipRow(r: TooltipRow, f: number): TooltipRow {
  return {
    ...r,
    baseline_gwh: +(r.baseline_gwh * f).toFixed(3),
    p10_gwh:      +(r.p10_gwh * f).toFixed(3),
    p50_gwh:      +(r.p50_gwh * f).toFixed(3),
    p90_gwh:      +(r.p90_gwh * f).toFixed(3),
  };
}

function scaleMultiRow(d: MultiRow, f: number): MultiRow {
  return {
    ...d,
    baseline: +(d.baseline * f).toFixed(3),
    s1_p90: +(d.s1_p90 * f).toFixed(3), s1_band: +(d.s1_band * f).toFixed(3), s1_p50: +(d.s1_p50 * f).toFixed(3),
    s2_p90: +(d.s2_p90 * f).toFixed(3), s2_band: +(d.s2_band * f).toFixed(3), s2_p50: +(d.s2_p50 * f).toFixed(3),
    s3_p90: +(d.s3_p90 * f).toFixed(3), s3_band: +(d.s3_band * f).toFixed(3), s3_p50: +(d.s3_p50 * f).toFixed(3),
    _s1: scaleTooltipRow(d._s1, f),
    _s2: scaleTooltipRow(d._s2, f),
    _s3: scaleTooltipRow(d._s3, f),
  };
}

// ── Per-scenario lifetime stats ───────────────────────────────────────────────

interface ScenStats {
  lifetimeP50:  number;
  lifetimeP10:  number; // pessimistic (P10 of MC distribution)
  lifetimeP90:  number; // optimistic (P90 of MC distribution)
  revBaseline:  number;
  revP50:       number;
  revP10:       number; // pessimistic revenue
  revP90:       number; // optimistic revenue
  npvBaseline:  number; // NPV @ 6% WACC
  npvP50:       number;
  npvP10:       number;
  npvGap:       number;
  lossPct:      number;
  gapM:         number;
  gapPct:       number;
  dT_30yr_c:    number;
  price_label:  string;
}

function makeStats(park: ParkEntry, rcp: 'RCP2.6' | 'RCP4.5' | 'RCP8.5'): ScenStats {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const s = park.scenarios[rcp]!;
  return {
    lifetimeP50:  s.lifetime_p50_gwh,
    lifetimeP10:  s.lifetime_p10_gwh,
    lifetimeP90:  s.lifetime_baseline_gwh, // P90 of output ~ baseline for reference
    revBaseline:  s.finance.lifetime_baseline_meur,
    revP50:       s.finance.lifetime_p50_meur,
    revP10:       s.finance.lifetime_p10_meur,
    revP90:       s.finance.lifetime_p90_meur,
    npvBaseline:  s.finance.npv_baseline_meur,
    npvP50:       s.finance.npv_p50_meur,
    npvP10:       s.finance.npv_p10_meur,
    npvGap:       s.finance.npv_gap_meur,
    lossPct:      s.delta_pct,
    gapM:         s.finance.revenue_gap_meur,
    gapPct:       s.finance.revenue_gap_pct,
    dT_30yr_c:    s.dT_30yr_c,
    price_label:  s.finance.price_assumption,
  };
}

function scaleStats(s: ScenStats, f: number): ScenStats {
  if (f === 1) return s;
  return {
    ...s,
    lifetimeP50: s.lifetimeP50 * f,
    lifetimeP10: s.lifetimeP10 * f,
    lifetimeP90: s.lifetimeP90 * f,
    revBaseline: s.revBaseline * f,
    revP50:      s.revP50 * f,
    revP10:      s.revP10 * f,
    revP90:      s.revP90 * f,
    npvBaseline: s.npvBaseline * f,
    npvP50:      s.npvP50 * f,
    npvP10:      s.npvP10 * f,
    npvGap:      s.npvGap * f,
    gapM:        s.gapM * f,
  };
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtGwh(gwh: number) {
  return gwh >= 1000 ? `${(gwh / 1000).toFixed(2)} TWh` : `${gwh.toFixed(1)} GWh`;
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
  return <>{gwh.toFixed(1)} <Term tip={GWH_TIP}>GWh</Term></>;
}

// ── SVG chart for the PDF report ──────────────────────────────────────────────

function buildSvgChart(data: MultiRow[]): string {
  const W = 660, H = 175;
  const PL = 42, PR = 8, PT = 10, PB = 26;
  const cW = W - PL - PR, cH = H - PT - PB;

  const allY = data.flatMap(d => [d.s3_p90, d.s1_p90 + d.s1_band, d.baseline]);
  const yMin = Math.min(...allY) - 0.05;
  const yMax = Math.max(...allY) + 0.05;

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
    `<text x="${PL-4}" y="${(sy(v)+3.5).toFixed(1)}" text-anchor="end" font-size="9" font-family="sans-serif" fill="#9ca3af">${v.toFixed(1)}</text>`).join('');
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
  park:    ParkEntry,
  data:    MultiRow[],
  stats:   [ScenStats, ScenStats, ScenStats],
): string {
  const date      = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const refId     = park.name.replace(/\s+/g, '-').toUpperCase().slice(0, 8) + '-' + Date.now().toString(36).toUpperCase().slice(-5);
  const [s1, s2, s3] = stats;
  const chartSvg  = buildSvgChart(data);
  const riskLvl   = park.risk >= 7 ? 'High' : park.risk >= 5 ? 'Moderate' : 'Low';
  const riskColor = park.risk >= 7 ? '#dc2626' : park.risk >= 5 ? '#d97706' : '#059669';

  const scenRows = SSP_SCENARIOS.map((scen, i) => {
    const s = stats[i];
    return `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${scen.line};margin-right:6px;vertical-align:middle"></span>${scen.label} · ${scen.name} · +${s.dT_30yr_c.toFixed(2)}°C over 30 yr</td><td>${fmtGwh(s.lifetimeP50)}</td><td class="neg">${s.lossPct.toFixed(2)}%</td><td class="neg">${s.gapM < 0 ? '−' : '+'}${fmtRev(s.gapM)}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Climate Risk Report — ${park.name}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;background:#fff;color:#111;font-size:12px;line-height:1.5}
.print-bar{background:#f9fafb;border-bottom:1px solid #e5e7eb;padding:10px 44px;display:flex;align-items:center;justify-content:space-between}
.print-bar span{font-size:11px;color:#888}.print-btn{background:#111;color:#fff;border:none;padding:8px 20px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
.page{max-width:760px;margin:0 auto;padding:36px 44px 28px}
.rpt-hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #111;margin-bottom:22px}
.rpt-brand{font-size:16px;font-weight:800;letter-spacing:-0.03em}.rpt-brand-sub{font-size:10px;color:#888;margin-top:2px}
.rpt-doc-meta{text-align:right;font-size:10px;color:#888;line-height:1.7}.rpt-doc-type{font-size:11px;font-weight:700;color:#111}
.rpt-park{margin-bottom:14px}.rpt-park-name{font-size:20px;font-weight:700;letter-spacing:-0.03em;margin-bottom:3px}.rpt-park-meta{font-size:11px;color:#666}
.rpt-heat{display:flex;align-items:center;gap:14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;margin-bottom:18px}
.rpt-heat-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:2px}
.rpt-heat-val{font-size:22px;font-weight:800;color:${riskColor};line-height:1}
.rpt-heat-lvl{font-size:11px;font-weight:700;color:${riskColor}}.rpt-heat-desc{font-size:11px;color:#666;flex:1}
.rpt-headline{display:grid;grid-template-columns:1fr 1fr;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:20px}
.rpt-hl{padding:12px 16px}.rpt-hl+.rpt-hl{border-left:1px solid #e5e7eb}
.rpt-hl-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:4px}
.rpt-hl-val{font-size:18px;font-weight:700;letter-spacing:-0.03em}.rpt-hl-sub{font-size:10px;color:#888;margin-top:2px}
.sec-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:8px}
.rpt-chart-wrap{border:1px solid #e5e7eb;border-radius:8px;padding:12px 8px 6px;margin-bottom:6px}
.rpt-legend{display:flex;flex-wrap:wrap;gap:16px;font-size:9px;color:#666;padding:6px 8px 14px 48px}
.sw{display:inline-block;width:14px;height:2px;vertical-align:middle;margin-right:4px;border-radius:1px}
.sw-dash{display:inline-block;width:14px;border-top:1.5px dashed #374151;vertical-align:middle;margin-right:4px}
table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:18px}
thead tr{background:#f9fafb;border-bottom:1px solid #e5e7eb}
th{padding:7px 12px;text-align:right;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#888}
th:first-child{text-align:left}td{padding:7px 12px;text-align:right;border-bottom:1px solid #f3f4f6}td:first-child{text-align:left;color:#555}
.neg{color:#dc2626;font-weight:600}
.rpt-footer{border-top:1px solid #e5e7eb;padding-top:10px;font-size:9px;color:#aaa;display:flex;justify-content:space-between;gap:20px}
@media print{.print-bar{display:none!important}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{padding:0;max-width:none}@page{margin:16mm 20mm}}
</style></head><body>
<div class="print-bar"><span>NviroAerox Climate Risk Report — ${park.name}</span><button class="print-btn" onclick="window.print()">Save as PDF</button></div>
<div class="page">
  <div class="rpt-hdr">
    <div><div class="rpt-brand">NviroAerox</div><div class="rpt-brand-sub">Power, Seen From Orbit · NviroAerox Challenge 2026</div></div>
    <div class="rpt-doc-meta"><div class="rpt-doc-type">Climate Risk Assessment</div><div>${date}</div><div>Ref: NVT-${refId}</div></div>
  </div>
  <div class="rpt-park">
    <div class="rpt-park-name">${park.name}</div>
    <div class="rpt-park-meta">${park.state} · ${park.lat.toFixed(3)}°N, ${park.lon.toFixed(3)}°E · ${park.capacity_mwp} MWp · Solar PV · Commissioned ${park.commissioned}</div>
  </div>
  <div class="rpt-heat">
    <div><div class="rpt-heat-lbl">Climate Heat Risk</div><div class="rpt-heat-val">${park.risk.toFixed(1)}<span style="font-size:11px;font-weight:400;color:#888">/10</span></div></div>
    <div class="rpt-heat-lvl">${riskLvl}</div>
    <div class="rpt-heat-desc">Exposure to extreme heat days through 2055. Rising ambient temperatures reduce panel efficiency via thermal derating and accelerate cell degradation via the Arrhenius effect, compounding losses over the asset lifetime.</div>
  </div>
  <div class="rpt-headline">
    <div class="rpt-hl">
      <div class="rpt-hl-lbl">Industry Standard (baseline)</div>
      <div class="rpt-hl-val">${fmtGwh(s2.lifetimeP50 / (1 + s2.lossPct / 100))}</div>
      <div class="rpt-hl-sub">30-year total · €${s2.revBaseline.toFixed(1)}M revenue</div>
    </div>
    <div class="rpt-hl">
      <div class="rpt-hl-lbl">Middle Road SSP2-4.5 · Expected (P50)</div>
      <div class="rpt-hl-val" style="color:#f97316">${fmtGwh(s2.lifetimeP50)}</div>
      <div class="rpt-hl-sub" style="color:#dc2626">${s2.lossPct.toFixed(2)}% vs industry · ${s2.gapM < 0 ? '−' : '+'}${fmtRev(s2.gapM)} shortfall</div>
    </div>
  </div>
  <div class="sec-lbl">30-year output forecast — GWh per year · all three scenarios</div>
  <div class="rpt-chart-wrap">${chartSvg}</div>
  <div class="rpt-legend">
    <span><span class="sw" style="background:#3b82f6"></span>SSP1-2.6 Low emissions</span>
    <span><span class="sw" style="background:#f97316"></span>SSP2-4.5 Middle road</span>
    <span><span class="sw" style="background:#ef4444"></span>SSP5-8.5 High emissions</span>
    <span><span class="sw-dash"></span>Industry assumption</span>
  </div>
  <div class="sec-lbl">Scenario comparison — 30-year P50 expected output</div>
  <table><thead><tr><th>Scenario</th><th>Expected Output</th><th>Output Loss</th><th>Revenue Shortfall</th></tr></thead><tbody>${scenRows}</tbody></table>
  <div class="sec-lbl">Lifetime revenue summary (30 years · ${s2.price_label})</div>
  <table>
    <thead><tr><th></th><th>Industry</th><th>SSP1-2.6</th><th>SSP2-4.5</th><th>SSP5-8.5</th></tr></thead>
    <tbody>
      <tr><td>30-yr revenue (P50)</td><td>${fmtRev(s1.revBaseline)}</td><td>${fmtRev(s1.revP50)}</td><td>${fmtRev(s2.revP50)}</td><td>${fmtRev(s3.revP50)}</td></tr>
      <tr><td>Shortfall vs industry</td><td>—</td><td class="neg">${s1.gapM < 0 ? '−' : '+'}${fmtRev(s1.gapM)} (${Math.abs(s1.gapPct).toFixed(2)}%)</td><td class="neg">${s2.gapM < 0 ? '−' : '+'}${fmtRev(s2.gapM)} (${Math.abs(s2.gapPct).toFixed(2)}%)</td><td class="neg">${s3.gapM < 0 ? '−' : '+'}${fmtRev(s3.gapM)} (${Math.abs(s3.gapPct).toFixed(2)}%)</td></tr>
      <tr><td>Downside (P10) · 90% exceedance</td><td>—</td><td>${fmtRev(s1.revP10)}</td><td>${fmtRev(s2.revP10)}</td><td>${fmtRev(s3.revP10)}</td></tr>
      <tr><td>Upside (P90) · 10% exceedance</td><td>—</td><td>${fmtRev(s1.revP90)}</td><td>${fmtRev(s2.revP90)}</td><td>${fmtRev(s3.revP90)}</td></tr>
    </tbody>
  </table>
  <div class="rpt-footer">
    <div><strong>NviroTrust</strong> · Climate Risk Assessment<br>Scenarios: RCP2.6 / RCP4.5 / RCP8.5 · n_draws=3000 Monte Carlo · Faiman wind-cooling model<br>Physics: NOCT→Faiman thermal derating + Arrhenius degradation · Climate: CMIP6 delta method</div>
    <div style="text-align:right">Generated ${date}<br>${s2.price_label}<br>Park specs: MaStR registry · Illustrative only</div>
  </div>
</div></body></html>`;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function ForecastTooltip({ active, label, data }: { active?: boolean; label?: number; data: MultiRow[] }) {
  if (!active || label == null) return null;
  const row = data.find(d => d.year === Number(label));
  if (!row) return null;

  const rows = [
    { scen: SSP_SCENARIOS[0], r: row._s1 },
    { scen: SSP_SCENARIOS[1], r: row._s2 },
    { scen: SSP_SCENARIOS[2], r: row._s3 },
  ];

  return (
    <div className="prov-tooltip">
      <div className="prov-header">Year {label} &nbsp;·&nbsp; {2024 + Number(label)}</div>
      <div className="prov-baseline">
        Industry standard &nbsp;<strong>{row.baseline.toFixed(2)} GWh/yr</strong>
      </div>
      {rows.map(({ scen, r }) => (
        <div key={scen.id} className="prov-scenario" style={{ borderLeftColor: scen.line }}>
          <div className="prov-name" style={{ color: scen.line }}>
            {scen.label} · {scen.name}
          </div>
          <div className="prov-grid">
            <span>Expected (P50)</span>        <span>{r.p50_gwh.toFixed(2)} GWh/yr</span>
            <span>Range (P10–P90)</span>        <span>{r.p10_gwh.toFixed(2)} – {r.p90_gwh.toFixed(2)} GWh</span>
            <span>Cumulative ΔT</span>          <span>+{r.dT.toFixed(3)}°C</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ParkForecast({ park, onClose }: Props) {
  const [useFaiman,  setUseFaiman]  = useState(true);
  const [useET,      setUseET]      = useState(false);
  const [opexInput,  setOpexInput]  = useState('');

  // Resolve the active park dataset based on climate source + cell temp model
  const activePark: ParkEntry = useMemo(() => {
    if (!useET) return park;
    const etMap = useFaiman ? ET_FAIMAN_BY_ID : ET_NOCT_BY_ID;
    return etMap[park.id] ?? park;
  }, [park, useET, useFaiman]);

  // Scaling: only for CMIP6+NOCT (Faiman JSON scaled down); ET uses real separate datasets
  const windBoost     = faimanBaselineBoost(park.windExposure, park.meanWindMs);
  const noctFactor    = 1 / (1 + windBoost);
  const factor        = (!useET && !useFaiman) ? noctFactor : 1;
  const effectiveWind = park.windExposure * park.meanWindMs;
  const noctPanelDT   = 12.5; // 400 W/m² × 25°C / 800 = fixed NOCT heating
  const faimanPanelDT = 400 / (25 + 6.84 * effectiveWind); // Faiman cell ΔT

  const opexKperYear  = Math.max(0, parseFloat(opexInput) || 0);
  const opex30yr      = opexKperYear * 30 / 1000; // €M over 30 years
  const hasOpex       = opexKperYear > 0;

  const rawData  = useMemo(() => buildMultiData(activePark), [activePark]);
  const data     = useMemo(
    () => factor === 1 ? rawData : rawData.map(d => scaleMultiRow(d, factor)),
    [rawData, factor],
  );

  // RCP2.6 not available for EnviroTrust source — fall back to RCP4.5 for stats (hidden in UI)
  const rawS1 = makeStats(activePark, activePark.hasRcp26 ? 'RCP2.6' : 'RCP4.5');
  const rawS2 = makeStats(activePark, 'RCP4.5');
  const rawS3 = makeStats(activePark, 'RCP8.5');
  const s1 = scaleStats(rawS1, factor);
  const s2 = scaleStats(rawS2, factor);
  const s3 = scaleStats(rawS3, factor);
  const scenStats: [ScenStats, ScenStats, ScenStats] = [s1, s2, s3];

  // Model comparison panel: show both variants for the active climate source
  const cmpNoctPark    = useET ? (ET_NOCT_BY_ID[park.id]   ?? null) : null;
  const cmpFaimanPark  = useET ? (ET_FAIMAN_BY_ID[park.id] ?? null) : null;
  const cmpNoctS2      = useET && cmpNoctPark
    ? makeStats(cmpNoctPark,   'RCP4.5')
    : scaleStats(makeStats(park, 'RCP4.5'), noctFactor);
  const cmpFaimanS2    = useET && cmpFaimanPark
    ? makeStats(cmpFaimanPark, 'RCP4.5')
    : makeStats(park, 'RCP4.5');
  const cmpNoctLife    = useET && cmpNoctPark
    ? cmpNoctPark.scenarios['RCP4.5'].lifetime_p50_gwh
    : park.scenarios['RCP4.5'].lifetime_p50_gwh * noctFactor;
  const cmpFaimanLife  = useET && cmpFaimanPark
    ? cmpFaimanPark.scenarios['RCP4.5'].lifetime_p50_gwh
    : park.scenarios['RCP4.5'].lifetime_p50_gwh;
  const modelGainPct   = cmpNoctLife > 0
    ? ((cmpFaimanLife - cmpNoctLife) / cmpNoctLife) * 100
    : windBoost * 100;

  const lifetimeBaseline = activePark.scenarios['RCP4.5'].lifetime_baseline_gwh * factor;

  // Zoom Y-axis to the actual data range. Recharts stacked areas always stack from
  // 0, so we shift every value down by chartYMin and add it back in tickFormatter.
  const dataMin = data.length ? Math.min(...data.map(d => Math.min(d.s3_p90, d.s2_p90, d.s1_p90))) : 0;
  const dataMax = data.length ? Math.max(...data.map(d => d.baseline)) : 1;
  const chartPad = Math.max((dataMax - dataMin) * 0.08, 0.05);
  const chartYMin = Math.floor((dataMin - chartPad) * 10) / 10;
  const chartYMax = Math.ceil((dataMax + chartPad) * 10) / 10;

  // Shift stacked-area values by chartYMin; line & tooltip data stay at real GWh
  const chartData = useMemo(() => data.map(d => ({
    ...d,
    baseline: +(d.baseline - chartYMin).toFixed(3),
    s1_p90: +Math.max(0, d.s1_p90 - chartYMin).toFixed(3),
    s1_p50: +(d.s1_p50 - chartYMin).toFixed(3),
    s2_p90: +Math.max(0, d.s2_p90 - chartYMin).toFixed(3),
    s2_p50: +(d.s2_p50 - chartYMin).toFixed(3),
    s3_p90: +Math.max(0, d.s3_p90 - chartYMin).toFixed(3),
    s3_p50: +(d.s3_p50 - chartYMin).toFixed(3),
  })), [data, chartYMin]);

  function downloadReport() {
    const html = generateReportHtml(activePark, rawData, [rawS1, rawS2, rawS3]);
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
          <p className="forecast-park-meta">
            {park.state} &nbsp;·&nbsp; {park.lat.toFixed(3)}, {park.lon.toFixed(3)}
            &nbsp;·&nbsp; {park.capacity_mwp} MWp &nbsp;·&nbsp; est. {park.commissioned}
          </p>
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
            <Term tip="Middle-road climate pathway (SSP2-4.5 / RCP4.5) — moderate action, around 2–3°C of warming by 2100. Used as the reference case for lenders and insurers.">
              Middle Road · SSP2-4.5
            </Term>
          </div>
          <div className="hl-value" style={{ color: '#f97316' }}><FmtValue gwh={s2.lifetimeP50} /></div>
          <div className={`hl-delta ${s2.lossPct < 0 ? 'neg' : 'pos'}`}>{s2.lossPct.toFixed(2)}% vs industry</div>
        </div>
        <div className="hl-sep" />
        <div className="hl-item">
          <div className="hl-label">
            <Term tip="The revenue gap between the standard forecast and the middle-road climate-adjusted forecast — earnings the industry model counts that may not materialise as temperatures rise.">
              Revenue at Risk
            </Term>
          </div>
          <div className="hl-value">{fmtRev(s2.gapM)}</div>
          <div className="hl-sub">SSP2-4.5 P50 vs industry</div>
        </div>
      </div>

      {/* ── SSP scenario strip ────────────────────────────── */}
      <div className="ssp-strip">
        {SSP_SCENARIOS.map((scen, i) => {
          const unavailable = scen.rcp === 'RCP2.6' && !activePark.hasRcp26;
          const st = scenStats[i];
          return (
            <div key={scen.id} className={`ssp-row${unavailable ? ' ssp-row-unavailable' : ''}`}>
              <span className="ssp-dot" style={{ background: unavailable ? '#d1d5db' : scen.line }} />
              <span className="ssp-scenario-label">
                <Term tip={scen.tip}>{scen.label}</Term>
              </span>
              <span className="ssp-scenario-name">
                {unavailable
                  ? 'Not available for EnviroTrust source'
                  : `${scen.name} · +${st.dT_30yr_c.toFixed(2)}°C over 30 yr`}
              </span>
              <span className="ssp-delta">{unavailable ? '—' : `${st.lossPct.toFixed(2)}%`}</span>
              <span className="ssp-rev">{unavailable ? '—' : `${st.gapM < 0 ? '−' : '+'}${fmtRev(st.gapM)}`}</span>
            </div>
          );
        })}
      </div>

      {/* ── Model toggle ─────────────────────────────────── */}
      <div className="model-toggle-section">
        <div className="model-toggle-row">
          <div className="model-toggle-label">Climate source</div>
          <div className="model-toggle-pills">
            <button
              className={`model-pill${!useET ? ' active' : ''}`}
              onClick={() => setUseET(false)}
            >
              CMIP6
            </button>
            <button
              className={`model-pill${useET ? ' active' : ''}`}
              onClick={() => setUseET(true)}
            >
              EnviroTrust
            </button>
          </div>
        </div>
        <div className="model-toggle-row">
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
        </div>
        <div className="model-toggle-meta" style={{ visibility: useET ? 'visible' : 'hidden' }}>
          EnviroTrust provides <strong>RCP4.5 and RCP8.5 only</strong> — SSP1-2.6 shown as unavailable.
        </div>
        {/* ── Side-by-side model comparison ── */}
        <div className="model-cmp">
          {/* NOCT column — clickable */}
          <button className={`model-cmp-col${!useFaiman ? ' model-cmp-active' : ''}`} onClick={() => setUseFaiman(false)}>
            <div className="model-cmp-col-hdr">
              <span className="model-cmp-col-name">Standard · NOCT</span>
              {!useFaiman && <span className="model-cmp-badge">active</span>}
            </div>
            <div className="model-cmp-metric">
              <span className="model-cmp-label">30-yr P50 revenue</span>
              <span className="model-cmp-value">{fmtRev(cmpNoctS2.revP50)}</span>
            </div>
            <div className="model-cmp-metric">
              <span className="model-cmp-label">Lifetime P50 output</span>
              <span className="model-cmp-value">{fmtGwh(cmpNoctLife)}</span>
            </div>
            <div className="model-cmp-metric">
              <span className="model-cmp-label">Cell ΔT above ambient</span>
              <span className="model-cmp-value">+{noctPanelDT.toFixed(1)}°C</span>
            </div>
            <div className="model-cmp-metric">
              <span className="model-cmp-label">Wind cooling</span>
              <span className="model-cmp-value model-cmp-muted">not modelled</span>
            </div>
          </button>

          {/* Centre arrow */}
          <div className="model-cmp-divider">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
            </svg>
            <span className="model-cmp-gain">+{modelGainPct.toFixed(1)}%</span>
            <span className="model-cmp-gain-label">more output<br/>with Faiman</span>
          </div>

          {/* Faiman column — clickable */}
          <button className={`model-cmp-col${useFaiman ? ' model-cmp-active model-cmp-faiman' : ''}`} onClick={() => setUseFaiman(true)}>
            <div className="model-cmp-col-hdr">
              <span className="model-cmp-col-name">Satellite · Faiman</span>
              {useFaiman && <span className="model-cmp-badge">active</span>}
            </div>
            <div className="model-cmp-metric">
              <span className="model-cmp-label">30-yr P50 revenue</span>
              <span className="model-cmp-value model-cmp-better">{fmtRev(cmpFaimanS2.revP50)}</span>
            </div>
            <div className="model-cmp-metric">
              <span className="model-cmp-label">Lifetime P50 output</span>
              <span className="model-cmp-value model-cmp-better">{fmtGwh(cmpFaimanLife)}</span>
            </div>
            <div className="model-cmp-metric">
              <span className="model-cmp-label">Cell ΔT above ambient</span>
              <span className="model-cmp-value model-cmp-better">+{faimanPanelDT.toFixed(1)}°C</span>
            </div>
            <div className="model-cmp-metric">
              <span className="model-cmp-label">Wind cooling</span>
              <span className="model-cmp-value">{effectiveWind.toFixed(2)} m/s eff. (GRW × ERA5)</span>
            </div>
          </button>
        </div>
      </div>

      {/* ── Legend ───────────────────────────────────────── */}
      <div className="forecast-legend">
        {SSP_SCENARIOS.filter(scen => scen.rcp !== 'RCP2.6' || activePark.hasRcp26).map(scen => (
          <span key={scen.id} className="legend-scen">
            <span className="legend-swatch" style={{ background: scen.line }} />
            {scen.label}
          </span>
        ))}
        <span className="legend-baseline">
          <span className="legend-dash" />
          <Term tip="The standard forecast: historical average weather, climate held flat for 30 years. The baseline used in most prospectuses.">
            Industry assumption
          </Term>
        </span>
      </div>

      {/* ── Fan chart ─────────────────────────────────────── */}
      <div className="forecast-chart-wrap">
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="year"
              tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
              tickLine={false} axisLine={false}
              label={{ value: 'years', position: 'insideRight', offset: -4, fontSize: 11, fill: 'var(--text-muted)', dy: 2 }}
            />
            <YAxis
              type="number" domain={[0, +(chartYMax - chartYMin).toFixed(2)]}
              tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
              tickLine={false} axisLine={false}
              tickFormatter={v => (v + chartYMin).toFixed(1)} width={44}
              label={{ value: 'GWh/yr', angle: -90, position: 'insideLeft', offset: 14, fontSize: 11, fill: 'var(--text-muted)' }}
            />
            <Tooltip content={(props) => (
              <ForecastTooltip active={props.active} label={props.label as number} data={data} />
            )} />

            {/* SSP1-2.6 — blue (hidden when source lacks RCP2.6) */}
            {activePark.hasRcp26 && <Area type="monotone" dataKey="s1_p90"  stackId="s1" fill="transparent"           stroke="none" isAnimationActive={false} legendType="none" />}
            {activePark.hasRcp26 && <Area type="monotone" dataKey="s1_band" stackId="s1" fill="rgba(59,130,246,0.16)"  stroke="none" isAnimationActive={false} legendType="none" />}
            {/* SSP2-4.5 — orange */}
            <Area type="monotone" dataKey="s2_p90"  stackId="s2" fill="transparent"           stroke="none" isAnimationActive={false} legendType="none" />
            <Area type="monotone" dataKey="s2_band" stackId="s2" fill="rgba(249,115,22,0.18)"  stroke="none" isAnimationActive={false} legendType="none" />
            {/* SSP5-8.5 — red */}
            <Area type="monotone" dataKey="s3_p90"  stackId="s3" fill="transparent"           stroke="none" isAnimationActive={false} legendType="none" />
            <Area type="monotone" dataKey="s3_band" stackId="s3" fill="rgba(239,68,68,0.16)"   stroke="none" isAnimationActive={false} legendType="none" />

            {/* P50 lines */}
            <Line type="monotone" dataKey="s3_p50"  stroke="#ef4444"           strokeWidth={1.5} dot={false} isAnimationActive={false} legendType="none" />
            <Line type="monotone" dataKey="s2_p50"  stroke="#f97316"           strokeWidth={2}   dot={false} isAnimationActive={false} legendType="none" />
            {activePark.hasRcp26 && <Line type="monotone" dataKey="s1_p50"  stroke="#3b82f6"           strokeWidth={1.5} dot={false} isAnimationActive={false} legendType="none" />}
            <Line type="monotone" dataKey="baseline" stroke="var(--slate-900)" strokeWidth={2}   strokeDasharray="5 3" dot={false} isAnimationActive={false} legendType="none" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="forecast-hint">
        Hover any year to see all three scenario forecasts · bands show P10–P90 range from 3,000 Monte Carlo draws
      </p>

      {/* ── Finance section ───────────────────────────────── */}
      <div className="finance-divider" />
      <div className="finance-section">

        {/* Heat risk */}
        <div className="heat-risk-row">
          <span className="heat-risk-label">
            <Term tip="A score from 0–10 measuring how much extreme heat events are projected to affect this park's output through 2055. Higher = more heat exposure.">
              Climate Heat Risk
            </Term>
          </span>
          <span className="heat-risk-score" style={{ color: park.risk >= 7 ? '#dc2626' : park.risk >= 5 ? '#d97706' : '#059669' }}>
            {park.risk.toFixed(1)}<span className="heat-risk-denom">/10</span>
          </span>
          <span className="heat-risk-note">hotter panels produce less power and degrade faster — compounding over 30 years</span>
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
                  {activePark.hasRcp26 && <th style={{ color: '#3b82f6' }}>SSP1-2.6</th>}
                  <th style={{ color: '#f97316' }}>SSP2-4.5</th>
                  <th style={{ color: '#ef4444' }}>SSP5-8.5</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="row-label">
                    Nominal revenue (P50)
                    <span className="fin-row-hint">undiscounted 30-yr sum</span>
                  </td>
                  <td>{fmtRev(s2.revBaseline)}</td>
                  {activePark.hasRcp26 && <td>{fmtRev(s1.revP50)}</td>}
                  <td>{fmtRev(s2.revP50)}</td>
                  <td>{fmtRev(s3.revP50)}</td>
                </tr>
                <tr className="fin-tr-highlight">
                  <td className="row-label">
                    <Term tip="Net Present Value: future revenues discounted at 6% WACC (typical German utility-scale solar project finance rate). Year 30 cash flows are worth ~17 cents today — NPV is what lenders actually underwrite.">NPV (P50 · 6% WACC)</Term>
                    <span className="fin-row-hint">time-value-adjusted · lender view</span>
                  </td>
                  <td>{fmtRev(s2.npvBaseline)}</td>
                  {activePark.hasRcp26 && <td>{fmtRev(s1.npvP50)}</td>}
                  <td>{fmtRev(s2.npvP50)}</td>
                  <td>{fmtRev(s3.npvP50)}</td>
                </tr>
                <tr>
                  <td className="row-label">
                    NPV shortfall vs industry
                    <span className="fin-row-hint">discounted gap a lender would underwrite</span>
                  </td>
                  <td className="em-dash">—</td>
                  {activePark.hasRcp26 && <td className="gap-neg">{s1.npvGap < 0 ? '−' : '+'}€{Math.abs(s1.npvGap).toFixed(1)}M</td>}
                  <td className="gap-neg">{s2.npvGap < 0 ? '−' : '+'}€{Math.abs(s2.npvGap).toFixed(1)}M</td>
                  <td className="gap-neg">{s3.npvGap < 0 ? '−' : '+'}€{Math.abs(s3.npvGap).toFixed(1)}M</td>
                </tr>
                <tr>
                  <td className="row-label">Nominal shortfall vs industry</td>
                  <td className="em-dash">—</td>
                  {activePark.hasRcp26 && <td className="gap-neg">{s1.gapM < 0 ? '−' : '+'}€{Math.abs(s1.gapM).toFixed(1)}M ({Math.abs(s1.gapPct).toFixed(2)}%)</td>}
                  <td className="gap-neg">{s2.gapM < 0 ? '−' : '+'}€{Math.abs(s2.gapM).toFixed(1)}M ({Math.abs(s2.gapPct).toFixed(2)}%)</td>
                  <td className="gap-neg">{s3.gapM < 0 ? '−' : '+'}€{Math.abs(s3.gapM).toFixed(1)}M ({Math.abs(s3.gapPct).toFixed(2)}%)</td>
                </tr>
                <tr>
                  <td className="row-label">
                    Downside NPV (P10)
                    <span className="fin-row-hint">worst-case 10th pct — 90% exceedance</span>
                  </td>
                  <td className="em-dash">—</td>
                  {activePark.hasRcp26 && <td>{fmtRev(s1.npvP10)}</td>}
                  <td>{fmtRev(s2.npvP10)}</td>
                  <td>{fmtRev(s3.npvP10)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="finance-note">
            <Term tip="The real-market electricity price used for revenue calculations, derived from SMARD day-ahead market data.">Price assumption</Term>: {s2.price_label} · NPV discounted at 6% WACC · illustrative, not a financial forecast · n=3,000 Monte Carlo draws
          </p>
        </div>

        {/* ── Betriebskosten ────────────────────────────────── */}
        <div className="opex-section">
          <div className="opex-header">
            <span className="opex-title">Operating Costs</span>
            <span className="opex-sep">·</span>
            <span className="opex-subtitle">Enter annual O&amp;M costs to calculate net profit</span>
          </div>

          <div className="opex-input-row">
            <div className="opex-input-wrap">
              <span className="opex-currency">€</span>
              <input
                type="number"
                className="opex-input"
                placeholder="0"
                value={opexInput}
                onChange={e => setOpexInput(e.target.value)}
                min={0}
                step={10}
              />
              <span className="opex-unit">k / year</span>
            </div>
            <div className="opex-presets">
              <button className="opex-preset-btn" onClick={() => setOpexInput(String(Math.round(park.capacity_mwp * 10)))}>
                Low <span className="opex-preset-rate">€10k/MWp</span>
              </button>
              <button className="opex-preset-btn" onClick={() => setOpexInput(String(Math.round(park.capacity_mwp * 17)))}>
                Typical <span className="opex-preset-rate">€17k/MWp</span>
              </button>
              <button className="opex-preset-btn" onClick={() => setOpexInput(String(Math.round(park.capacity_mwp * 25)))}>
                High <span className="opex-preset-rate">€25k/MWp</span>
              </button>
            </div>
          </div>

          <p className="opex-range-hint">
            German solar parks: €10k–25k / MWp / yr
            &nbsp;·&nbsp; for {park.capacity_mwp} MWp:
            &nbsp;<strong>€{Math.round(park.capacity_mwp * 10)}k – €{Math.round(park.capacity_mwp * 25)}k / yr</strong>
          </p>

          {hasOpex && (
            <div className="opex-result">
              <div className="opex-result-header">
                <span className="opex-result-title">Net profit over 30 years</span>
                <span className="opex-30yr-total">30-yr costs: <strong>€{opex30yr.toFixed(1)}M</strong> &nbsp;·&nbsp; €{opexKperYear.toLocaleString('de-DE')}k/yr</span>
              </div>

              {/* Ledger — SSP2-4.5 P50 as headline */}
              <div className="opex-calc">
                <div className="opex-calc-row">
                  <span>Gross revenue (P50 · SSP2-4.5)</span>
                  <span>{fmtRev(s2.revP50)}</span>
                </div>
                <div className="opex-calc-row opex-calc-sub">
                  <span>− Operating costs (30 yr)</span>
                  <span>−{fmtRev(opex30yr)}</span>
                </div>
                <div className={`opex-calc-row opex-calc-total ${(s2.revP50 - opex30yr) >= 0 ? 'opex-pos' : 'opex-neg'}`}>
                  <span>Net profit (P50 · SSP2-4.5)</span>
                  <span>{(s2.revP50 - opex30yr) >= 0 ? '' : '−'}{fmtRev(Math.abs(s2.revP50 - opex30yr))}</span>
                </div>
              </div>

              {/* Per-scenario breakdown cards */}
              <div className="opex-scen-grid">
                {SSP_SCENARIOS.filter(scen => scen.rcp !== 'RCP2.6' || activePark.hasRcp26).map((scen) => {
                  const idx    = SSP_SCENARIOS.indexOf(scen);
                  const s      = scenStats[idx];
                  const netP50 = s.revP50 - opex30yr;
                  const netP10 = s.revP10 - opex30yr;
                  const netP90 = s.revP90 - opex30yr;
                  const profitable = netP50 >= 0;
                  return (
                    <div key={scen.id} className={`opex-scen-card ${profitable ? 'opex-scen-pos' : 'opex-scen-neg'}`}>
                      <div className="opex-scen-top">
                        <span className="opex-scen-dot" style={{ background: scen.line }} />
                        <span className="opex-scen-label" style={{ color: scen.line }}>{scen.label}</span>
                        <span className={`opex-scen-verdict ${profitable ? 'opex-pos' : 'opex-neg'}`}>
                          {profitable ? '✓' : '✗'}
                        </span>
                      </div>
                      <div className={`opex-scen-net ${profitable ? 'opex-pos' : 'opex-neg'}`}>
                        {netP50 >= 0 ? '' : '−'}{fmtRev(Math.abs(netP50))}
                      </div>
                      <div className="opex-scen-sub">{scen.name}</div>
                      <div className="opex-scen-range">
                        <span>P10 {netP10 >= 0 ? '' : '−'}{fmtRev(Math.abs(netP10))}</span>
                        <span>P90 {netP90 >= 0 ? '' : '−'}{fmtRev(Math.abs(netP90))}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="opex-note">P50 expected · P10 worst-case · P90 best-case · costs flat (no inflation adjustment)</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
