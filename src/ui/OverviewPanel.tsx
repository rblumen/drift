interface Props {
  /** Called when the user clicks "Get started" — navigates to the Accounts tab. */
  onStart: () => void;
}

const STEPS = [
  {
    num: '1',
    tab: 'Accounts',
    color: 'bg-indigo-100 text-indigo-700',
    description:
      'Register each investment account — name, institution, and tax type. ' +
      'Account type (taxable vs. tax-advantaged) determines where the engine prefers to place each asset class.',
  },
  {
    num: '2',
    tab: 'Import',
    color: 'bg-sky-100 text-sky-700',
    description:
      'Load your current positions. Upload a CSV exported from your broker, or enter positions by hand. ' +
      'Schwab, Fidelity, and Empower CSV formats are supported out of the box.',
  },
  {
    num: '3',
    tab: 'Classify',
    color: 'bg-amber-100 text-amber-700',
    description:
      'Any ticker the app doesn\'t recognise appears here. Assign it an asset class and the engine re-runs immediately. ' +
      'For blended funds (target-date funds, balanced funds), you can define a custom decomposition by percentage.',
  },
  {
    num: '4',
    tab: 'Strategy',
    color: 'bg-emerald-100 text-emerald-700',
    description:
      'Review and adjust your target allocation (must sum to 100%) and placement rules — which account type ' +
      'should hold each asset class. Defaults are pre-loaded; edit anything freely.',
  },
  {
    num: '5',
    tab: 'Results',
    color: 'bg-violet-100 text-violet-700',
    description:
      'See household drift vs. target, per-account buy/sell recommendations, and any flags that require attention. ' +
      'Results recalculate live as you change accounts, positions, or strategy.',
  },
];

// Engine priority tiers, sourced from PRINCIPLES.md.
// Each item has a short label shown in the numbered badge and a one-line
// description suitable for a general audience.
const PRINCIPLES: {
  tier: string;
  color: string;           // Tailwind classes for the tier pill
  items: { num: number; heading: string; body: string }[];
}[] = [
  {
    tier: 'Hard constraints',
    color: 'bg-rose-100 text-rose-700',
    items: [
      {
        num: 1,
        heading: 'Respect locked accounts and positions',
        body: 'Locked accounts generate zero trades. Individually locked positions are frozen in place and excluded from trade math.',
      },
      {
        num: 2,
        heading: 'Respect per-account asset class restrictions',
        body: 'Explicit allowlists (allowedAssetClasses) or ticker menus (availableTickers) limit which classes can land in an account. No trade places a class in an account that can\'t hold it.',
      },
      {
        num: 3,
        heading: 'Keep each account\'s trades balance-preserving',
        body: 'Buys and sells within an account must net to that account\'s new-cash contribution (zero if nothing is being deployed). No phantom cash transfers in or out.',
      },
    ],
  },
  {
    tier: 'Primary objectives',
    color: 'bg-indigo-100 text-indigo-700',
    items: [
      {
        num: 4,
        heading: 'Hit the household-level target allocation',
        body: 'Target weights apply to all accounts combined — not per-account. The engine decides which account holds each dollar.',
      },
      {
        num: 5,
        heading: 'Suppress trivial drift',
        body: 'Classes within the effective tolerance band — the tighter of the absolute (toleranceAbs) and relative (toleranceRel × target) bands, per the Bogleheads 5/25 rule — are left alone entirely.',
      },
      {
        num: 6,
        heading: 'Place asset classes in their tax-preferred buckets',
        body: 'Most-constrained classes (fewest eligible bucket options) are placed first. If a preferred bucket is full, the class spills into the next preferred bucket and is flagged.',
      },
    ],
  },
  {
    tier: 'Secondary objectives',
    color: 'bg-amber-100 text-amber-700',
    items: [
      {
        num: 7,
        heading: 'Minimize taxable sells',
        body: 'Sells in taxable accounts are avoided or redirected to tax-advantaged accounts wherever possible.',
      },
      {
        num: 8,
        heading: 'Concentrate each class in the fewest accounts',
        body: 'Within a placement bucket the engine fills the largest-capacity account first, spilling to smaller accounts only when it is exhausted.',
      },
      {
        num: 9,
        heading: 'Fill concentrateClasses accounts before general accounts',
        body: 'Accounts designated to concentrate a class (e.g. a Roth IRA earmarked for alternatives) are filled ahead of other accounts in the same bucket.',
      },
    ],
  },
  {
    tier: 'Simplicity objectives',
    color: 'bg-gray-100 text-gray-600',
    items: [
      {
        num: 10,
        heading: 'Minimize the number of trades',
        body: 'Dust trades below minTradeUsd are always suppressed. A post-placement pass also drops marginal trades whose removal keeps every projected weight within its effective tolerance band (5/25 rule).',
      },
      {
        num: 11,
        heading: 'Minimize the number of accounts touched',
        body: 'When the allocation target can be met by touching fewer accounts, the simpler plan is preferred. Trades are concentrated before being spread.',
      },
    ],
  },
];

