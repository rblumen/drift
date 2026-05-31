import { useState } from 'react';

// A three-state eligibility control shared by the deposit and withdrawal sides
// (issues #30 and #14). "full" accepts any share, "limited" caps it at a dollar
// amount (revealing a cap input), and "none" excludes the account entirely.
export type EligibilityPolicy = 'full' | 'limited' | 'none';

export interface EligibilityLabels {
  full: string;     // e.g. "Open" (deposits) / "Eligible" (withdrawals)
  limited: string;  // "Limited"
  none: string;     // "Closed" (deposits) / "Restricted" (withdrawals)
  capLabel: string; // caption next to the cap input, e.g. "free-cash cap"
}

const ACTIVE_CLASS: Record<EligibilityPolicy, string> = {
  full:    'bg-green-100 text-green-700',
  limited: 'bg-amber-100 text-amber-700',
  none:    'bg-red-100 text-red-600',
};

// Presentational segmented control + cap input. The caller owns (policy, limit).
export function EligibilityControl({
  policy, limit, labels, onPolicyChange, onLimitChange,
}: {
  policy: EligibilityPolicy;
  limit: string;
  labels: EligibilityLabels;
  onPolicyChange: (p: EligibilityPolicy) => void;
  onLimitChange: (v: string) => void;
}) {
  const opts: { value: EligibilityPolicy; label: string }[] = [
    { value: 'full',    label: labels.full },
    { value: 'limited', label: labels.limited },
    { value: 'none',    label: labels.none },
  ];
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div className="inline-flex rounded-full border border-gray-200 overflow-hidden text-xs">
        {opts.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onPolicyChange(opt.value)}
            className={`px-2.5 py-0.5 font-medium transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${
              policy === opt.value ? ACTIVE_CLASS[opt.value] : 'bg-white text-gray-400 hover:bg-gray-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {policy === 'limited' && (
        <div className="flex items-center gap-1 text-xs text-gray-600">
          <span className="text-gray-400">$</span>
          <input
            type="number"
            min="0"
            value={limit}
            onChange={e => onLimitChange(e.target.value)}
            placeholder="cap"
            className="w-24 border rounded px-1.5 py-0.5 text-xs"
          />
          <span className="text-gray-400">{labels.capLabel}</span>
        </div>
      )}
    </div>
  );
}

// Inline control for a table row. Holds its own (policy, limit) draft so selecting
// "Limited" can reveal an empty cap field without the row's derived value briefly
// snapping back. Re-mounts (fresh draft) when the row's key changes. Commits via
// onChange on every interaction.
export function EligibilityCell({
  initialPolicy, initialLimit, labels, onChange,
}: {
  initialPolicy: EligibilityPolicy;
  initialLimit: string;
  labels: EligibilityLabels;
  onChange: (policy: EligibilityPolicy, limit: string) => void;
}) {
  const [policy, setPolicy] = useState<EligibilityPolicy>(initialPolicy);
  const [limit, setLimit]   = useState(initialLimit);

  function commit(nextPolicy: EligibilityPolicy, nextLimit: string) {
    setPolicy(nextPolicy);
    setLimit(nextLimit);
    onChange(nextPolicy, nextLimit);
  }

  return (
    <EligibilityControl
      policy={policy}
      limit={limit}
      labels={labels}
      onPolicyChange={p => commit(p, limit)}
      onLimitChange={v => commit('limited', v)}
    />
  );
}
