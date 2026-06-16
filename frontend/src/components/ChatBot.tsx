import { useState, useRef, useEffect, useCallback } from 'react';
import { PARKS } from '../data/parks';
import './ChatBot.css';

// ── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'bot';
  text: string;
}

interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

// ── Park data derived from real precomputed output ────────────────────────────

interface ChatPark {
  key:              string;
  name:             string;
  state:            string;
  capacity:         number;
  commissioned:     number;
  gwh:              number;  // annual baseline GWh
  lifetime_gwh:     number;  // 30-year baseline total GWh
  d226:             number | null;  // RCP2.6 delta_pct (null for EnviroTrust parks)
  d245:             number;  // RCP4.5 delta_pct
  d585:             number;  // RCP8.5 delta_pct
  dT_245:           number;  // temperature rise °C by yr30 at RCP4.5
  dT_585:           number;  // temperature rise °C by yr30 at RCP8.5
  risk:             number;
  rev_baseline:     number;  // lifetime baseline €M
  gap_226:          number | null;  // revenue gap €M at RCP2.6 (null for EnviroTrust parks)
  gap_245:          number;  // revenue gap €M at RCP4.5
  gap_585:          number;  // revenue gap €M at RCP8.5
  price_label:      string;
  windExposure:     number;
  meanWindMs:       number;
}

const PARK_DATA: ChatPark[] = PARKS.map(p => {
  const s226 = p.scenarios['RCP2.6'];
  const s245 = p.scenarios['RCP4.5'];
  const s585 = p.scenarios['RCP8.5'];
  return {
    key:           p.id.toLowerCase(),
    name:          p.name,
    state:         p.state,
    capacity:      p.capacity_mwp,
    commissioned:  p.commissioned,
    gwh:           +(s245.lifetime_baseline_gwh / 30).toFixed(1),
    lifetime_gwh:  +s245.lifetime_baseline_gwh.toFixed(1),
    d226:          s226?.delta_pct ?? null,
    d245:          s245.delta_pct,
    d585:          s585.delta_pct,
    dT_245:        s245.dT_30yr_c,
    dT_585:        s585.dT_30yr_c,
    risk:          p.risk,
    rev_baseline:  s245.finance.lifetime_baseline_meur,
    gap_226:       s226?.finance.revenue_gap_meur ?? null,
    gap_245:       s245.finance.revenue_gap_meur,
    gap_585:       s585.finance.revenue_gap_meur,
    price_label:   s245.finance.price_assumption,
    windExposure:  p.windExposure,
    meanWindMs:    p.meanWindMs,
  };
});

const SUGGESTIONS = [
  'Which park has the highest heat risk?',
  'Show parks in Bavaria',
  'Compare Finsterwalde and Lauingen',
  'How does the model work?',
];

// ── Local NLU response engine (no API key required) ───────────────────────────

function fuzzyMatch(query: string, park: ChatPark): boolean {
  const q = query.toLowerCase();
  if (q.includes(park.name.toLowerCase())) return true;
  if (q.includes(park.key)) return true;
  // match any meaningful word (>4 chars) from the park name
  return park.name.toLowerCase().split(/[\s_-]+/).some(w => w.length > 4 && q.includes(w));
}

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

function sign(n: number): string {
  return n >= 0 ? `+${fmt(n)}` : fmt(n);
}

function parkCard(p: ChatPark): string {
  const riskLabel = p.risk >= 7 ? 'HIGH' : p.risk >= 4 ? 'MODERATE' : 'LOW';
  return (
    `**${p.name}** (${p.state})\n` +
    `Commissioned: ${p.commissioned} · Capacity: **${fmt(p.capacity)} MWp**\n` +
    `Annual baseline: **${fmt(p.gwh)} GWh/yr** · Lifetime: **${fmt(p.lifetime_gwh)} GWh**\n` +
    `Climate delta — RCP2.6: **${p.d226 !== null ? sign(p.d226) + '%' : 'N/A'}** · RCP4.5: **${sign(p.d245)}%** · RCP8.5: **${sign(p.d585)}%**\n` +
    `Revenue gap — RCP4.5: **€${fmt(p.gap_245, 1)}M** · RCP8.5: **€${fmt(p.gap_585, 1)}M**\n` +
    `Heat risk: **${fmt(p.risk, 1)}/10** (${riskLabel}) · Price: ${p.price_label}`
  );
}

