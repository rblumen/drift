// src/ui/LandingPage.tsx — full marketing / home screen
// Rendered by App when showLanding=true (before the tab shell).
// onEnter  — user clicked "Enter the app" — dismisses landing
// onDemo   — user clicked "Try the demo"  — loads sample + dismisses
import { DriftWordmark } from './Logo';
import './LandingPage.css';

// ── Demo allocation data (static) ────────────────────────────────────────────
const ALLOC: [string, number, number][] = [
  ['US equity',     44, 40],
  ['International', 16, 20],
  ['Fixed income',  24, 26],
  ['Emerging',       9,  9],
  ['Alternatives',   7,  5],
];
const CLS = ['#082855', '#0d3e7a', '#1a5fa0', '#2e72b4', '#e8600a'];

// ── Donut chart ───────────────────────────────────────────────────────────────
function AllocDonut() {
  const R = 56, SW = 16, C = 2 * Math.PI * R, cx = 72, cy = 72;
  let acc = 0;
  const segs = ALLOC.map(([, pct], i) => {
    const frac = pct / 100;
    const len = frac * C;
    const offset = -acc * C;
    acc += frac;
    return (
      <circle key={i} cx={cx} cy={cy} r={R} fill="none"
        stroke={CLS[i]} strokeWidth={SW}
        strokeDasharray={`${len} ${C - len}`}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cy})`} />
    );
  });
  return (
    <svg width="144" height="144" viewBox="0 0 144 144" style={{ flex: 'none' }}>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#f4f6f9" strokeWidth={SW} />
      {segs}
      <text x={cx} y="67" textAnchor="middle"
        fontFamily="'IBM Plex Mono',monospace" fontSize="9" fill="#9aa3b0" letterSpacing="1.5">
        DRIFT
      </text>
      <text x={cx} y="83" textAnchor="middle"
        fontFamily="'Schibsted Grotesk',system-ui,sans-serif" fontWeight="600" fontSize="16" fill="#2a3441">
        2.4%
      </text>
    </svg>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
export interface LandingPageProps {
  onEnter: () => void;
  onDemo?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function LandingPage({ onEnter, onDemo }: LandingPageProps) {
  return (
    <div className="lp-root">

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <nav className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <DriftWordmark height={30} />
          <div className="lp-nav-links">
            <a href="#why">Why Drift</a>
            <a href="#how">How it works</a>
            <a href="#transparency">Transparency</a>
            <button className="lp-btn lp-btn-primary" onClick={onEnter}>
              Enter the app →
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <header className="lp-hero">
        <div className="lp-wrap lp-hero-grid">
          <div>
            <p className="lp-eyebrow">Household portfolio rebalancing</p>
            <h1 className="lp-h1">
              Portfolios drift.<br />
              <span className="lp-accent">Drift</span> puts yours<br />
              back on course.
            </h1>
            <p className="lp-lede">
              A precise rebalancing calculator for people who manage their own money across every
              account — taxable, IRA, 401(k), HSA. Set a target, import your positions, and get
              exact buy/sell orders for the whole household.
            </p>
            <div className="lp-cta-row">
              <button className="lp-btn lp-btn-primary" onClick={onEnter}>Enter the app →</button>
              {onDemo && (
                <button className="lp-btn lp-btn-ghost" onClick={onDemo}>
                  Try the demo
                </button>
              )}
              <a className="lp-btn lp-btn-ghost" href="https://ko-fi.com/driftrebalance" target="_blank" rel="noopener noreferrer">
                ☕ Support on Ko-fi
              </a>
            </div>
            <div className="lp-micro">
              <span><span className="lp-dot"></span>Free · runs in your browser</span>
              <span><span className="lp-dot" style={{ background: '#082855' }}></span>No account · no cookies · no personal data</span>
            </div>
          </div>

          {/* Allocation card */}
          <div className="lp-panel" aria-label="Sample household allocation">
            <div className="lp-panel-top">
              <span className="lp-ttl">Household allocation</span>
              <span className="lp-val">$847,250</span>
            </div>
            <div className="lp-panel-body">
              <div className="lp-donut-wrap">
                <AllocDonut />
                <div className="lp-legend">
                  {ALLOC.map(([label, cur, tgt], i) => {
                    const diff = Math.abs(cur - tgt);
                    const off  = diff >= 2;
                    return (
                      <div className={`lp-legend-item${off ? ' lp-off' : ''}`} key={i}>
                        <span className="lp-sw" style={{ background: CLS[i] }}></span>
                        {label}
                        <span className="lp-pc">
                          {off ? (cur > tgt ? '+' : '−') + diff + '%' : cur + '%'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="lp-donut-foot">
                <span>Drift from target</span>
                <span><strong>2.4%</strong> · 4 classes out of band</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── The gap ────────────────────────────────────────────────────────── */}
      <section className="lp-section" id="why">
        <div className="lp-wrap">
          <p className="lp-eyebrow">The gap</p>
          <h2 className="lp-h2" style={{ maxWidth: '18em' }}>
            Your aggregator shows you the drift.<br />It never tells you the trades.
          </h2>
          <p className="lp-sub">
            Aggregators are great at the picture. None of them will look
            across your accounts and say <em>sell this here, buy that there.</em> That last
            mile is where Drift lives.
          </p>
          <div className="lp-feat">
            <div className="lp-card">
              <div className="lp-card-ic">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M9 2L16 8H2L9 2Z" stroke="#0d3e7a" strokeWidth="1.5" strokeLinejoin="round" />
                  <rect x="3.5" y="8" width="11" height="8" rx="0.5" stroke="#0d3e7a" strokeWidth="1.5" strokeLinejoin="round" />
                  <rect x="7" y="11.5" width="4" height="4.5" rx="0.3" fill="#0d3e7a" opacity="0.3" />
                </svg>
              </div>
              <h3>Household-level, not account-by-account</h3>
              <p>Targets apply to everything combined. Drift decides which account each dollar belongs in — so your bonds land in taxable munis and growth compounds tax-deferred.</p>
            </div>
            <div className="lp-card">
              <div className="lp-card-ic">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <line x1="3.5" y1="6.5" x2="14.5" y2="6.5" stroke="#2e72b4" strokeWidth="1.6" strokeLinecap="round" />
                  <line x1="9" y1="5" x2="9" y2="15" stroke="#2e72b4" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="7" y1="15" x2="11" y2="15" stroke="#2e72b4" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M2 8.5 Q3.5 11.5 5 8.5" fill="#2e72b4" fillOpacity="0.18" stroke="#2e72b4" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M13 8.5 Q14.5 11.5 16 8.5" fill="#2e72b4" fillOpacity="0.18" stroke="#2e72b4" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </div>
              <h3>Tax-aware placement</h3>
              <p>It avoids taxable sells, redirects gains to sheltered accounts via a 4-way swap, and flags anything that could trigger a capital gain before you execute.</p>
            </div>
            <div className="lp-card">
              <div className="lp-card-ic">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <line x1="9" y1="2" x2="9" y2="16" stroke="#0d3e7a" strokeWidth="3" strokeLinecap="round" opacity="0.15" />
                  <line x1="6" y1="2.5" x2="12" y2="2.5" stroke="#0d3e7a" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="6" y1="15.5" x2="12" y2="15.5" stroke="#0d3e7a" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="2.5" y1="9" x2="15.5" y2="9" stroke="#0d3e7a" strokeWidth="1.3" strokeLinecap="round" />
                  <circle cx="9" cy="9" r="2.2" fill="#0d3e7a" />
                </svg>
              </div>
              <h3>Bogleheads 5/25 bands</h3>
              <p>Classes inside their tolerance band are left alone — no churn, no dust trades. You only see the trades that actually move you back toward plan.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <section className="lp-tinted" id="how">
        <div className="lp-wrap">
          <p className="lp-eyebrow">Five steps · about ten minutes</p>
          <h2 className="lp-h2" style={{ marginTop: 14 }}>From broker export to order list.</h2>
          <div className="lp-steps-grid">
            {([
              ['01', 'Add accounts',    "Name each account and its tax type. That's what tells Drift where things should live."],
              ['02', 'Import positions','Drop a CSV from Schwab, Fidelity, or your broker — or type a few holdings by hand.'],
              ['03', 'Classify',        "Tag any tickers Drift doesn't recognize so every position counts toward the right asset class."],
              ['04', 'Set the target',  'Adjust the allocation and placement rules. Sensible defaults are already loaded.'],
              ['05', 'Get the trades',  'Per-account buys and sells, recalculating live as you tweak anything.'],
            ] as const).map(([n, title, body]) => (
              <div className="lp-how-step" key={n}>
                <div className="lp-how-n">{n}</div>
                <h4>{title}</h4>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Transparency ───────────────────────────────────────────────────── */}
      <section className="lp-section" id="transparency">
        <div className="lp-wrap lp-split">
          <div>
            <p className="lp-eyebrow">Show your work</p>
            <h2 className="lp-h2" style={{ marginTop: 14 }}>
              Every trade comes<br />with its reasoning.
            </h2>
            <p className="lp-sub">
              No score, no "trust us." Drift ranks asset classes by how constrained their
              placement is, fills tax-preferred buckets first, and spills only when it has
              to — and it tells you each time it does.
            </p>
            <button className="lp-btn lp-btn-ghost" onClick={onEnter} style={{ marginTop: 22 }}>
              See it in action →
            </button>
          </div>
          <div className="lp-reason">
            <div className="lp-reason-h">// why this trade</div>
            <div>Class <strong>FIXED_INCOME</strong> · most-constrained (1 eligible bucket)</div>
            <div>→ placed <span className="lp-bl">first</span>, preferred bucket = <strong>Taxable</strong> (munis)</div>
            <hr className="lp-reason-hr" />
            <div>Sell <strong>VTI</strong> in <strong>Taxable</strong> would realize gain</div>
            <div>→ <span className="lp-g">redirected</span> via 4-way swap to <strong>Roth IRA</strong></div>
            <hr className="lp-reason-hr" />
            <div>Class <strong>US_LARGE_CAP</strong> drift <span className="lp-a">−4.0%</span> &gt; band ±5/25</div>
            <div>→ trade generated. <strong>EMERGING</strong> within band → <span className="lp-g">skipped</span></div>
          </div>
        </div>
      </section>

      {/* ── Broker compatibility ────────────────────────────────────────────── */}
      <section className="lp-tinted">
        <div className="lp-wrap">
          <p className="lp-eyebrow">Bring data in your way</p>
          <h2 className="lp-h2" style={{ marginTop: 14, fontSize: 28 }}>
            Works with the exports you already have.
          </h2>
          <div className="lp-works">
            {['Schwab CSV', 'Fidelity CSV', 'Manual entry'].map(p => (
              <span className="lp-pill" key={p}>{p}</span>
            ))}
            <span className="lp-pill" style={{ opacity: .5 }}>CSV-first, by design</span>
          </div>
        </div>
      </section>

      {/* ── Trust strip ── */}
      <div className="lp-trust-strip">
        <div className="lp-wrap">
          <div className="lp-trust-items">
            <span className="lp-trust-item">Runs entirely in your browser</span>
            <span className="lp-trust-sep"></span>
            <span className="lp-trust-item">No account required</span>
            <span className="lp-trust-sep"></span>
            <span className="lp-trust-item">No cookies · no personal data</span>
          </div>
        </div>
      </div>

      {/* ── Finale ─────────────────────────────────────────────────────────── */}
      <section className="lp-section">
        <div className="lp-wrap">
          <div className="lp-finale">
            <p className="lp-eyebrow" style={{ color: 'rgba(255,255,255,.5)' }}>
              Free · no account · no cookies · no personal data
            </p>
            <h2 className="lp-h2" style={{ color: '#fff', marginTop: 14 }}>
              Stop eyeballing your allocation.
            </h2>
            <p className="lp-sub" style={{ color: 'rgba(255,255,255,.68)', margin: '14px auto 0' }}>
              Import a portfolio and see the exact trades in the time it takes to read this page.
            </p>
            <div className="lp-cta-row lp-cta-center">
              <button className="lp-btn lp-btn-light" onClick={onEnter}>Enter the app →</button>
              {onDemo && (
                <button className="lp-btn lp-btn-wire" onClick={onDemo}>Try the demo</button>
              )}
              <a className="lp-btn lp-btn-wire" href="https://ko-fi.com/driftrebalance" target="_blank" rel="noopener noreferrer">
                ☕ Support on Ko-fi
              </a>
            </div>
            <div className="lp-rings">
              {CLS.map((c, i) => <i key={i} style={{ background: c }}></i>)}
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-wrap lp-foot">
          <DriftWordmark height={22} />
          <span className="lp-foot-note">Not investment advice · A mechanical calculator over your own inputs.</span>
        </div>
      </footer>

    </div>
  );
}
