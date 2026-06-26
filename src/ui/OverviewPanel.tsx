import { PaddleMark } from './Logo';

interface Props {
  /** Navigates to the Accounts tab. */
  onStart: () => void;
  /** Opens the "How it works" reference drawer. */
  onOpenHowItWorks: () => void;
}

const STEPS: { n: string; name: string; desc: string; payoff?: boolean }[] = [
  { n: '1', name: 'Accounts', desc: 'Name each account and its tax type.' },
  { n: '2', name: 'Import',   desc: 'Upload a broker CSV or enter holdings.' },
  { n: '3', name: 'Classify', desc: "Tag any tickers we don't recognize." },
  { n: '4', name: 'Strategy', desc: 'Set target weights and placement rules.' },
  { n: '5', name: 'Results',  desc: 'Get per-account buy/sell orders.', payoff: true },
];

const Arrow = () => (
  <svg
    className="hidden md:block absolute -right-[11px] top-[30px] w-[18px] h-[18px] text-gray-200 z-[2]"
    viewBox="0 0 18 18" fill="none"
  >
    <path d="M3 9h11M10 5l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function OverviewPanel({ onStart, onOpenHowItWorks }: Props) {
  return (
    <div className="py-2">

      {/* Hero */}
      <div className="flex gap-4 items-start max-w-3xl">
        <div className="mt-1 shrink-0">
          <PaddleMark size={54} />
        </div>
        <div>
          <div className="font-mono text-[11px] tracking-[0.16em] uppercase text-gray-400">Welcome</div>
          <h1 className="text-4xl font-semibold tracking-tight leading-[1.08] text-gray-900 mt-1">
            Let it drift.<br />Bring it <span className="text-indigo-600">back to plan.</span>
          </h1>
          <p className="text-[17px] leading-relaxed text-gray-600 mt-3.5 max-w-2xl">
            Drift is a household-level rebalancing calculator. Enter your accounts and positions,
            set a target allocation, and get exact buy/sell orders across every account — taxable,
            IRA, 401(k), HSA.
          </p>
          <p className="text-sm text-gray-500 mt-2.5 max-w-2xl leading-relaxed">
            Everything runs locally in your browser; nothing is sent anywhere. Drift produces
            mechanical calculations from your own inputs — <span className="font-medium text-gray-700">not investment advice</span>.
          </p>
        </div>
      </div>

      {/* Workflow stepper */}
      <div className="mt-11">
        <div className="flex items-baseline justify-between mb-4">
          <span className="font-semibold text-[15px] text-gray-900">Five steps, about ten minutes</span>
          <span className="font-mono text-[11px] tracking-[0.16em] uppercase text-gray-400">Workflow</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5 relative">
          {STEPS.map((s, i) => (
            <div
              key={s.n}
              className="relative bg-white border border-gray-200 rounded-xl p-4 transition hover:border-indigo-200 hover:shadow-[0_10px_24px_-18px_rgba(79,70,229,0.5)]"
            >
              <div className={`w-[30px] h-[30px] rounded-[9px] text-white font-mono font-semibold text-sm flex items-center justify-center mb-3 ${s.payoff ? 'bg-amber-500' : 'bg-indigo-600'}`}>
                {s.n}
              </div>
              <div className="font-semibold text-[14.5px] text-gray-900 mb-1">{s.name}</div>
              <div className="text-xs text-gray-500 leading-snug">{s.desc}</div>
              {i < STEPS.length - 1 && <Arrow />}
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="flex items-center gap-5 mt-8 flex-wrap">
        <button
          onClick={onStart}
          className="inline-flex items-center gap-2 bg-indigo-600 text-white font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Get started <span aria-hidden="true">→</span>
        </button>
        <button
          onClick={onOpenHowItWorks}
          className="inline-flex items-center gap-1.5 text-sm text-indigo-600 font-medium hover:underline"
        >
          New here? See how it works <span aria-hidden="true">→</span>
        </button>
      </div>

      {/* Privacy */}
      <div className="mt-10 border border-gray-200 rounded-xl px-5 py-4 flex gap-3.5 items-start max-w-3xl bg-white">
        <span className="w-[34px] h-[34px] rounded-[9px] bg-gray-50 flex items-center justify-center flex-none text-gray-400">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 1.5l5.5 2v4c0 3.4-2.3 6.2-5.5 7-3.2-.8-5.5-3.6-5.5-7v-4L9 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M6.5 9l1.8 1.8L11.8 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <p className="text-[13.5px] text-gray-500 leading-relaxed">
          <span className="font-semibold text-gray-700">Private by default.</span> All computation
          happens in your browser — no account, no upload. Your setup saves automatically to local
          storage, and you can export it as a JSON file for backup.
        </p>
      </div>

    </div>
  );
}
