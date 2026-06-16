import rawData from './precomputed_faiman.json';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScenarioYear {
  year:         number; // 1-indexed (1–30)
  baseline_gwh: number;
  p10_gwh:      number; // pessimistic / conservative (solar-finance P90 exceedance)
  p50_gwh:      number; // expected
  p90_gwh:      number; // optimistic
}

export interface ScenarioData {
  years:                  ScenarioYear[];
  lifetime_baseline_gwh:  number;
  lifetime_p50_gwh:       number;
  lifetime_p10_gwh:       number; // conservative (P10 of distribution)
  delta_pct:              number;
  dT_30yr_c:              number;
  finance: {
    price_assumption:       string;
    lifetime_baseline_meur: number;
    lifetime_p50_meur:      number;
    lifetime_p10_meur:      number; // pessimistic revenue (P10 of MC = P90 exceedance in solar finance)
    lifetime_p90_meur:      number; // optimistic revenue (P90 of MC = P10 exceedance)
    revenue_gap_meur:       number;
    revenue_gap_pct:        number;
  };
}

export interface ParkEntry {
  id:           string;
  name:         string;
  type:         'solar';
  state:        string;
  lat:          number;
  lon:          number;
  capacity_mwp: number;
  risk:         number;
  commissioned: number;
  windExposure: number; // fraction of open-field wind at panel surface (Microsoft GRW satellite)
  meanWindMs:   number; // ERA5 mean wind_speed_10m, m/s
  scenarios: {
    'RCP2.6': ScenarioData;
    'RCP4.5': ScenarioData;
    'RCP8.5': ScenarioData;
  };
}

// ── Static metadata not in the JSON ──────────────────────────────────────────

// Wind data from Microsoft GRW satellite + ERA5 (keyed by park id)
const WIND_DATA: Record<string, { windExposure: number; meanWindMs: number }> = {
  Eggebek_Solar_Park:                 { windExposure: 0.731, meanWindMs: 4.165 },
  Solarpark_Weesow_Willmersdorf:      { windExposure: 0.707, meanWindMs: 3.551 },
  Solarpark_Gottesgabe_Neuhardenberg: { windExposure: 0.735, meanWindMs: 3.543 },
  Brandenburg_Briest_Solarpark:       { windExposure: 0.693, meanWindMs: 3.351 },
  Finsterwalde_Solar_Park:            { windExposure: 0.700, meanWindMs: 3.358 },
  Krughuette_Solar_Park:              { windExposure: 0.814, meanWindMs: 3.273 },
  Solarpark_Meuro:                    { windExposure: 0.765, meanWindMs: 3.417 },
  Lauingen_Energy_Park:               { windExposure: 0.787, meanWindMs: 2.779 },
  Strasskirchen_Solar_Park:           { windExposure: 0.738, meanWindMs: 2.409 },
  Solarpark_Pocking:                  { windExposure: 0.793, meanWindMs: 2.630 },
};

const STATE_MAP: Record<string, string> = {
  Eggebek_Solar_Park:                 'Schleswig-Holstein',
  Solarpark_Weesow_Willmersdorf:      'Brandenburg',
  Solarpark_Gottesgabe_Neuhardenberg: 'Brandenburg',
  Brandenburg_Briest_Solarpark:       'Brandenburg',
  Krughuette_Solar_Park:              'Saxony-Anhalt',
  Solarpark_Meuro:                    'Brandenburg / Saxony',
  Lauingen_Energy_Park:               'Bavaria',
  Strasskirchen_Solar_Park:           'Bavaria',
  Finsterwalde_Solar_Park:            'Brandenburg',
  Solarpark_Pocking:                  'Bavaria',
};

// ── Processing ────────────────────────────────────────────────────────────────

function kwh2gwh(kwh: number): number {
  return kwh / 1_000_000;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processScenario(raw: any): ScenarioData {
  const years: ScenarioYear[] = (raw.years as number[]).map((_, i) => ({
    year:         i + 1,
    baseline_gwh: kwh2gwh(raw.baseline_annual_kwh[i]),
    p10_gwh:      kwh2gwh(raw.p10_kwh[i]),
    p50_gwh:      kwh2gwh(raw.p50_kwh[i]),
    p90_gwh:      kwh2gwh(raw.p90_kwh[i]),
  }));

  // Compute lifetime P10 by summing annual p10_kwh array (JSON has no lifetime_p10_kwh field).
  // Derive implied €/kWh price from baseline figures so revenue stays consistent.
  const lifetime_p10_kwh = (raw.p10_kwh as number[]).reduce((s: number, v: number) => s + v, 0);
  const lifetime_p90_kwh = raw.lifetime_p90_kwh as number;
  const pricePerKwh = (raw.finance.lifetime_baseline_meur * 1e6) / (raw.lifetime_baseline_kwh as number);

  return {
    years,
    lifetime_baseline_gwh: kwh2gwh(raw.lifetime_baseline_kwh),
    lifetime_p50_gwh:      kwh2gwh(raw.lifetime_p50_kwh),
    lifetime_p10_gwh:      kwh2gwh(lifetime_p10_kwh),  // actual pessimistic (10th percentile of MC)
    delta_pct:             raw.delta_pct,
    dT_30yr_c:             raw.provenance.dT_30yr_c,
    finance: {
      price_assumption:       raw.finance.price_assumption,
      lifetime_baseline_meur: raw.finance.lifetime_baseline_meur,
      lifetime_p50_meur:      raw.finance.lifetime_p50_meur,
      lifetime_p10_meur:      +(lifetime_p10_kwh * pricePerKwh / 1e6).toFixed(1), // pessimistic revenue
      lifetime_p90_meur:      +(lifetime_p90_kwh * pricePerKwh / 1e6).toFixed(1), // optimistic revenue
      revenue_gap_meur:       raw.finance.revenue_gap_meur,
      revenue_gap_pct:        raw.finance.revenue_gap_pct,
    },
  };
}

// ── Exported park list ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PARKS: ParkEntry[] = (rawData as any).parks.map((p: any) => ({
  id:           p.id,
  name:         p.name,
  type:         'solar' as const,
  state:        STATE_MAP[p.id] ?? 'Germany',
  lat:          p.lat,
  lon:          p.lon,
  capacity_mwp: +(p.capacity_kwp / 1000).toFixed(2),
  risk:         p.risk_score,
  commissioned: p.commissioned,
  windExposure: WIND_DATA[p.id]?.windExposure ?? 0.75,
  meanWindMs:   WIND_DATA[p.id]?.meanWindMs   ?? 3.5,
  scenarios: {
    'RCP2.6': processScenario(p.scenarios['RCP2.6']),
    'RCP4.5': processScenario(p.scenarios['RCP4.5']),
    'RCP8.5': processScenario(p.scenarios['RCP8.5']),
  },
}));