function buildResponse(text: string): string {
  const q = text.toLowerCase();

  // ── Intent flags ────────────────────────────────────────────────────────────
  const wantsRevenue     = /revenue|gap|money|€|eur|financ|cash|profit|invest/.test(q);
  const wantsRisk        = /risk|heat|expos|vulnerab|danger|hot/.test(q);
  const wantsForecast    = /forecast|output|energy|gwh|generat|predict|lifetime|production/.test(q);
  const wantsList        = /list|all park|every park|show all|which park/.test(q);
  const wantsWorst       = /worst|most.*(risk|expos|danger)|highest risk|most vulnerable/.test(q);
  const wantsBest        = /best|safest|lowest risk|least expos|most stable/.test(q);
  const wantsCompare     = /compar|vs\.?|versus|against|better|worse|differ/.test(q);
  const wantsRCP85       = /rcp.?8\.?5|high.?emiss|worst.?case|pessimis/.test(q);
  const wantsRCP26       = /rcp.?2\.?6|low.?emiss|best.?case|optimis/.test(q);
  const wantsTemp        = /temper|warm|degree|celsius|°c|dt|delta.?t|heat.?rise|climate.?change/.test(q);
  const wantsCommission  = /commiss|built|install|year|when|age|old/.test(q);
  const wantsWind        = /wind|breeze|speed|m\/s|cool/.test(q);
  const wantsPortfolio   = /portfolio|total|all.*(cap|gwh|rev|value)|summar|overview|aggregate/.test(q);
  const wantsMethodology = /model|work|how|method|physics|noct|arrhenius|monte carlo|mc|cmip|rcp|scenario|delta method|explain|what is|what are|degrad|baseline|p50|p90|p10|uncertainty/.test(q);

  // ── State/region matching ─────────────────────────────────────────────────────
  const stateQuery = (/bavaria|bayern/.test(q) ? 'Bavaria'
    : /berlin/.test(q) ? 'Berlin'
    : /branden/.test(q) ? 'Brandenburg'
    : /saxony|sachsen/.test(q) ? 'Saxony'
    : /schleswig/.test(q) ? 'Schleswig-Holstein'
    : null);

  // ── Park matching ────────────────────────────────────────────────────────────
  const matched = PARK_DATA.filter(p => fuzzyMatch(q, p));

  // ── Greetings ────────────────────────────────────────────────────────────────
  if (/^(hi|hello|hey|hej|hallo|howdy|good\s*(morning|afternoon|evening))[\s!?.]*$/.test(q.trim())) {
    return (
      'Hello! I\'m the NviroAerox Park Assistant.\n\n' +
      'I have real pre-computed data for **10 German solar parks**. Try asking:\n' +
      '- *"Which park has the highest heat risk?"*\n' +
      '- *"Show parks in Bavaria"*\n' +
      '- *"Revenue gap for Finsterwalde"*\n' +
      '- *"Compare Weesow and Lauingen"*\n' +
      '- *"How does the model work?"*'
    );
  }

  // ── Methodology / explainers ──────────────────────────────────────────────────
  if (wantsMethodology && !matched.length && !stateQuery) {
    if (/what is.*(delta.?pct|delta_pct)|what does delta mean/.test(q)) {
      return (
        '**delta_pct** is the lifetime output difference between the climate-adjusted forecast and the flat-history industry standard.\n\n' +
        'A value of **−2.5%** means the park is expected to produce 2.5% less energy over 30 years than a lender using historical weather data would assume.\n\n' +
        'This gap comes from two physics effects:\n' +
        '1. **Thermal derating** — hotter ambient air → lower panel efficiency (NOCT model, −0.4%/°C)\n' +
        '2. **Arrhenius degradation** — hotter panels age faster, compounding over decades'
      );
    }
    if (/what is.*(risk.?score|risk score)|explain.*risk/.test(q)) {
      return (
        '**Risk score (0–10)** is a physics-derived heat-risk index combining:\n\n' +
        '1. **Thermal derating** — how much efficiency is lost as temperature rises (panel temp coefficient γ)\n' +
        '2. **Arrhenius degradation** — acceleration of panel aging at higher temperatures (doubles roughly every 10°C)\n\n' +
        'A score of **7–10** = HIGH risk · **4–6** = MODERATE · **0–3** = LOW\n\n' +
        'Higher scores indicate parks where warming will meaningfully cut into 30-year output relative to the industry baseline.'
      );
    }
    if (/what is rcp|explain rcp|what are.*(rcp|scenario)|rcp.?2\.?6|rcp.?4\.?5|rcp.?8\.?5/.test(q)) {
      return (
        '**RCP (Representative Concentration Pathway)** — IPCC emissions scenarios:\n\n' +
        '**RCP2.6** — Low emissions, strong mitigation. ~+0.5–1°C warming in Central Europe by 2050.\n' +
        '**RCP4.5** — Moderate emissions, partial mitigation. ~+1–1.5°C by 2050. Used as the base case.\n' +
        '**RCP8.5** — High emissions, business-as-usual. ~+2°C+ by 2050. Worst-case bound.\n\n' +
        'This tool runs each scenario as a separate branch — they are never averaged — so you can see the full spread of outcomes.'
      );
    }
    if (/noct|cell temp|t_cell|thermal derating/.test(q)) {
      return (
        '**NOCT (Nominal Operating Cell Temperature)** is the physics formula used to estimate panel temperature:\n\n' +
        '`T_cell = T_amb + (NOCT − 20) / 800 × GHI`\n\n' +
        'Then power output scales as:\n' +
        '`P = capacity × (GHI/1000) × (1 + γ × (T_cell − 25))`\n\n' +
        'where **γ ≈ −0.004 /°C** (power temperature coefficient).\n\n' +
        'As ambient temperature rises under climate projections, T_cell rises, and P falls. This is the core climate signal.'
      );
    }
    if (/arrhenius|degrad/.test(q)) {
      return (
        '**Arrhenius degradation** is how panel aging accelerates with heat.\n\n' +
        'Solar panels degrade ~0.5%/year at standard conditions, but the rate roughly doubles every 10°C (Arrhenius law). Over 30 years in a warming climate, this compounds into a meaningful extra loss on top of thermal derating.\n\n' +
        'This is the **differentiated story** of this model — most industry forecasts ignore temperature-driven aging.'
      );
    }
    if (/monte carlo|mc draws|uncertainty|p50|p90|p10|fan/.test(q)) {
      return (
        '**Monte Carlo uncertainty engine** — the model runs **3,000 draws** per scenario, sampling:\n\n' +
        '- **Climate model spread** — 7 CMIP6 models give a distribution of ΔT trajectories\n' +
        '- **Interannual weather variability** — different historical years sampled\n' +
        '- **Parameter uncertainty** — γ (temp coefficient), PR (performance ratio), degradation rate\n\n' +
        '**P50** = median outcome · **P10** = conservative (90% of draws exceed this) · **P90** = optimistic\n\n' +
        'The fan chart on the forecast screen shows the P10–P90 band so you can see the honest uncertainty, not just a single number.'
      );
    }
    if (/cmip|delta method|climate.*model|open.?meteo/.test(q)) {
      return (
        '**CMIP6 delta method** — how climate signals are sourced:\n\n' +
        '1. Historical weather (Open-Meteo / ERA5) builds the "typical year" baseline\n' +
        '2. 7 CMIP6 HighResMIP models provide annual ΔT trends (temperature change per year) for each park\'s grid cell\n' +
        '3. Each year, the typical year\'s temperature is shifted by ΔT and the physics is re-run\n\n' +
        'This is the **delta method** — robust and fast, avoids bias-correcting full climate fields. The ensemble spread becomes the `dT_model_std` uncertainty term.'
      );
    }
    // generic "how does model work"
    return (
      '**How the NviroAerox model works:**\n\n' +
      '1. **Physics core** — NOCT thermal model computes hourly panel temperature and power output from GHI + ambient temp\n' +
      '2. **Baseline** — ERA5 historical weather builds a "typical year", held flat (the industry standard method)\n' +
      '3. **Climate-adjusted** — each year, CMIP6 ΔT shifts the typical year\'s temperature; physics re-runs\n' +
      '4. **Uncertainty engine** — 3,000 Monte Carlo draws over climate model spread, interannual variability, and parameter uncertainty → P10/P50/P90 fan\n' +
      '5. **Arrhenius degradation** — temperature-accelerated panel aging compounds the gap over 30 years\n\n' +
      'Ask *"what is delta_pct"*, *"explain RCP scenarios"*, or *"what is NOCT"* for more detail.'
    );
  }

  // ── Portfolio overview ────────────────────────────────────────────────────────
  if (wantsPortfolio && !matched.length) {
    const totalCap   = PARK_DATA.reduce((s, p) => s + p.capacity, 0);
    const totalGwh   = PARK_DATA.reduce((s, p) => s + p.lifetime_gwh, 0);
    const totalRev   = PARK_DATA.reduce((s, p) => s + p.rev_baseline, 0);
    const totalGap85 = PARK_DATA.reduce((s, p) => s + p.gap_585, 0);
    const avgRisk    = PARK_DATA.reduce((s, p) => s + p.risk, 0) / PARK_DATA.length;
    return (
      '**Portfolio summary — all 10 parks**\n\n' +
      `Total installed capacity: **${fmt(totalCap)} MWp**\n` +
      `Total 30-year baseline output: **${fmt(totalGwh / 1000, 2)} TWh**\n` +
      `Total 30-year baseline revenue: **€${fmt(totalRev, 0)}M**\n` +
      `Total revenue gap (RCP8.5): **€${fmt(totalGap85, 0)}M**\n` +
      `Average heat risk score: **${fmt(avgRisk, 1)}/10**\n\n` +
      `States covered: Brandenburg (4), Bavaria (3), Saxony-Anhalt (1), Schleswig-Holstein (1), Brandenburg/Saxony (1)`
    );
  }

  // ── State/region filter ───────────────────────────────────────────────────────
  if (stateQuery && !matched.length) {
    const inState = PARK_DATA.filter(p => p.state.toLowerCase().includes(stateQuery.toLowerCase()));
    if (!inState.length) return `No parks found in ${stateQuery} in this dataset.`;
    const rows = inState.map(p =>
      `**${p.name}** — ${fmt(p.capacity)} MWp, risk ${fmt(p.risk, 1)}/10, RCP8.5 gap €${fmt(p.gap_585, 1)}M`
    );
    return `**Parks in ${stateQuery}** (${inState.length} found):\n\n${rows.join('\n')}`;
  }

  // ── List all parks ────────────────────────────────────────────────────────────
  if (wantsList) {
    const lines = PARK_DATA.map((p, i) =>
      `${i + 1}. **${p.name}** — ${p.state}, ${fmt(p.capacity)} MWp, risk ${fmt(p.risk, 1)}/10`
    );
    return `Here are all **${PARK_DATA.length} German solar parks** in the dataset:\n\n${lines.join('\n')}`;
  }

  // ── Rankings ─────────────────────────────────────────────────────────────────
  if (wantsWorst && !matched.length) {
    const sorted = [...PARK_DATA].sort((a, b) => b.risk - a.risk);
    const rows = sorted.slice(0, 5).map((p, i) =>
      `${i + 1}. **${p.name}** — risk **${fmt(p.risk, 1)}/10**, RCP8.5 gap **€${fmt(p.gap_585, 1)}M** (${sign(p.d585)}%)`
    );
    return `**Most heat-exposed parks** (by physics risk score):\n\n${rows.join('\n')}\n\nRisk combines thermal derating and Arrhenius accelerated degradation over 30 years.`;
  }

  if (wantsBest && !matched.length) {
    const sorted = [...PARK_DATA].sort((a, b) => a.risk - b.risk);
    const rows = sorted.slice(0, 5).map((p, i) =>
      `${i + 1}. **${p.name}** — risk **${fmt(p.risk, 1)}/10**, RCP8.5 gap **€${fmt(p.gap_585, 1)}M** (${sign(p.d585)}%)`
    );
    return `**Least heat-exposed parks** (lowest risk score):\n\n${rows.join('\n')}`;
  }

  if (/largest|biggest|most capacity|highest capacity/.test(q) && !matched.length) {
    const sorted = [...PARK_DATA].sort((a, b) => b.capacity - a.capacity);
    const rows = sorted.slice(0, 5).map((p, i) =>
      `${i + 1}. **${p.name}** — **${fmt(p.capacity)} MWp** (${p.state})`
    );
    return `**Largest parks by installed capacity:**\n\n${rows.join('\n')}`;
  }

  if (/largest.*gap|biggest.*gap|most.*revenue.*loss|highest.*gap/.test(q) && !matched.length) {
    const sorted = [...PARK_DATA].sort((a, b) => a.gap_585 - b.gap_585);
    const rows = sorted.slice(0, 5).map((p, i) =>
      `${i + 1}. **${p.name}** — RCP8.5 gap **€${fmt(p.gap_585, 1)}M** (${sign(p.d585)}%)`
    );
    return `**Parks with the largest 30-year revenue gap** under RCP8.5:\n\n${rows.join('\n')}`;
  }

  if (/most.*warm|highest.*temp|hottest/.test(q) && !matched.length) {
    const sorted = [...PARK_DATA].sort((a, b) => b.dT_585 - a.dT_585);
    const rows = sorted.slice(0, 5).map((p, i) =>
      `${i + 1}. **${p.name}** — +**${fmt(p.dT_585, 2)}°C** by 2054 (RCP8.5)`
    );
    return `**Parks expecting the most warming** by year 30 under RCP8.5:\n\n${rows.join('\n')}`;
  }

  // ── Two-park comparison ────────────────────────────────────────────────────────
  if (wantsCompare && matched.length >= 2) {
    const [a, b] = matched.slice(0, 2);
    return (
      `**Comparison: ${a.name} vs ${b.name}**\n\n` +
      `Capacity:    ${fmt(a.capacity)} MWp  ↔  ${fmt(b.capacity)} MWp\n` +
      `Annual GWh:  ${fmt(a.gwh)}  ↔  ${fmt(b.gwh)}\n` +
      `Risk score:  **${fmt(a.risk, 1)}/10**  ↔  **${fmt(b.risk, 1)}/10**\n` +
      `Warming 8.5: +${fmt(a.dT_585, 2)}°C  ↔  +${fmt(b.dT_585, 2)}°C\n` +
      `RCP4.5 Δ:    ${sign(a.d245)}%  ↔  ${sign(b.d245)}%\n` +
      `RCP8.5 Δ:    **${sign(a.d585)}%**  ↔  **${sign(b.d585)}%**\n` +
      `Rev gap 8.5: €${fmt(a.gap_585, 1)}M  ↔  €${fmt(b.gap_585, 1)}M\n\n` +
      (a.risk > b.risk
        ? `**${a.name}** carries higher climate heat risk.`
        : a.risk < b.risk
          ? `**${b.name}** carries higher climate heat risk.`
          : `Both parks have identical risk scores.`)
    );
  }

  // ── Single park response ──────────────────────────────────────────────────────
  if (matched.length === 1) {
    const p = matched[0];

    if (wantsCommission) {
      return (
        `**${p.name}** was commissioned in **${p.commissioned}**, making it **${new Date().getFullYear() - p.commissioned} years old**.\n\n` +
        `Location: ${p.state} · Capacity: ${fmt(p.capacity)} MWp\n` +
        `Older parks may have higher baseline degradation already baked in.`
      );
    }

    if (wantsTemp) {
      return (
        `**Temperature rise — ${p.name}**\n\n` +
        `Expected warming at this site by year 30:\n` +
        `RCP4.5 (moderate): **+${fmt(p.dT_245, 2)}°C**\n` +
        `RCP8.5 (high):     **+${fmt(p.dT_585, 2)}°C**\n\n` +
        `From CMIP6 7-model HighResMIP ensemble (delta method). Each degree of warming translates to:\n` +
        `- ~0.4% annual efficiency loss (thermal derating)\n` +
        `- Accelerated Arrhenius panel degradation compounding over 30 years`
      );
    }

    if (wantsWind) {
      return (
        `**Wind data — ${p.name}**\n\n` +
        `Mean wind speed (ERA5): **${fmt(p.meanWindMs, 2)} m/s**\n` +
        `Wind exposure fraction: **${fmt(p.windExposure * 100, 1)}%** of open-field wind\n\n` +
        `Wind cools panels slightly (convective heat loss), partially offsetting thermal derating. This is captured in the Faiman model variant.`
      );
    }

    if (wantsRevenue) {
      return (
        `**Revenue outlook — ${p.name}**\n\n` +
        `30-year baseline (industry standard): **€${fmt(p.rev_baseline, 1)}M**\n` +
        `Price assumption: ${p.price_label}\n\n` +
        `Climate-adjusted revenue gap:\n` +
        `RCP2.6: **${p.gap_226 !== null ? '€' + fmt(p.gap_226, 1) + 'M (' + sign(p.d226!) + '%)' : 'N/A'}**\n` +
        `RCP4.5: **€${fmt(p.gap_245, 1)}M** (${sign(p.d245)}%)\n` +
        `RCP8.5: **€${fmt(p.gap_585, 1)}M** (${sign(p.d585)}%)\n\n` +
        `This is the gap a lender using a flat-history method would fail to price in.`
      );
    }

    if (wantsRisk) {
      const riskLabel = p.risk >= 7 ? 'HIGH' : p.risk >= 4 ? 'MODERATE' : 'LOW';
      return (
        `**Heat risk — ${p.name}**\n\n` +
        `Risk score: **${fmt(p.risk, 1)}/10** (${riskLabel})\n` +
        `Expected warming (RCP8.5): **+${fmt(p.dT_585, 2)}°C** by year 30\n\n` +
        `RCP4.5 lifetime delta: **${sign(p.d245)}%**\n` +
        `RCP8.5 lifetime delta: **${sign(p.d585)}%**\n\n` +
        `Risk is physics-derived: thermal derating (NOCT model) plus Arrhenius accelerated panel degradation over 30 years.`
      );
    }

    if (wantsForecast || wantsRCP85 || wantsRCP26) {
      return (
        `**30-year forecast — ${p.name}**\n\n` +
        `Capacity: ${fmt(p.capacity)} MWp · State: ${p.state}\n` +
        `Annual baseline: **${fmt(p.gwh)} GWh/yr** · Lifetime baseline: **${fmt(p.lifetime_gwh)} GWh**\n\n` +
        `Climate-adjusted lifetime delta (vs. industry standard):\n` +
        `RCP2.6 (low emissions):  **${p.d226 !== null ? sign(p.d226) + '%' : 'N/A'}**\n` +
        `RCP4.5 (moderate):       **${sign(p.d245)}%**\n` +
        `RCP8.5 (high emissions): **${sign(p.d585)}%**\n\n` +
        `The gap is driven by rising ambient temperature → lower panel efficiency + accelerated Arrhenius degradation.`
      );
    }

    // default: full card
    return parkCard(p);
  }

  // ── Multiple park results ────────────────────────────────────────────────────
  if (matched.length > 1) {
    const rows = matched.map(p =>
      `**${p.name}** (${p.state}) — risk ${fmt(p.risk, 1)}/10, RCP8.5: ${sign(p.d585)}%, gap €${fmt(p.gap_585, 1)}M`
    );
    return `Found **${matched.length} parks** matching your query:\n\n${rows.join('\n')}\n\nAsk about a specific one for full details.`;
  }

  // ── No match fallback ────────────────────────────────────────────────────────
  return (
    'I\'m not sure what you\'re looking for. Here are some things I can answer:\n\n' +
    '**Park data:** *"Tell me about Finsterwalde"* · *"Revenue gap for Lauingen"*\n' +
    '**Rankings:** *"Which park has the highest heat risk?"* · *"Largest parks"*\n' +
    '**Region:** *"Show parks in Bavaria"* · *"Brandenburg parks"*\n' +
    '**Compare:** *"Compare Weesow and Eggebek"*\n' +
    '**Portfolio:** *"Portfolio summary"* · *"Total capacity"*\n' +
    '**Explain:** *"How does the model work?"* · *"What is RCP8.5?"* · *"What is delta_pct?"*'
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000)       return 'just now';
  if (d < 3_600_000)    return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000)   return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

