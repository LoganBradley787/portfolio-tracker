// What the funds held charge each year, and what that adds up to.
import type { FeeSummary } from '../../../src/engine/fees.ts';
import { Table } from '../components/Table.tsx';
import { TickerLink } from '../components/TickerLink.tsx';
import { Empty, ErrorLine, Note, PageHeader, Section, Skeleton, Stat, StatRow } from '../components/ui.tsx';
import { ACTIVITY_TABS } from '../lib/areas.ts';
import { money } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';

const ratioFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
/** 0.0003 → "0.03%"; a third decimal only when it is needed. */
export const ratio = (n: number | null) => (n === null ? '—' : `${ratioFmt.format(n * 100)}%`);

export default function Fees() {
  const { data, error } = useApi<{ fees: FeeSummary; transactionCount: number }>('/api/outlook');
  const header = <PageHeader tabs={ACTIVITY_TABS} />;
  if (error && !data) return <>{header}<ErrorLine error={error} /></>;
  if (!data) return <>{header}<Skeleton rows={6} /></>;
  const fees = data.fees;
  const known = fees.rows.some((r) => r.expenseRatio !== null);
  if (fees.rows.length === 0) {
    return <>{header}<Empty title="No funds held">Stocks carry no yearly fee. A fund’s fee appears here once you hold one.</Empty></>;
  }
  return (
    <div>
      {header}
      {known && (
        <StatRow cols={4} className="mb-8">
          <Stat label="Fees a year" value={money(fees.annualCost)} info="Each fund’s expense ratio on today’s position. It is taken out of the fund’s price day by day, never billed." />
          <Stat label="On the whole portfolio" value={ratio(fees.blendedRatio)} info="Fees a year as a share of the whole portfolio’s value. Stocks carry no yearly fee, so they count as 0%." />
          {fees.drag.slice(-2).map((d) => (
            <Stat key={d.years} label={`Cost over ${d.years} years`} value={money(d.cost, { whole: true })} info={`How much smaller today’s fund holdings end up with the fee taken every year than without it, if they grow ${Math.round(fees.growth * 100)}% a year before fees. Money added later is not counted.`} />
          ))}
        </StatRow>
      )}
      <div className="grid grid-cols-1 gap-x-14 gap-y-10 lg:grid-cols-2">
      <Section flush title="By fund" count={fees.rows.length} info="Expense ratios come from Yahoo Finance and are refreshed weekly. A fund with no published ratio is left out of the totals.">
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
        {fees.missing.length > 0 && (
          <Note>No fee is known yet for {fees.missing.join(', ')}, so {fees.missing.length > 1 ? 'they are' : 'it is'} left out of the totals.</Note>
        )}
      </Section>
      {known && (
        <Section flush title="What the fee costs over time" info={`Today’s fund holdings growing ${Math.round(fees.growth * 100)}% a year before fees, with the fee taken every year and without. The bar is the difference: what the fee quietly removes. Money added later is not counted.`}>
          <ul className="divide-y divide-rule border-y border-rule-strong/60">
            {fees.drag.map((d) => (
              <li key={d.years} className="grid grid-cols-[6rem_1fr_7rem] items-center gap-x-4 py-3 text-[14px]">
                <span className="font-semibold">{d.years} years</span>
                <span aria-hidden className="h-3.5 overflow-hidden rounded-[2px] bg-rule/80">
                  <span className="block h-full bg-ink/80" style={{ width: `${(d.cost / Math.max(...fees.drag.map((x) => x.cost), 1e-9)) * 100}%` }} />
                </span>
                <span className="num text-right font-semibold">{money(d.cost, { whole: true })}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      </div>
    </div>
  );
}
