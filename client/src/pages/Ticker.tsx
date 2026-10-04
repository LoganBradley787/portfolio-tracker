import { Link, useParams } from 'react-router-dom';
import type { tickerView } from '../../../src/server/service.ts';
import { LineChartFrame, axisMoney, useChartColors } from '../components/charts.tsx';
import { RangeSelector } from '../components/RangeSelector.tsx';
import { Table } from '../components/Table.tsx';
import { SellPreview } from '../components/SellPreview.tsx';
import { useAccount } from '../lib/account.tsx';
import { Empty, ErrorLine, Notice, PageTitle, Section, Skeleton } from '../components/ui.tsx';
import { date, money, pct, shares, tone } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { useMethod } from '../lib/method.tsx';
import { rangeQuery } from '../lib/range.ts';
import { usePersistentRange } from '../lib/usePersistentRange.ts';

type Detail = NonNullable<ReturnType<typeof tickerView>>;

export default function Ticker() {
  const { ticker = '' } = useParams();
  const config = useApi<{ today: string }>('/api/config');
  const [range, setRange] = usePersistentRange('ticker', { preset: 'All' });
  const { method, setMethod } = useMethod();
  const c = useChartColors();
  const { selected } = useAccount();
  const result = useApi<Detail>(config.data ? `/api/ticker/${encodeURIComponent(ticker)}${rangeQuery(range, config.data.today)}` : null);
  const p = result.data;
  // Route navigation must not momentarily show the previous ticker's detail.
  if (result.error) return <ErrorLine error={result.error} />;
  if (!p || p.ticker !== ticker.toUpperCase()) return <Skeleton rows={10} />;
  const h = p.holding;
  const dividends = [
    ...p.dividends.map((d) => ({ ...d, reason: 'Reinvested', reinvestedShares: d.shares })),
    ...p.cashDividends.map((d) => ({ ...d, reason: d.reason === 'sold' ? 'Sold on ex-date; kept as cash' : 'No close; kept as cash', reinvestedShares: null })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.account.localeCompare(b.account));

  return (
    <div className={result.loading ? 'opacity-80' : ''}>
      <Link className="text-xs text-accent hover:underline" to="/">← Holdings</Link>
      <PageTitle title={p.ticker} aside={<RangeSelector value={range} onChange={setRange} min={p.firstDate} max={config.data?.today} />}>
        {[p.security.name, p.security.assetType, p.security.sector].filter(Boolean).join(' · ')}
      </PageTitle>
      {p.security.status !== 'ok' && (
        <Notice tone="warn" title={`Prices ${p.security.status}`}>
          {p.security.lastError ?? 'Price history has not loaded yet.'} A holding without prices is valued at cost.
        </Notice>
      )}
      {p.oversells.length > 0 && (
        <Notice tone="warn" title="A sale exceeds the shares held">
          The ledger clamps it to shares available. Review Data health for missing transactions.
        </Notice>
      )}

      <dl className="grid grid-cols-2 gap-x-6 border-y border-rule-strong sm:grid-cols-4">
        {[
          ['Shares at end', shares(h?.shares ?? 0), ''],
          ['Value at end', money(h?.equity ?? 0), ''],
          ['Cost basis at end', money(h?.totalCost ?? 0), ''],
          ['Unrealized gain', money(h?.gain ?? 0, { signed: true }), tone(h?.gain)],
        ].map(([label, value, cls]) => (
          <div key={label} className="py-3">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className={`num mt-1 text-lg font-semibold ${cls}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">
        Position at {date(p.to)}, for the accounts selected in the header. Tables show events within the
        selected range; remaining lots include earlier purchases.
      </p>

      <SellPreview key={`${p.ticker}:${JSON.stringify(selected)}`} input={p.sellPreview} method={method} />

      <Section title="Price and trades">
        {p.prices.length ? (
          <LineChartFrame
            label={`${ticker} split-adjusted price with buy and sell markers`}
            rows={p.prices.map((b) => ({ date: b.date, close: b.close }))}
            series={[{
              key: 'close', label: 'Split-adjusted close', color: c.s1,
              format: (v) => money(v, { precise: true }),
            }]}
            yFormat={axisMoney}
            markers={p.markers}
          />
        ) : (
          <Empty title="No prices in this range">Try a wider range, or check Data health.</Empty>
        )}
        <p className="mt-2 text-xs text-muted">
          B = buy, S = sell, at your execution price. Prices and markers are adjusted for splits through the
          end date. Weekend trades are marked on the next available price date. Entered trades below keep
          their original shares and prices.
        </p>
      </Section>

      <Section title="Remaining lots" count={p.lots?.length}>
        {method !== 'fifo' ? (
          <p className="border-y border-rule py-3 text-[13px] text-muted">
            Average cost pools purchases.{' '}
            <button
              className="cursor-pointer font-medium text-accent hover:underline"
              onClick={() => setMethod('fifo')}
            >
              Switch to FIFO
            </button> to see the remaining lots per account.
          </p>
        ) : p.lots?.length ? (
          <Table
            caption="Remaining FIFO lots"
            rows={p.lots.map((l, i) => ({ ...l, i }))}
            rowKey={(l) => l.i}
            columns={[
              { key: 'date', label: 'Acquired', render: (l) => <span className="num">{date(l.acquired)}</span> },
              { key: 'account', label: 'Account', render: (l) => l.account || '(no account)' },
              { key: 'shares', label: 'Shares', numeric: true, render: (l) => shares(l.shares) },
              { key: 'cost', label: 'Cost', numeric: true, render: (l) => money(l.cost) },
              { key: 'avg', label: 'Cost per share', numeric: true, render: (l) => money(l.cost / l.shares, { precise: true }) },
            ]}
          />
        ) : (
          <Empty title="No remaining lots">This position is closed in the selected accounts at the end date.</Empty>
        )}
      </Section>

      <Section title="Transactions" count={p.trades.length}>
        {p.trades.length ? <Table caption={`${ticker} entered transactions`} rows={p.trades} rowKey={(t) => t.id} columns={[
          { key: 'date', label: 'Date', render: (t) => <span className="num">{date(t.date)}</span> },
          { key: 'type', label: 'Type', render: (t) => t.type },
          { key: 'account', label: 'Account', render: (t) => t.account || '(no account)' },
          { key: 'shares', label: 'Shares', numeric: true, render: (t) => shares(t.shares) },
          { key: 'price', label: 'Price', numeric: true, render: (t) => money(t.price, { precise: true }) },
          { key: 'amount', label: 'Amount', numeric: true, render: (t) => money(t.shares * t.price) },
          { key: 'note', label: 'Note', render: (t) => t.note, className: 'hidden lg:table-cell' },
        ]} /> : <Empty title="No entered trades in this range" />}
      </Section>

      {p.sales.length > 0 && <Section title="Realized gains" count={p.sales.length}>
        <Table caption={`${ticker} realized gains`} rows={p.sales} rowKey={(s) => s.txId} columns={[
          { key: 'date', label: 'Sold', render: (s) => <span className="num">{date(s.date)}</span> },
          { key: 'account', label: 'Account', render: (s) => s.account || '(no account)' },
          { key: 'shares', label: 'Shares sold', numeric: true, render: (s) => shares(s.sharesSold) },
          { key: 'proceeds', label: 'Proceeds', numeric: true, render: (s) => money(s.proceeds) },
          { key: 'cost', label: 'Cost removed', numeric: true, render: (s) => money(s.costRemoved) },
          { key: 'gain', label: 'Gain', numeric: true, render: (s) => <span className={tone(s.gain)}>{money(s.gain, { signed: true })}</span> },
          { key: 'pct', label: 'Gain %', numeric: true, render: (s) => <span className={tone(s.gain)}>{pct(s.gainPct)}</span> },
        ]} />
      </Section>}

      <Section title="Dividends" count={dividends.length}>
        {dividends.length ? <Table caption={`${ticker} dividends and reinvestments`} rows={dividends.map((d, i) => ({ ...d, i }))} rowKey={(d) => d.i} columns={[
          { key: 'date', label: 'Ex-date', render: (d) => <span className="num">{date(d.date)}</span> },
          { key: 'account', label: 'Account', render: (d) => d.account || '(no account)' },
          { key: 'amount', label: 'Amount', numeric: true, render: (d) => money(d.amount) },
          { key: 'shares', label: 'Shares bought', numeric: true, render: (d) => d.reinvestedShares === null ? '—' : shares(d.reinvestedShares) },
          { key: 'reason', label: 'Treatment', render: (d) => <span className="text-muted">{d.reason}</span> },
        ]} /> : <Empty title="No dividends in this range" />}
        <p className="mt-2 text-xs text-muted">Reinvestments use the ex-date close, matching the rest of the app. Broker pay-date reinvestments can differ.</p>
      </Section>
      {p.splits.length > 0 && (
        <Section title="Splits">
          <p className="tnum text-[13px]">
            {p.splits.map((s) => `${date(s.exDate)}: ${s.ratio}-for-1${s.source === 'manual' ? ' (manual)' : ''}`).join(' · ')}
          </p>
        </Section>
      )}
    </div>
  );
}