function makeId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function makeTitle(text: string) {
  return text.length > 32 ? text.slice(0, 32) + '…' : text;
}

// ── Bot text renderer (simple **bold** + newlines) ────────────────────────────

function BotText({ text }: { text: string }) {
  return (
    <div className="bot-text">
      {text.split('\n').map((line, i) => {
        if (line === '') return <div key={i} className="bot-spacer" />;
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <p key={i} className="bot-line">
            {parts.map((part, j) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={j}>{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        );
      })}
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

export function BotIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="13" rx="2.5" />
      <path d="M8 8V6.5a4 4 0 0 1 8 0V8" />
      <circle cx="9" cy="14.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14.5" r="1.5" fill="currentColor" stroke="none" />
      <path d="M9.5 18h5" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
  );
}

function ComposeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

// ── Chat list view ────────────────────────────────────────────────────────────

interface ChatListProps {
  chats: Chat[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

function ChatList({ chats, onOpen, onNew, onClose }: ChatListProps) {
  return (
    <>
      <div className="chatbot-header">
        <div className="chatbot-header-left">
          <span className="chatbot-avatar"><BotIcon size={18} /></span>
          <div>
            <div className="chatbot-title">Park Assistant</div>
            <div className="chatbot-subtitle">Powered by real park data</div>
          </div>
        </div>
        <div className="chatbot-header-actions">
          <button className="chatbot-icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="chat-list-body">
        {chats.length === 0 ? (
          <div className="chat-list-empty">
            <div className="welcome-icon"><BotIcon size={28} /></div>
            <p className="welcome-title">No conversations yet</p>
            <p className="welcome-body">Ask me about any of the {PARK_DATA.length} German solar parks — forecasts, heat risk, revenue gaps.</p>
            <button className="btn-new-chat" onClick={onNew}>Start a conversation</button>
          </div>
        ) : (
          <>
            <div className="chat-list-toolbar">
              <span className="chat-list-count">{chats.length} conversation{chats.length !== 1 ? 's' : ''}</span>
              <button className="btn-new-chat-sm" onClick={onNew}>
                <ComposeIcon /> New chat
              </button>
            </div>
            <ul className="chat-list">
              {chats.map(chat => {
                const lastMsg = chat.messages[chat.messages.length - 1];
                const preview = lastMsg
                  ? (lastMsg.text.length > 48 ? lastMsg.text.slice(0, 48) + '…' : lastMsg.text)
                  : 'No messages yet';
                return (
                  <li key={chat.id}>
                    <button className="chat-list-item" onClick={() => onOpen(chat.id)}>
                      <span className="cli-avatar"><BotIcon size={14} /></span>
                      <span className="cli-body">
                        <span className="cli-title">{chat.title}</span>
                        <span className="cli-preview">{preview}</span>
                      </span>
                      <span className="cli-time">{relTime(chat.updatedAt)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

// ── Chat detail view ──────────────────────────────────────────────────────────

interface ChatDetailProps {
  chat: Chat;
  onBack: () => void;
  onClose: () => void;
  onSend: (text: string) => void;
  typing: boolean;
}

function ChatDetail({ chat, onBack, onClose, onSend, typing }: ChatDetailProps) {
  const [input, setInput] = useState('');
  const bottomRef         = useRef<HTMLDivElement>(null);
  const inputRef          = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [chat.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.messages, typing]);

  function submit(text: string) {
    const t = text.trim();
    if (!t || typing) return;
    setInput('');
    onSend(t);
  }

  const isEmpty = chat.messages.length === 0;

  return (
    <>
      <div className="chatbot-header">
        <div className="chatbot-header-left">
          <button className="chatbot-icon-btn" onClick={onBack} aria-label="Back to chats">
            <BackIcon />
          </button>
          <span className="chatbot-title chat-detail-title" title={chat.title}>{chat.title}</span>
        </div>
        <button className="chatbot-icon-btn" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </div>

      <div className="chatbot-messages">
        {isEmpty && (
          <div className="chatbot-welcome">
            <div className="welcome-icon"><BotIcon size={28} /></div>
            <p className="welcome-title">Ask me about any park</p>
            <p className="welcome-body">Forecasts, heat risk scores, revenue gaps — for all {PARK_DATA.length} solar parks.</p>
            <div className="suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s} className="suggestion-chip" onClick={() => submit(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {chat.messages.map((m, i) => (
          <div key={i} className={`msg-row ${m.role}`}>
            {m.role === 'bot' && <span className="msg-avatar"><BotIcon size={14} /></span>}
            <div className="msg-bubble">
              {m.role === 'bot' ? <BotText text={m.text} /> : m.text}
            </div>
          </div>
        ))}

        {typing && (
          <div className="msg-row bot">
            <span className="msg-avatar"><BotIcon size={14} /></span>
            <div className="msg-bubble typing-indicator">
              <span /><span /><span />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="chatbot-input-row">
        <input
          ref={inputRef}
          className="chatbot-input"
          placeholder="Ask about a park…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input); } }}
        />
        <button
          className="chatbot-send"
          onClick={() => submit(input)}
          disabled={!input.trim() || typing}
          aria-label="Send"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
    </>
  );
}

// ── Root ChatBot component ────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ChatBot({ open, onClose }: Props) {
  const [chats,         setChats]         = useState<Chat[]>([]);
  const [activeChatId,  setActiveChatId]  = useState<string | null>(null);
  const [view,          setView]          = useState<'list' | 'chat'>('list');
  const [typing,        setTyping]        = useState(false);

  // When opening with no chats, jump straight into a new chat
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (open && !didAutoOpen.current && chats.length === 0) {
      didAutoOpen.current = true;
      startNewChat();
    }
    if (!open) didAutoOpen.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const startNewChat = useCallback(() => {
    const chat: Chat = {
      id:        makeId(),
      title:     'New conversation',
      messages:  [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setChats(prev => [chat, ...prev]);
    setActiveChatId(chat.id);
    setView('chat');
  }, []);

  function openChat(id: string) {
    setActiveChatId(id);
    setView('chat');
  }

  function goBack() {
    // Drop empty chats when leaving them
    setChats(prev => prev.filter(c => c.messages.length > 0));
    setActiveChatId(null);
    setView('list');
  }

  function handleClose() {
    // Drop empty chats on close too
    setChats(prev => prev.filter(c => c.messages.length > 0));
    onClose();
  }

  function send(text: string) {
    if (!activeChatId || typing) return;
    const id = activeChatId;

    setChats(prev => prev.map(c => {
      if (c.id !== id) return c;
      const isFirst = c.messages.length === 0;
      return {
        ...c,
        title:    isFirst ? makeTitle(text) : c.title,
        messages: [...c.messages, { role: 'user' as const, text }],
        updatedAt: Date.now(),
      };
    }));

    setTyping(true);

    // Short delay so the typing indicator is visible
    setTimeout(() => {
      const reply = buildResponse(text);
      setChats(prev => prev.map(c => {
        if (c.id !== id) return c;
        return {
          ...c,
          messages:  [...c.messages, { role: 'bot' as const, text: reply }],
          updatedAt: Date.now(),
        };
      }));
      setTyping(false);
    }, 400);
  }

  const activeChat = activeChatId ? chats.find(c => c.id === activeChatId) ?? null : null;

  return (
    <>
      {open && <div className="chatbot-backdrop" onClick={handleClose} />}
      <div className={`chatbot-panel${open ? ' open' : ''}`}>
        {view === 'list' || !activeChat ? (
          <ChatList
            chats={chats}
            onOpen={openChat}
            onNew={startNewChat}
            onClose={handleClose}
          />
        ) : (
          <ChatDetail
            chat={activeChat}
            onBack={goBack}
            onClose={handleClose}
            onSend={send}
            typing={typing}
          />
        )}
      </div>
    </>
  );
}
