const TEXT: Record<string, { label: string; title: string }> = {
  unresolved: { label: 'Unresolved', title: 'The price provider has no current data for this ticker. Valued at its last stored close, or at average cost if there is none. Fix it on Data health.' },
  pending: { label: 'Pending', title: 'Prices not fetched yet. Valued at average cost until they arrive.' },
  'no-price': { label: 'No price', title: 'No stored price. Valued at average cost.' },
};

export function Flag({ flag }: { flag: string | null }) {
  if (!flag) return null;
  const t = TEXT[flag] ?? { label: flag, title: flag };
  return (
    <span title={t.title} className="ml-2 inline-flex h-[18px] items-center rounded border border-warn/50 bg-warn-soft px-1.5 text-[11px] font-medium text-warn">
      {t.label}
    </span>
  );
}
