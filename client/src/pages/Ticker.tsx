// One holding: its position, its price with your trades on it, and the
// ledger behind it, one tab at a time.
import { Link, useParams } from 'react-router-dom';
import type { tickerView } from '../../../src/server/service.ts';
import { LineChartFrame, axisMoney, useChartColors } from '../components/charts.tsx';
import { RangeSelector } from '../components/RangeSelector.tsx';
import { Table } from '../components/Table.tsx';
import { SellPreview } from '../components/SellPreview.tsx';
import { useAccount } from '../lib/account.tsx';
import { Empty, ErrorLine, Notice, PageTitle, Section, Segmented, Skeleton, Stat, StatRow } from '../components/ui.tsx';
import { date, money, pct, shares, tone } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { useMethod } from '../lib/method.tsx';
import { rangeQuery } from '../lib/range.ts';
import { usePersistent, usePersistentRange } from '../lib/usePersistentRange.ts';

type Detail = NonNullable<ReturnType<typeof tickerView>>;
type Tab = 'trades' | 'lots' | 'sales' | 'dividends' | 'sell';

export default function Ticker() {
  const { ticker = '' } = useParams();
  const config = useApi<{ today: string }>('/api/config');
  const [range, setRange] = usePersistentRange('ticker', { preset: 'All' });
  const [tab, setTab] = usePersistent<Tab>('ticker:tab', 'trades');
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
  const tabs: { value: Tab; label: string }[] = [
    { value: 'trades', label: `Transactions${p.trades.length ? ` ${p.trades.length}` : ''}` },
    { value: 'lots', label: `Lots${p.lots?.length ? ` ${p.lots.length}` : ''}` },
    { value: 'sales', label: `Sales${p.sales.length ? ` ${p.sales.length}` : ''}` },
    { value: 'dividends', label: `Dividends${dividends.length ? ` ${dividends.length}` : ''}` },
    { value: 'sell', label: 'If sold today' },
  ];

  return (
    <div className={result.loading ? 'opacity-80' : ''}>
      <PageTitle
        title={
          <>
            {p.ticker}
            {p.security.name && <span className="ml-3 text-[17px] font-medium text-muted">{p.security.name}</span>}
          </>
        }
        above={<Link className="mb-2 inline-block text-[13px] font-semibold text-muted hover:text-ink" to="/">← Overview</Link>}
        aside={<RangeSelector value={range} onChange={setRange} min={p.firstDate} max={config.data?.today} />}
      >
        {[p.security.assetType, p.security.sector].filter(Boolean).join(' · ')}
      </PageTitle>
      {p.security.status !== 'ok' && (
        <div className="mb-5">
          <Notice tone="warn" title={`Prices ${p.security.status}`}>
            {p.security.lastError ?? 'Price history has not loaded yet.'} A holding without prices is valued at cost.
          </Notice>
        </div>
      )}
      {p.oversells.length > 0 && (
        <div className="mb-5">
          <Notice tone="warn" title="A sale exceeds the shares held">
            The ledger clamps it to shares available. Review Data health for missing transactions.
          </Notice>
        </div>
      )}

      <StatRow cols={4}>
        <Stat label="Shares" value={shares(h?.shares ?? 0)} />
        <Stat label="Value" value={money(h?.equity ?? 0)} />
        <Stat label="Cost basis" value={money(h?.totalCost ?? 0)} sub={h?.shares ? `${money(h.avgCost, { precise: true })} a share` : undefined} />
        <Stat label="Unrealized gain" value={money(h?.gain ?? 0, { signed: true })} sub={h?.gain != null && h.totalCost ? pct(h.gainPct) : undefined} tone={tone(h?.gain)} />
      </StatRow>
      <p className="tnum mt-2.5 text-[13px] text-muted">Position at {date(p.to)}, for the accounts selected in the top bar.</p>

      <Section
        title="Price and trades"
        info={
          <>
            Split-adjusted closes, with your buys and sells marked at the price you paid. Hover a marker for the day. Weekend trades are marked on the next price date.
            {p.splits.length > 0 && ` Splits: ${p.splits.map((s) => `${s.ratio}-for-1 on ${date(s.exDate)}${s.source === 'manual' ? ' (manual)' : ''}`).join(', ')}.`}
          </>
        }
      >
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
            height={280}
          />
        ) : (
          <Empty title="No prices in this range">Try a wider range, or check Data health.</Empty>
        )}
      </Section>

      <div className="mt-10">
        <Segmented<Tab> label="Detail" value={tab} onChange={setTab} options={tabs} size="md" />
      </div>
      <div className="mt-4">
        {tab === 'trades' && (
          p.trades.length ? <Table caption={`${ticker} entered transactions`} rows={p.trades} rowKey={(t) => t.id} columns={[
            { key: 'date', label: 'Date', render: (t) => <span className="num">{date(t.date)}</span> },
            { key: 'type', label: 'Type', render: (t) => <span className={t.type === 'Sell' ? 'font-medium' : 'text-muted'}>{t.type}</span> },
            { key: 'account', label: 'Account', render: (t) => <span className="text-muted">{t.account || '(no account)'}</span> },
            { key: 'shares', label: 'Shares', numeric: true, render: (t) => shares(t.shares) },
            { key: 'price', label: 'Price', numeric: true, render: (t) => money(t.price, { precise: true }) },
            { key: 'amount', label: 'Amount', numeric: true, render: (t) => money(t.shares * t.price) },
            { key: 'note', label: 'Note', render: (t) => <span className="text-muted">{t.note}</span>, className: 'hidden lg:table-cell' },
          ]} /> : <Empty title="No entered trades in this range">Entered trades keep their original shares and prices.</Empty>
        )}
        {tab === 'lots' && (
          method !== 'fifo' ? (
            <p className="border-y border-rule py-3 text-[14px] text-muted">
              Average cost pools purchases.{' '}
              <button className="cursor-pointer font-medium text-accent hover:underline" onClick={() => setMethod('fifo')}>
                Switch to FIFO
              </button>{' '}
              to see the remaining lots per account.
            </p>
          ) : p.lots?.length ? (
            <Table
              caption="Remaining FIFO lots"
              rows={p.lots.map((l, i) => ({ ...l, i }))}
              rowKey={(l) => l.i}
              columns={[
                { key: 'date', label: 'Acquired', render: (l) => <span className="num">{date(l.acquired)}</span> },
                { key: 'account', label: 'Account', render: (l) => <span className="text-muted">{l.account || '(no account)'}</span> },
                { key: 'shares', label: 'Shares', numeric: true, render: (l) => shares(l.shares) },
                { key: 'cost', label: 'Cost', numeric: true, render: (l) => money(l.cost) },
                { key: 'avg', label: 'Cost per share', numeric: true, render: (l) => money(l.cost / l.shares, { precise: true }) },
              ]}
            />
          ) : (
            <Empty title="No remaining lots">This position is closed in the selected accounts at the end date.</Empty>
          )
        )}
        {tab === 'sales' && (
          p.sales.length ? <Table caption={`${ticker} realized gains`} rows={p.sales} rowKey={(s) => s.txId} columns={[
            { key: 'date', label: 'Sold', render: (s) => <span className="num">{date(s.date)}</span> },
            { key: 'account', label: 'Account', render: (s) => <span className="text-muted">{s.account || '(no account)'}</span> },
            { key: 'shares', label: 'Shares sold', numeric: true, render: (s) => shares(s.sharesSold) },
            { key: 'proceeds', label: 'Proceeds', numeric: true, render: (s) => money(s.proceeds) },
            { key: 'cost', label: 'Cost removed', numeric: true, render: (s) => <span className="text-muted">{money(s.costRemoved)}</span> },
            { key: 'gain', label: 'Gain', numeric: true, render: (s) => <span className={`font-medium ${tone(s.gain)}`}>{money(s.gain, { signed: true })}</span> },
            { key: 'pct', label: 'Gain %', numeric: true, render: (s) => <span className={tone(s.gain)}>{pct(s.gainPct)}</span> },
          ]} /> : <Empty title="No sales in this range" />
        )}
        {tab === 'dividends' && (
          <>
            {dividends.length ? <Table caption={`${ticker} dividends and reinvestments`} rows={dividends.map((d, i) => ({ ...d, i }))} rowKey={(d) => d.i} columns={[
              { key: 'date', label: 'Ex-date', render: (d) => <span className="num">{date(d.date)}</span> },
              { key: 'account', label: 'Account', render: (d) => <span className="text-muted">{d.account || '(no account)'}</span> },
              { key: 'amount', label: 'Amount', numeric: true, render: (d) => <span className="text-gain">{money(d.amount)}</span> },
              { key: 'shares', label: 'Shares bought', numeric: true, render: (d) => d.reinvestedShares === null ? <span className="text-faint">—</span> : shares(d.reinvestedShares) },
              { key: 'reason', label: 'Treatment', render: (d) => <span className="text-muted">{d.reason}</span> },
            ]} /> : <Empty title="No dividends in this range" />}
          </>
        )}
        {tab === 'sell' && <SellPreview key={`${p.ticker}:${JSON.stringify(selected)}`} input={p.sellPreview} method={method} />}
      </div>
    </div>
  );
}
