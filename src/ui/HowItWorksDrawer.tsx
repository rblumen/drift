import { useEffect } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const ASSUMPTIONS: { heading: string; body: string }[] = [
  {
    heading: 'Household-level, not account-by-account',
    body: 'Target weights apply to all accounts combined. The engine decides which account should hold each dollar — it does not match percentages independently inside each account.',
  },
  {
    heading: 'US equity is split by Russell cap weights',
    body: 'Holdings mapped to "US Total Market" (VTI, FZROX, FSKAX…) are redistributed to Large Cap (67%), Mid Cap (25%), and Small Cap (8%). Set a single total-market target or control each sub-class.',
  },
  {
    heading: 'Fixed income goes in taxable by default',
    body: 'The default strategy holds muni bonds (e.g. MUNY) in taxable, since muni interest is federal- and NY-exempt. Equities and alternatives go in tax-advantaged accounts where growth compounds tax-deferred.',
  },
  {
    heading: 'No cost-basis tracking in v1',
    body: 'The engine flags when a recommended sell lands in a taxable account (TAXABLE_SALE), but does not estimate the capital gain. Review taxable sells manually before executing.',
  },
  {
    heading: 'Prices are optional',
    body: 'Market values are required; share prices are not. Provide a price and Results shows share counts alongside dollar amounts. Without one, only dollar amounts appear.',
  },
];

const TIERS: {
  tier: string;
  pill: string;
  items: { num: number; heading: string; body: string }[];
}[] = [
  {
    tier: 'Hard constraints',
    pill: 'bg-danger-bg text-danger',
    items: [
      { num: 1, heading: 'Respect locked accounts & positions', body: 'Locked accounts generate zero trades. Locked positions are frozen and excluded from trade math.' },
      { num: 2, heading: 'Respect per-account class restrictions', body: "Allowlists or ticker menus limit which classes land in an account. No trade places a class where it can't go." },
      { num: 3, heading: "Keep each account's trades balance-preserving", body: 'Buys and sells within an account net to its new-cash contribution. No phantom cash transfers.' },
    ],
  },
  {
    tier: 'Primary objectives',
    pill: 'bg-brand-100 text-brand-700',
    items: [
      { num: 4, heading: 'Hit the household-level target', body: 'Target weights apply to all accounts combined. The engine decides which account holds each dollar.' },
      { num: 5, heading: 'Suppress trivial drift', body: 'Classes within the effective tolerance band — the tighter of the absolute and relative bands (Bogleheads 5/25) — are left alone.' },
      { num: 6, heading: 'Place classes in tax-preferred buckets', body: 'Most-constrained classes are placed first. If a preferred bucket is full, the class spills into the next and is flagged.' },
    ],
  },
  {
    tier: 'Secondary objectives',
    pill: 'bg-warn-bg text-warn',
    items: [
      { num: 7, heading: 'Minimize taxable sells', body: 'Sells in taxable accounts are avoided or redirected to tax-advantaged accounts wherever possible.' },
      { num: 8, heading: 'Concentrate each class in fewest accounts', body: "Within a bucket, the engine fills the largest-capacity account first, spilling only when it's exhausted." },
      { num: 9, heading: 'Fill earmarked accounts first', body: 'Accounts designated to concentrate a class (e.g. a Roth earmarked for alternatives) are filled ahead of others in the bucket.' },
    ],
  },
  {
    tier: 'Simplicity objectives',
    pill: 'bg-tint text-muted-2',
    items: [
      { num: 10, heading: 'Minimize the number of trades', body: 'Dust trades below the minimum are suppressed. A post-pass drops marginal trades whose removal keeps every weight within its band.' },
      { num: 11, heading: 'Minimize accounts touched', body: 'When the target can be met by touching fewer accounts, the simpler plan wins. Trades are concentrated before being spread.' },
    ],
  },
];

const FLAGS: { name: string; color: string; meaning: string }[] = [
  { name: 'TAXABLE_SALE', color: 'text-warn', meaning: 'A recommended sell is in a taxable account. May trigger a capital gain — review before executing.' },
  { name: 'PLACEMENT_SPILLOVER', color: 'text-info', meaning: 'An asset class filled its preferred bucket and spilled into a secondary one. Informational only.' },
  { name: 'NO_ELIGIBLE_ACCOUNT', color: 'text-danger', meaning: 'No account has capacity for a given asset class. Check account restrictions in the Accounts tab.' },
  { name: 'UNMAPPED_HOLDING', color: 'text-warn', meaning: 'A ticker has no asset class assigned. Go to the Classify tab.' },
];

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-3 mb-5">
    <span className="font-semibold text-[18px] tracking-tight text-gray-900">{children}</span>
    <span className="flex-1 h-px bg-gray-200" />
  </div>
);

