// The statement: what it is worth, what it did, what is held.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Holding, HoldingTotals } from '../../../src/engine/holdings.ts';
import type { Oversell } from '../../../src/engine/costBasis.ts';
import type { Allocation } from '../../../src/engine/allocation.ts';
import { Flag } from '../components/Flag.tsx';
import { TickerLink } from '../components/TickerLink.tsx';
import { axisMoney, GainBar, LineChartFrame, useChartColors, type Marker } from '../components/charts.tsx';
import { WhatMoved } from '../components/WhatMoved.tsx';
import { RangeSelector } from '../components/RangeSelector.tsx';
import { rangeQuery } from '../lib/range.ts';
import { usePersistent, usePersistentRange } from '../lib/usePersistentRange.ts';
import { SetupScreen } from '../components/SetupScreen.tsx';
import { Table, type Column } from '../components/Table.tsx';
import { Button, Empty, ErrorLine, Notice, PageHeader, Section, Segmented, Skeleton, Stat, StatRow } from '../components/ui.tsx';
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
          <Link to="/activity/transactions" className="font-medium text-accent underline-offset-2 hover:underline">
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

      <div className="mt-8 grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <ValueChart />
        <WhatMoved />
      </div>

      <Section title="Holdings" count={data.holdings.length} className="mt-10">
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
      <p className="text-xs text-muted">Market value</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className="figure text-[44px] text-ink sm:text-[52px]">{money(t.equity)}</span>
        <span className={`num text-[17px] font-medium ${tone(t.dayChange)}`}>
          {money(t.dayChange, { signed: true })} <span className="font-normal">({pct(t.dayChangePct)})</span>
          <span className="ml-1.5 text-[13px] font-normal text-muted">today</span>
        </span>
      </div>
      <p className="tnum mt-2 text-xs text-muted">
        Prices as of {when(data.pricesAsOf)} · {data.holdings.length} holdings: {t.counts.gain} up, {t.counts.loss} down, {t.counts.neutral} within ±5%
      </p>
      <StatRow cols={5} className="mt-5">
        <Stat label="Cost basis" value={money(t.cost)} />
        <Stat label="Unrealized gain" value={money(t.gain, { signed: true })} sub={pct(t.gainPct)} tone={tone(t.gain)} />
        <Stat label="Realized gain" value={money(data.realizedGain, { signed: true })} tone={tone(data.realizedGain)} />
        <Stat label="Dividends" value={money(data.dividends, { signed: true })} tone={tone(data.dividends)} />
        <Stat label="Total return" value={money(data.totalReturn, { signed: true })} sub="realized + unrealized + dividends" tone={tone(data.totalReturn)} />
      </StatRow>
    </div>
  );
}

function HoldingsTable({ holdings, totals: t }: { holdings: Holding[]; totals: HoldingTotals }) {
  const maxGain = Math.max(...holdings.map((h) => Math.abs(h.gainPct ?? 0)), 1e-9);
  const columns: Column<Holding>[] = [
    {
      key: 'ticker',
      label: 'Ticker',
      sort: (h) => h.ticker,
      render: (h) => (
        <span className="inline-flex items-center whitespace-nowrap">
          <TickerLink ticker={h.ticker} />
          {h.assetType === 'ETF' && <span className="ml-1.5 text-[11px] text-faint">ETF</span>}
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
    { key: 'equity', label: 'Value', numeric: true, sort: (h) => h.equity, render: (h) => <span className="font-medium">{money(h.equity)}</span>, total: money(t.equity) },
    { key: 'cost', label: 'Cost', numeric: true, sort: (h) => h.totalCost, render: (h) => <span className="text-muted">{money(h.totalCost)}</span>, total: money(t.cost), className: 'hidden lg:table-cell' },
    {
      key: 'gain',
      label: 'Gain',
      numeric: true,
      sort: (h) => h.gain,
      render: (h) => <span className={tone(h.gain)}>{money(h.gain, { signed: true })}</span>,
      total: <span className={tone(t.gain)}>{money(t.gain, { signed: true })}</span>,
    },
    {
      key: 'gainPct',
      label: 'Gain %',
      numeric: true,
      sort: (h) => h.gainPct,
      render: (h) => (
        <span className="inline-flex items-center justify-end gap-2">
          <GainBar value={h.gainPct ?? 0} max={maxGain} className="hidden h-3 w-16 sm:block" />
          {/* Fixed width, so every row's bar starts from the same zero line. */}
          <span className={`w-[5.5rem] text-right ${tone(h.gain)}`}>{pct(h.gainPct)}</span>
        </span>
      ),
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
        <span className="inline-flex items-center justify-end gap-2" title={`${pct(h.pctOfCost, { signed: false })} of cost`}>
          <span aria-hidden className="h-1 w-12 overflow-hidden rounded-full bg-rule">
            <span className="block h-full rounded-full bg-ink/50" style={{ width: `${Math.min(100, h.pctOfEquity * 100)}%` }} />
          </span>
          <span className="w-12 text-muted">{pct(h.pctOfEquity, { signed: false })}</span>
        </span>
      ),
      className: 'hidden lg:table-cell',
    },
  ];
  return <Table caption="Holdings" rows={holdings} columns={columns} rowKey={(h) => h.ticker} initialSort={{ key: 'equity', dir: 'desc' }} showTotals />;
}

function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading portfolio">
      <div className="h-14 w-72 animate-pulse rounded-sm bg-surface-2" />
      <div className="mt-6 h-[66px] animate-pulse rounded-sm bg-surface-2" />
      <div className="mt-10">
        <Skeleton rows={8} />
      </div>
    </div>
  );
}

