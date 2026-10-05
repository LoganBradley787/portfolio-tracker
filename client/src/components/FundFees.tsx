import type { FeeSummary } from '../../../src/engine/fees.ts';
import { money } from '../lib/format.ts';
import { Table } from './Table.tsx';
import { TickerLink } from './TickerLink.tsx';
import { Empty, Section } from './ui.tsx';

const ratioFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
/** 0.0003 → "0.03%"; a third decimal only when it is needed. */
export const ratio = (n: number | null) => (n === null ? '—' : `${ratioFmt.format(n * 100)}%`);

/** What the funds held charge each year, and what that adds up to. */
export function FundFees({ fees }: { fees: FeeSummary }) {
  const known = fees.rows.some((r) => r.expenseRatio !== null);
  const longest = fees.drag[fees.drag.length - 1];
  return (
    <Section title="Fund fees" count={fees.rows.length}>
      {fees.rows.length === 0 ? (
        <Empty title="No funds held">Stocks carry no yearly fee. A fund’s fee appears here once you hold one.</Empty>
      ) : (
        <>
          {known && (
            <dl className="mb-3 grid grid-cols-2 gap-x-6 border-y border-rule-strong sm:grid-cols-4">
              {[
                ['Fees a year', money(fees.annualCost), 'taken out of the funds’ prices, never billed'],
                ['On the whole portfolio', ratio(fees.blendedRatio), 'stocks count as 0%'],
                ...fees.drag.slice(-2).map((d) => [`Cost over ${d.years} years`, money(d.cost, { whole: true }), 'today’s fund holdings only'] as const),
              ].map(([k, v, sub]) => (
                <div key={k} className="min-w-0 py-3">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="num mt-0.5 text-lg leading-7 font-semibold tracking-tight">{v}</dd>
                  <dd className="text-xs text-muted">{sub}</dd>
                </div>
              ))}
            </dl>
          )}
          <Table
            caption="Fees by fund"
            rows={fees.rows}
            rowKey={(r) => r.ticker}
            showTotals={known}
            columns={[
              { key: 'ticker', label: 'Fund', sort: (r) => r.ticker, render: (r) => <TickerLink ticker={r.ticker} />, total: 'Total' },
              { key: 'value', label: 'Value', numeric: true, sort: (r) => r.value, render: (r) => money(r.value), total: money(fees.rows.reduce((a, r) => a + r.value, 0)) },
              { key: 'ratio', label: 'Expense ratio', numeric: true, sort: (r) => r.expenseRatio, render: (r) => (r.expenseRatio === null ? <span className="text-muted">not published</span> : ratio(r.expenseRatio)) },
              { key: 'cost', label: 'Fee a year', numeric: true, sort: (r) => r.annualCost, render: (r) => (r.annualCost === null ? <span className="text-muted">—</span> : money(r.annualCost)), total: money(fees.annualCost) },
            ]}
          />
          <p className="mt-2 max-w-prose text-xs text-muted">
            Expense ratios come from Yahoo Finance and are refreshed weekly.{' '}
            {known && longest && (
              <>
                The {longest.years}-year cost is how much smaller today’s fund holdings end up with the fee taken every year than
                without it, if they grow {Math.round(fees.growth * 100)}% a year before fees. Money added later is not counted.{' '}
              </>
            )}
            {fees.missing.length > 0 && (
              <>
                No fee is known yet for {fees.missing.join(', ')}, so {fees.missing.length > 1 ? 'they are' : 'it is'} left out of the totals.
              </>
            )}
          </p>
        </>
      )}
    </Section>
  );
}