export function HowItWorksDrawer({ open, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-[rgba(17,22,29,0.34)] transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Panel.
          When closed the panel is only slid off-screen (translate-x-full), so
          without `inert`/`aria-hidden` its Close button and links stay tabbable
          and announced — a keyboard/SR user could land inside an invisible
          dialog. Marking it inert + hidden when closed removes everything inside
          from the tab order and the accessibility tree. `inert` is spread
          conditionally because React 18 doesn't treat it as a managed boolean
          (any value, including "false", activates it). */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="How it works"
        aria-hidden={open ? undefined : true}
        {...(open ? {} : { inert: '' })}
        className={`fixed top-0 right-0 z-50 h-screen w-[min(560px,94vw)] bg-[#fbfcfd] border-l border-gray-200 shadow-[-30px_0_60px_-30px_rgba(17,22,29,0.45)] flex flex-col transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 bg-white flex-none">
          <div>
            <div className="font-mono text-[11px] tracking-[0.16em] uppercase text-gray-400">Reference</div>
            <div className="font-semibold text-xl tracking-tight text-gray-900 mt-0.5">How it works</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-gray-900 hover:border-gray-300 flex items-center justify-center transition"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-10 pt-2 overflow-y-auto flex-1">
          <p className="text-[15px] text-gray-600 leading-relaxed mt-4">
            Drift is a deterministic engine, not a black box. Here's what it assumes, how it
            prioritizes when goals conflict, and the flags it raises so you can audit any
            recommendation.
          </p>

          {/* Assumptions */}
          <div className="mt-9">
            <SectionLabel>Assumptions &amp; design choices</SectionLabel>
            <div className="flex flex-col gap-4">
              {ASSUMPTIONS.map(a => (
                <div key={a.heading} className="bg-white border border-gray-200 rounded-xl px-5 py-4">
                  <h4 className="font-semibold text-[14.5px] text-gray-900 mb-1.5">{a.heading}</h4>
                  <p className="text-[13px] text-gray-500 leading-relaxed">{a.body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Engine priority */}
          <div className="mt-9">
            <SectionLabel>How the engine prioritizes</SectionLabel>
            <p className="text-sm text-gray-500 -mt-3 mb-5 leading-relaxed">
              When goals conflict, the higher-ranked goal always wins. Within a tier, goals are
              applied in order.
            </p>
            <div className="flex flex-col gap-7">
              {TIERS.map(t => (
                <div key={t.tier}>
                  <span className={`inline-flex items-center font-mono text-[11px] font-semibold tracking-[0.06em] uppercase px-2.5 py-1 rounded-full mb-3.5 ${t.pill}`}>
                    {t.tier}
                  </span>
                  <div className="flex flex-col gap-3.5">
                    {t.items.map(item => (
                      <div key={item.num} className="flex gap-3 items-start">
                        <span className="flex-none w-6 h-6 rounded-[7px] bg-gray-100 text-gray-500 font-mono text-xs font-semibold flex items-center justify-center mt-0.5">
                          {item.num}
                        </span>
                        <div>
                          <h5 className="font-semibold text-[13.5px] text-gray-900 mb-0.5">{item.heading}</h5>
                          <p className="text-[12.5px] text-gray-500 leading-relaxed">{item.body}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Flags */}
          <div className="mt-9">
            <SectionLabel>Flags you may see</SectionLabel>
            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
              <div className="overflow-x-auto"><table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-line-2">
                    <th className="bg-tint font-mono text-[10px] tracking-[.06em] uppercase text-muted-3 text-left px-4 py-1.5 font-normal">Flag</th>
                    <th className="bg-tint font-mono text-[10px] tracking-[.06em] uppercase text-muted-3 text-left px-4 py-1.5 font-normal">Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {FLAGS.map((f, i) => (
                    <tr key={f.name + i} className="border-t border-line-3 hover:bg-paper">
                      <td className={`px-4 py-2 font-mono text-xs font-semibold whitespace-nowrap align-top ${f.color}`}>{f.name}</td>
                      <td className="px-4 py-2 text-[12.5px] text-gray-600 leading-relaxed align-top">{f.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
