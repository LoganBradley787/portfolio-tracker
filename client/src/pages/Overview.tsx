// The statement: what it is worth, what it did, what is held.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Holding, HoldingTotals } from '../../../src/engine/holdings.ts';
import type { Oversell } from '../../../src/engine/costBasis.ts';
import type { Allocation } from '../../../src/engine/allocation.ts';
import { Flag } from '../components/Flag.tsx';
import { TickerLink } from '../components/TickerLink.tsx';
import { axisMoney, LineChartFrame, useChartColors } from '../components/charts.tsx';
import { WhatMoved } from '../components/WhatMoved.tsx';
import { RangeSelector } from '../components/RangeSelector.tsx';
import { rangeQuery } from '../lib/range.ts';
import { usePersistentRange } from '../lib/usePersistentRange.ts';
import { SetupScreen } from '../components/SetupScreen.tsx';
import { Table, type Column } from '../components/Table.tsx';
import { Empty, ErrorLine, Notice, PageHeader, Section, Segmented, Skeleton, Stat, StatRow } from '../components/ui.tsx';
import { PORTFOLIO_TABS } from '../lib/areas.ts';
import { money, pct, shares, tone, when } from '../lib/format.ts';
import { useRefresh, type RefreshInfo } from '../lib/refresh.tsx';
import { useApi } from '../lib/useApi.ts';

export interface PortfolioResponse {
  holdings: Holding[];
  totals: HoldingTotals;
  realizedGain: number;
  realizedPlusUnrealized: number;
  dividends: number;
  totalReturn: number;
  oversells: Oversell[];
  allocation: Allocation;
  pricesAsOf: string | null;
  flagged: { ticker: string; flag: string }[];
  transactionCount: number;
  inboxWaiting: number;
  refresh: RefreshInfo;
}

type Filter = 'All' | 'Stock' | 'ETF';

export default function Overview() {
  const [filter, setFilter] = useState<Filter>('All');
  const { data, error, loading } = useApi<PortfolioResponse>(`/api/portfolio${filter === 'All' ? '' : `?assetType=${filter}`}`);
  const { poke } = useRefresh();
  // Loading the portfolio may start a background refresh; let the header notice.
  useEffect(() => {
    if (data) poke();
  }, [data, poke]);

  const header = (
    <PageHeader
      tabs={PORTFOLIO_TABS}
      controls={
        data && data.transactionCount > 0 ? (
          <Segmented<Filter>
            label="Asset type"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'All', label: 'All' },
              { value: 'Stock', label: 'Stocks' },
              { value: 'ETF', label: 'ETFs' },
            ]}
          />
        ) : undefined
      }
    />
  );

  if (error && !data) return <>{header}<ErrorLine error={error} /></>;
  if (!data) return <>{header}<OverviewSkeleton /></>;
  if (!data.refresh.hasKey && data.transactionCount === 0) return <>{header}<SetupScreen /></>;
  if (data.transactionCount === 0) {
    return (
      <>
        {header}
        <Empty title="No transactions yet">
          Copy the Transactions tab from the Google Sheet (header row included) and paste it under{' '}
          <Link to="/data/transactions" className="font-medium text-accent underline-offset-2 hover:underline">
            Activity
          </Link>
          , or add trades one at a time there.
        </Empty>
      </>
    );
  }

  const t = data.totals;
  const err = data.refresh.status.error;
  return (
    <div className={loading ? 'opacity-90 transition-opacity' : 'transition-opacity'}>
      {header}
      <div className="mb-6 space-y-2 empty:mb-0 empty:hidden">
        {!data.refresh.hasKey && (
          <Notice tone="warn" title="No Tiingo API key: every holding is valued at cost">
            Add <code className="font-mono text-xs">TIINGO_API_KEY</code> to <code className="font-mono text-xs">.env</code> and restart the server.
          </Notice>
        )}
        {data.oversells.length > 0 && (
          <Notice
            tone="loss"
            title={data.oversells.length > 1 ? `${data.oversells.length} sales sell more shares than were held` : '1 sale sells more shares than were held'}
            action={<Link to="/data/health" className="shrink-0 text-[13px] font-medium text-accent hover:underline">Review</Link>}
          >
            {data.oversells
              .slice(0, 3)
              .map((o) => `${o.ticker} on ${o.date}: sold ${shares(o.requested)}, held ${shares(o.held)}`)
              .join(' · ')}
            {data.oversells.length > 3 ? ' · …' : ''}. Each was clamped to the shares held.
          </Notice>
        )}
        {err && (
          <Notice tone="loss" title="Couldn’t refresh prices. Showing the last saved data.">
            {err.message}
            {err.kind === 'rate-limit' ? '. Tiingo’s free tier allows 50 requests an hour; it will retry later.' : '.'}
          </Notice>
        )}
        {data.inboxWaiting > 0 && (
          <Notice
            tone="warn"
            title={`${data.inboxWaiting} file${data.inboxWaiting > 1 ? 's' : ''} in the drop folder could not be imported`}
            action={<Link to="/data/inbox" className="shrink-0 text-[13px] font-medium text-accent hover:underline">Drop folder</Link>}
          >
            Nothing was added from {data.inboxWaiting > 1 ? 'them' : 'it'}. The drop folder page says why.
          </Notice>
        )}
        {data.flagged.length > 0 && (
          <Notice
            tone="warn"
            title={`${data.flagged.length} holding${data.flagged.length > 1 ? 's have' : ' has'} no live price`}
            action={<Link to="/data/health" className="shrink-0 text-[13px] font-medium text-accent hover:underline">Data health</Link>}
          >
            {data.flagged.map((f) => f.ticker).join(', ')}: valued at the last stored close, or at cost.
          </Notice>
        )}
      </div>

      <Statement data={data} />

      <div className="mt-10 grid grid-cols-1 gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ValueChart />
        <WhatMoved />
      </div>

      <Section title="Holdings" count={data.holdings.length} className="mt-12">
        {data.holdings.length ? (
          <HoldingsTable holdings={data.holdings} totals={t} />
        ) : (
          <Empty title={`No ${filter === 'ETF' ? 'ETF' : 'stock'} holdings`}>Switch the filter back to All.</Empty>
        )}
      </Section>
    </div>
  );
}