interface DayEvents {
  date: string;
  buys: string[];
  sells: string[];
  splits: string[];
}

function ValueChart() {
  const config = useApi<{ today: string }>('/api/config');
  const [range, setRange] = usePersistentRange('overview', { preset: '1Y' });
  const [trades, setTrades] = usePersistent('overviewTrades', true);
  const today = config.data?.today;
  const { data } = useApi<{ firstDate: string | null; days: { date: string; value: number; incomplete: boolean; dividends: number }[]; events: DayEvents[]; summary: { gain: number } }>(
    today ? `/api/series${rangeQuery(range, today)}` : null,
  );
  const c = useChartColors();
  const events = new Map((data?.events ?? []).map((e) => [e.date, e]));
  const note = (d: { date: string; dividends: number }) => {
    const e = events.get(d.date);
    const parts = [
      e?.buys.length ? `Bought ${e.buys.join(', ')}` : '',
      e?.sells.length ? `Sold ${e.sells.join(', ')}` : '',
      e?.splits.length ? `Split: ${e.splits.join(', ')}` : '',
      d.dividends >= 0.005 ? `Dividends ${money(d.dividends)}` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : undefined;
  };
  const markers: Marker[] = !trades || !data ? [] : data.days.flatMap((d, i) => {
    const e = events.get(d.date);
    if (!e) return [];
    return (['Buy', 'Sell', 'Split'] as const)
      .filter((type) => e[type === 'Buy' ? 'buys' : type === 'Sell' ? 'sells' : 'splits'].length)
      .map((type, k) => ({ id: i * 3 + k, date: d.date, price: d.value, type }));
  });
  return (
    <Section
      flush
      title={
        <>
          Value
          {data && data.days.length > 0 && (
            <span className="tnum ml-3 font-normal text-muted">
              over the range <span className={`font-medium ${tone(data.summary.gain)}`}>{money(data.summary.gain, { signed: true })}</span>
            </span>
          )}
        </>
      }
      aside={
        <span className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" aria-pressed={trades} onClick={() => setTrades(!trades)} title={trades ? 'Hide trade markers' : 'Mark buys, sells and splits on the chart'} className={trades ? 'text-ink' : ''}>
            Trades
          </Button>
          <RangeSelector value={range} onChange={setRange} min={data?.firstDate} max={today} compact />
        </span>
      }
    >
      {!data ? (
        <div className="h-[240px] animate-pulse rounded-sm bg-surface-2" />
      ) : data.days.length ? (
        <>
          <LineChartFrame
            label="Portfolio market value"
            rows={data.days.map((d) => ({ date: d.date, incomplete: d.incomplete, value: d.value, note: note(d) }))}
            series={[{ key: 'value', label: 'Market value', color: c.s1, area: true, format: (v) => money(v) }]}
            yFormat={axisMoney}
            height={240}
            markers={markers}
            letterLimit={30}
          />
          {markers.length > 0 && (
            <p className="mt-1 text-xs text-faint">
              {markers.length > 30 ? 'Filled dots are buys, open dots sells and splits' : 'B = buy, S = sell, × = split'}, on the day’s closing value. Hover a day for the tickers and any dividends.
            </p>
          )}
        </>
      ) : (
        <Empty title="No trading days in this range">Pick a wider range.</Empty>
      )}
    </Section>
  );
}