const ASSUMPTIONS = [
  {
    heading: 'Household-level, not account-by-account',
    body: 'Target weights apply to all accounts combined. The engine decides which account should hold each dollar — it does not match percentages independently inside each account.',
  },
  {
    heading: 'US equity is split by Russell cap weights',
    body: 'Holdings mapped to "US Total Market" (VTI, FZROX, FSKAX, etc.) are redistributed to Large Cap (67%), Mid Cap (25%), and Small Cap (8%) using the Russell index methodology. You can set a single total-market target or control each sub-class independently.',
  },
  {
    heading: 'Fixed income goes in taxable by default',
    body: 'The default strategy holds muni bonds (e.g. MUNY) in the taxable account because muni interest is exempt from federal and NY state taxes. Equities and alternatives go in tax-advantaged accounts where long-term growth compounds tax-deferred.',
  },
  {
    heading: 'No cost-basis tracking in v1',
    body: 'The engine flags when a recommended sell lands in a taxable account (TAXABLE_SALE), but it does not estimate the capital gain. Review taxable sells manually before executing.',
  },
  {
    heading: 'Prices are optional',
    body: 'Market values are required; share prices are not. If you provide a price, the Results tab shows share counts alongside dollar amounts. Without a price, only dollar amounts are shown.',
  },
];

export function OverviewPanel({ onStart }: Props) {
  return (
    <div className="max-w-2xl mx-auto space-y-8 py-2">

      {/* Hero */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-0.5">Drift</h2>
        <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide">DIY Portfolio Rebalancer</p>
        <p className="text-sm text-gray-600 leading-relaxed">
          A household-level rebalancing tool for multi-account portfolios. You enter your current
          positions, set a target allocation and placement strategy, and the engine produces
          concrete buy/sell recommendations — broken down by account and asset class.
        </p>
        <p className="text-sm text-gray-500 mt-2 leading-relaxed">
          Everything runs locally in your browser. No data is sent anywhere.
          This tool produces mechanical calculations from your own inputs — it is{' '}
          <span className="font-medium">not investment advice</span>.
        </p>
      </div>

      {/* Workflow steps */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
          The five-step workflow
        </h3>
        <div className="space-y-3">
          {STEPS.map(step => (
            <div key={step.num} className="flex gap-3 items-start">
              <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${step.color}`}>
                {step.num}
              </div>
              <div className="pt-0.5">
                <span className="text-sm font-medium text-gray-800">{step.tab}</span>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Key assumptions */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
          Assumptions and design choices
        </h3>
        <div className="space-y-3">
          {ASSUMPTIONS.map(a => (
            <div
              key={a.heading}
              className="border border-gray-200 rounded-lg px-4 py-3 bg-white"
            >
              <p className="text-sm font-medium text-gray-800 mb-0.5">{a.heading}</p>
              <p className="text-xs text-gray-500 leading-relaxed">{a.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Engine priority order */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-1 uppercase tracking-wide">
          How the engine prioritizes
        </h3>
        <p className="text-xs text-gray-500 mb-3 leading-relaxed">
          When goals conflict the higher-ranked goal always wins. Within a tier, goals are
          applied in order.
        </p>
        <div className="space-y-4">
          {PRINCIPLES.map(tier => (
            <div key={tier.tier}>
              <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full mb-2 ${tier.color}`}>
                {tier.tier}
              </span>
              <div className="space-y-2">
                {tier.items.map(item => (
                  <div key={item.num} className="flex gap-3 items-start">
                    <span className="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center leading-none">
                      {item.num}
                    </span>
                    <div>
                      <p className="text-xs font-medium text-gray-800">{item.heading}</p>
                      <p className="text-xs text-gray-500 leading-relaxed mt-0.5">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Flags quick reference */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
          Flags you may see
        </h3>
        <div className="border border-gray-200 rounded-lg overflow-hidden text-xs">
          <table className="w-full">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Flag</th>
                <th className="px-4 py-2 text-left">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-600">
              <tr>
                <td className="px-4 py-2 font-medium text-orange-700 whitespace-nowrap">REVISIT_PLACEMENT</td>
                <td className="px-4 py-2">Taxable share of household exceeds the fixed-income target weight. Bonds-only taxable is no longer feasible — update placement rules.</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-medium text-amber-700 whitespace-nowrap">TAXABLE_SALE</td>
                <td className="px-4 py-2">A recommended sell is in a taxable account. May trigger a capital gain — review before executing.</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-medium text-blue-700 whitespace-nowrap">PLACEMENT_SPILLOVER</td>
                <td className="px-4 py-2">An asset class filled its preferred bucket and spilled into a secondary bucket. Informational only.</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-medium text-red-700 whitespace-nowrap">NO_ELIGIBLE_ACCOUNT</td>
                <td className="px-4 py-2">No account has capacity for a given asset class. Check account restrictions in the Accounts tab.</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-medium text-amber-700 whitespace-nowrap">UNMAPPED_HOLDING</td>
                <td className="px-4 py-2">A ticker has no asset class assigned. Go to the Classify tab.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Privacy callout */}
      <div className="border border-gray-200 rounded-lg px-4 py-3 bg-gray-50 text-xs text-gray-500 leading-relaxed">
        <span className="font-medium text-gray-700">Privacy: </span>
        All computation runs in your browser. No data leaves your machine, and no account is required.
        Your portfolio setup is saved automatically to your browser's localStorage and can be saved as a JSON file for backup.
      </div>

      {/* CTA */}
      <div className="flex items-center gap-4 pt-2">
        <button
          onClick={onStart}
          className="bg-indigo-600 text-white text-sm font-medium px-5 py-2 rounded-md hover:bg-indigo-700 transition-colors"
        >
          Get started →
        </button>
        <span className="text-xs text-gray-400">Opens the Accounts tab</span>
      </div>

    </div>
  );
}
