import { Link } from 'react-router-dom';
import './Home.css';

const FEATURES = [
  {
    label: 'Real park data',
    desc: 'Specs and coordinates sourced from Marktstammdatenregister — no invented inputs.',
  },
  {
    label: 'Copernicus projections',
    desc: 'Forward-looking CMIP6 temperature trajectories, not a replay of historical weather.',
  },
  {
    label: 'Physics core',
    desc: 'Closed-form NOCT model with thermal derating. Explainable, not a black box.',
  },
  {
    label: 'Honest uncertainty',
    desc: 'Monte Carlo over scenarios, weather variability, and parameters — P50/P90 bands.',
  },
];

const USE_CASES = [
  {
    title: 'Revaluing a park',
    body: 'Climate has shifted since your forecast was set. What is the rest of its life really worth now?',
  },
  {
    title: 'Due diligence',
    body: 'The seller assumes a stable climate. What does the number look like without that assumption?',
  },
  {
    title: 'Pricing insurance',
    body: 'Which parks carry heat exposure that the historical record doesn\'t capture?',
  },
  {
    title: 'Operations planning',
    body: 'How does output drift year to year? When does repowering pay for itself?',
  },
];

export function Home() {
  return (
    <div className="home">
      <section className="hero">
        <div className="hero-eyebrow">
          <span className="eyebrow-tag">EnviroTrust Challenge 2026</span>
          <span className="eyebrow-sep" />
          <span className="eyebrow-sub">Power, Seen From Orbit</span>
        </div>
        <h1 className="hero-title">
          30-year solar output,<br />
          <span className="hero-accent">climate-adjusted</span>
        </h1>
        <p className="hero-body">
          The industry estimates a park's lifetime output from a "typical year" built on past
          weather — then holds it flat. Climate is shifting. We re-run the physics under
          Copernicus temperature projections and show you the gap, with an honest uncertainty band.
        </p>
        <div className="hero-actions">
          <Link to="/analyze" className="btn btn-primary">Analyze a Park</Link>
          <span className="hero-note">20 real German parks · no signup required</span>
        </div>
      </section>

      <section className="features-section">
        <div className="section-label">How it works</div>
        <h2 className="section-title">Forecast-vs-forecast, not forecast-vs-actuals</h2>
        <p className="section-body">
          Per-park generation is not public in Germany. We compare two forecasts: the standard
          history-based method versus the same physics re-run under climate projections.
          The gap is the climate-adjustment signal.
        </p>
        <div className="features-grid">
          {FEATURES.map((f) => (
            <div key={f.label} className="feature-card">
              <div className="feature-dot" />
              <h3 className="feature-title">{f.label}</h3>
              <p className="feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="use-cases-section">
        <div className="section-label">Use cases</div>
        <h2 className="section-title">Built for lenders, insurers, and owners</h2>
        <div className="use-cases-grid">
          {USE_CASES.map((uc, i) => (
            <div key={i} className="use-case-card">
              <span className="use-case-num">0{i + 1}</span>
              <h3 className="use-case-title">{uc.title}</h3>
              <p className="use-case-body">{uc.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="cta-section">
        <div className="cta-inner">
          <h2>Start with a real park</h2>
          <p>Select from 20 operating German solar and wind parks. Results in seconds.</p>
          <Link to="/analyze" className="btn btn-primary">Open the map</Link>
        </div>
      </section>
    </div>
  );
}
