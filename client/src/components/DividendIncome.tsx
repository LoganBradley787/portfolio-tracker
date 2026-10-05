import type { IncomeSummary } from '../../../src/engine/income.ts';
import { date, money, pct, shares, tone } from '../lib/format.ts';
import { Table } from './Table.tsx';
import { TickerLink } from './TickerLink.tsx';
import { Empty, Section } from './ui.tsx';

export type Income = IncomeSummary & { received: { year: number; total: number }[] };

/** Dividends expected over the next twelve months, and what each past year paid. */
export function DividendIncome({ income, today }: { income: Income; today: string }) {
  const thisYear = Number(today.slice(0, 4));
  const years = income.received.map((y, i) => {
    const before = income.received[i + 1]?.total;
    return { ...y, change: before ? y.total / before - 1 : null, partial: y.year === thisYear };
  });
  const lastFull = years.find((y) => !y.partial);
  return (
    <Section title="Dividend income" count={income.rows.length}>
      {income.rows.length === 0 && years.length === 0 ? (
        <Empty title="No dividends yet">None of the holdings has paid a dividend while you held it.</Empty>
      ) : (
        <>
          <dl className="mb-3 grid grid-cols-2 gap-x-6 border-y border-rule-strong sm:grid-cols-4">
            {[
              ['Next 12 months (estimate)', money(income.annual), 'the last 12 months’ dividends on today’s shares'],
              ['A month, on average', money(income.annual / 12), 'payments bunch up by quarter'],
              ['Yield on today’s value', pct(income.yield, { signed: false }), 'income ÷ value of the selected accounts'],
              lastFull
                ? [`Received in ${lastFull.year}`, money(lastFull.total), lastFull.change === null ? 'the first full year' : `${pct(lastFull.change)} on ${lastFull.year - 1}`]
                : [`Received in ${thisYear}`, money(years[0]?.total ?? 0), 'so far'],
            ].map(([k, v, sub]) => (
              <div key={k} className="min-w-0 py-3">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="num mt-0.5 text-lg leading-7 font-semibold tracking-tight">{v}</dd>
                <dd className="text-xs text-muted">{sub}</dd>
              </div>
            ))}
          </dl>
          {income.rows.length > 0 && (
            <Table
              caption="Expected dividend income by holding"
              rows={income.rows}
              rowKey={(r) => r.ticker}
              initialSort={{ key: 'annual', dir: 'desc' }}
              showTotals
              columns={[
                { key: 'ticker', label: 'Ticker', sort: (r) => r.ticker, render: (r) => <TickerLink ticker={r.ticker} />, total: 'Total' },
                { key: 'shares', label: 'Shares', numeric: true, sort: (r) => r.shares, render: (r) => shares(r.shares), className: 'hidden md:table-cell' },
                { key: 'perShare', label: 'Per share, last 12 mo', numeric: true, sort: (r) => r.perShare, render: (r) => money(r.perShare, { precise: true }), className: 'hidden sm:table-cell' },
                { key: 'payments', label: 'Payments', numeric: true, sort: (r) => r.payments, render: (r) => r.payments, className: 'hidden lg:table-cell' },
                { key: 'annual', label: 'Next 12 months', numeric: true, sort: (r) => r.annual, render: (r) => <span className="font-semibold">{money(r.annual)}</span>, total: money(income.annual) },
                { key: 'yield', label: 'Yield', numeric: true, sort: (r) => r.yield, render: (r) => pct(r.yield, { signed: false }), total: pct(income.yield, { signed: false }) },
                { key: 'last', label: 'Last ex-date', numeric: true, sort: (r) => r.lastExDate, render: (r) => date(r.lastExDate), className: 'hidden lg:table-cell' },
                {
                  key: 'next', label: 'Next expected', numeric: true, sort: (r) => r.nextExDate,
                  render: (r) => (r.nextExDate ? `about ${date(r.nextExDate)}` : <span className="text-muted">—</span>),
                  className: 'hidden md:table-cell',
                },
              ]}
            />
          )}
          {years.length > 0 && (
            <div className="mt-4 max-w-md">
              <Table
                caption="Dividends received by year"
                rows={years}
                rowKey={(y) => y.year}
                columns={[
                  { key: 'year', label: 'Year', render: (y) => <span className="num">{y.year}{y.partial ? ' so far' : ''}</span> },
                  { key: 'total', label: 'Received', numeric: true, render: (y) => money(y.total) },
                  {
                    key: 'change', label: 'On the year before', numeric: true,
                    render: (y) => (y.change === null || y.partial ? <span className="text-muted">—</span> : <span className={tone(y.change)}>{pct(y.change)}</span>),
                  },
                ]}
              />
            </div>
          )}
          <p className="mt-2 max-w-prose text-xs text-muted">
            The estimate repeats each holding’s last twelve months of dividends per share on the shares held today, so a
            cut, a rise or a one-off special dividend is not anticipated. The next ex-date is a guess from the usual gap
            between payments. Every dividend is reinvested, so this income buys shares rather than arriving as cash.
            Received figures change with the money invested as well as with the dividends themselves.
          </p>
        </>
      )}
    </Section>
  );
}