/** The one bold thing on the page: the market value, with today's move beside it, over a ruled row of the rest. */
function Statement({ data }: { data: PortfolioResponse }) {
  const t = data.totals;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className="figure text-[48px] text-ink sm:text-[60px]">{money(t.equity)}</span>
        <span className={`num text-[20px] font-semibold ${tone(t.dayChange)}`}>
          {money(t.dayChange, { signed: true })} <span className="font-medium">({pct(t.dayChangePct)})</span>
          <span className="ml-2 text-[15px] font-medium text-muted">today</span>
        </span>
      </div>
      <p className="tnum mt-2.5 text-[14px] text-muted">Prices as of {when(data.pricesAsOf)}</p>
      <StatRow cols={5} className="mt-6">
        <Stat label="Cost basis" value={money(t.cost)} />
        <Stat label="Unrealized gain" value={money(t.gain, { signed: true })} sub={pct(t.gainPct)} tone={tone(t.gain)} />
        <Stat label="Realized gain" value={money(data.realizedGain, { signed: true })} tone={tone(data.realizedGain)} />
        <Stat label="Dividends" value={money(data.dividends, { signed: true })} tone={tone(data.dividends)} />
        <Stat label="Total return" value={money(data.totalReturn, { signed: true })} tone={tone(data.totalReturn)} />
      </StatRow>
    </div>
  );
}

function HoldingsTable({ holdings, totals: t }: { holdings: Holding[]; totals: HoldingTotals }) {
  const maxWeight = Math.max(...holdings.map((h) => h.pctOfEquity), 1e-9);
  const columns: Column<Holding>[] = [
    {
      key: 'ticker',
      label: 'Ticker',
      sort: (h) => h.ticker,
      render: (h) => (
        <span className="inline-flex items-center whitespace-nowrap">
          <TickerLink ticker={h.ticker} />
          {h.assetType === 'ETF' && <span className="ml-1.5 text-[12px] font-medium text-faint">ETF</span>}
          <Flag flag={h.flag} />
        </span>
      ),
      total: 'Total',
    },
    { key: 'shares', label: 'Shares', numeric: true, sort: (h) => h.shares, render: (h) => <span className="text-muted">{shares(h.shares)}</span> },
    { key: 'avg', label: 'Avg cost', numeric: true, sort: (h) => h.avgCost, render: (h) => <span className="text-muted">{money(h.avgCost, { precise: true })}</span>, className: 'hidden lg:table-cell' },
    {
      key: 'price',
      label: 'Price',
      numeric: true,
      sort: (h) => h.price,
      render: (h) => (
        <span title={h.priceSource === 'cost' ? 'No price: valued at average cost' : `${h.priceSource === 'quote' ? 'Live quote' : 'Close'} · ${when(h.priceAsOf)}`} className={h.priceSource === 'cost' ? 'text-muted italic' : ''}>
          {money(h.price)}
        </span>
      ),
    },
    { key: 'equity', label: 'Value', numeric: true, sort: (h) => h.equity, render: (h) => <span className="font-semibold">{money(h.equity)}</span>, total: money(t.equity) },
    { key: 'cost', label: 'Cost', numeric: true, sort: (h) => h.totalCost, render: (h) => <span className="text-muted">{money(h.totalCost)}</span>, total: money(t.cost), className: 'hidden lg:table-cell' },
    {
      key: 'gain',
      label: 'Gain',
      numeric: true,
      sort: (h) => h.gain,
      render: (h) => <span className={`font-medium ${tone(h.gain)}`}>{money(h.gain, { signed: true })}</span>,
      total: <span className={tone(t.gain)}>{money(t.gain, { signed: true })}</span>,
    },
    {
      key: 'gainPct',
      label: 'Gain %',
      numeric: true,
      sort: (h) => h.gainPct,
      render: (h) => <span className={tone(h.gain)}>{pct(h.gainPct)}</span>,
      total: <span className={tone(t.gain)}>{pct(t.gainPct)}</span>,
    },
    {
      key: 'day',
      label: 'Today',
      numeric: true,
      sort: (h) => h.dayChange,
      render: (h) => <span className={tone(h.dayChange)}>{money(h.dayChange, { signed: true })}</span>,
      total: <span className={tone(t.dayChange)}>{money(t.dayChange, { signed: true })}</span>,
      className: 'hidden md:table-cell',
    },
    {
      key: 'dayPct',
      label: 'Today %',
      numeric: true,
      sort: (h) => h.dayChangePct,
      render: (h) => <span className={tone(h.dayChange)}>{pct(h.dayChangePct)}</span>,
      total: <span className={tone(t.dayChange)}>{pct(t.dayChangePct)}</span>,
      className: 'hidden xl:table-cell',
    },
    {
      key: 'weight',
      label: 'Weight',
      numeric: true,
      sort: (h) => h.pctOfEquity,
      render: (h) => (
        <span className="inline-flex items-center justify-end gap-3" title={`${pct(h.pctOfCost, { signed: false })} of cost`}>
          <span className="w-14 font-medium">{pct(h.pctOfEquity, { signed: false })}</span>
          {/* The bar grows to the right and closes the row, scaled to the largest position. */}
          <span aria-hidden className="h-3 w-24 overflow-hidden rounded-[2px] bg-rule/80">
            <span className="block h-full bg-ink/80" style={{ width: `${Math.min(100, (h.pctOfEquity / maxWeight) * 100)}%` }} />
          </span>
        </span>
      ),
      total: <span className="inline-flex items-center justify-end gap-3"><span className="w-14">100.00%</span><span className="w-24" /></span>,
      className: 'hidden lg:table-cell',
    },
  ];
  return <Table caption="Holdings" rows={holdings} columns={columns} rowKey={(h) => h.ticker} initialSort={{ key: 'equity', dir: 'desc' }} showTotals />;
}

function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading portfolio">
      <div className="h-16 w-80 animate-pulse rounded-sm bg-surface-2" />
      <div className="mt-6 h-[84px] animate-pulse rounded-sm bg-surface-2" />
      <div className="mt-10">
        <Skeleton rows={8} />
      </div>
    </div>
  );
}

/** The market value over a range: the line alone. Trades and dividends are on the Chart page. */
function ValueChart() {
  const config = useApi<{ today: string }>('/api/config');
  const [range, setRange] = usePersistentRange('overview', { preset: '1Y' });
  const today = config.data?.today;
  const { data } = useApi<{ firstDate: string | null; days: { date: string; value: number; incomplete: boolean }[]; summary: { gain: number } }>(
    today ? `/api/series${rangeQuery(range, today)}` : null,
  );
  const c = useChartColors();
  return (
    <Section
      flush
      title="Value"
      info="Market value of the selected accounts at each day’s close. The gain over the range counts dividends and leaves out money added or taken out. For trades, dividends and zooming, use the Chart tab."
      aside={
        <span className="flex flex-wrap items-center gap-3">
          {data && data.days.length > 0 && (
            <span className={`num text-[15px] font-semibold ${tone(data.summary.gain)}`}>{money(data.summary.gain, { signed: true })}</span>
          )}
          <RangeSelector value={range} onChange={setRange} min={data?.firstDate} max={today} compact />
        </span>
      }
    >
      {!data ? (
        <div className="h-[280px] animate-pulse rounded-sm bg-surface-2" />
      ) : data.days.length ? (
        <LineChartFrame
          label="Portfolio market value"
          rows={data.days.map((d) => ({ date: d.date, incomplete: d.incomplete, value: d.value }))}
          series={[{ key: 'value', label: 'Market value', color: c.s1, area: true, format: (v) => money(v) }]}
          yFormat={axisMoney}
          height={280}
        />
      ) : (
        <Empty title="No trading days in this range">Pick a wider range.</Empty>
      )}
    </Section>
  );
}
