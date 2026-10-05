import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Holding, HoldingTotals } from '../../../src/engine/holdings.ts';
import type { Oversell } from '../../../src/engine/costBasis.ts';
import type { Allocation, Slice } from '../../../src/engine/allocation.ts';
import { Flag } from '../components/Flag.tsx';
import { TickerLink } from '../components/TickerLink.tsx';
import { axisMoney, LineChartFrame, useChartColors, type Marker } from '../components/charts.tsx';
import { WhatMoved } from '../components/WhatMoved.tsx';
import { RangeSelector } from '../components/RangeSelector.tsx';
import { rangeQuery } from '../lib/range.ts';
import { usePersistent, usePersistentRange } from '../lib/usePersistentRange.ts';
import { SetupScreen } from '../components/SetupScreen.tsx';
import { Table, type Column } from '../components/Table.tsx';
import { Button, Empty, ErrorLine, Notice, Section, Segmented, Skeleton } from '../components/ui.tsx';
import { money, pct, shares, tone, when } from '../lib/format.ts';
import { useRefresh, type RefreshInfo } from '../lib/refresh.tsx';
import { useApi } from '../lib/useApi.ts';

interface PortfolioResponse {
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

  if (error && !data) return <ErrorLine error={error} />;
  if (!data) return <OverviewSkeleton />;
  if (!data.refresh.hasKey && data.transactionCount === 0) return <SetupScreen />;
  if (data.transactionCount === 0) {
    return (
      <Empty title="No transactions yet">
        Copy the Transactions tab from the Google Sheet (header row included) and paste it on the{' '}
        <Link to="/transactions" className="font-medium text-accent underline-offset-2 hover:underline">
          Transactions
        </Link>{' '}
        page, or add trades one at a time there.
      </Empty>
    );
  }

  const t = data.totals;
  const err = data.refresh.status.error;
  return (
    <div className={loading ? 'opacity-90 transition-opacity' : 'transition-opacity'}>
      <div className="mb-5 space-y-2.5 empty:mb-0 empty:hidden">
        {!data.refresh.hasKey && (
          <Notice tone="warn" title="No Tiingo API key: every holding is valued at cost">
            Add <code className="font-mono text-xs">TIINGO_API_KEY</code> to <code className="font-mono text-xs">.env</code> and restart the server.
          </Notice>
        )}
        {data.oversells.length > 0 && (
          <Notice
            tone="loss"
            title={data.oversells.length > 1 ? `${data.oversells.length} sales sell more shares than were held` : '1 sale sells more shares than were held'}
            action={<Link to="/health" className="shrink-0 text-[13px] font-medium text-accent hover:underline">Review</Link>}
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
            action={<Link to="/health" className="shrink-0 text-[13px] font-medium text-accent hover:underline">Data health</Link>}
          >
            Nothing was added from {data.inboxWaiting > 1 ? 'them' : 'it'}. Data health says why.
          </Notice>
        )}
        {data.flagged.length > 0 && (
          <Notice
            tone="warn"
            title={`${data.flagged.length} holding${data.flagged.length > 1 ? 's have' : ' has'} no live price`}
            action={<Link to="/health" className="shrink-0 text-[13px] font-medium text-accent hover:underline">Data health</Link>}
          >
            {data.flagged.map((f) => f.ticker).join(', ')}: valued at the last stored close, or at cost.
          </Notice>
        )}
      </div>

      <Statement totals={t} realized={data.realizedGain} dividends={data.dividends} total={data.totalReturn} />
      <p className="tnum mt-2.5 text-xs text-muted">
        Prices as of {when(data.pricesAsOf)} · {data.holdings.length} holdings: {t.counts.gain} up, {t.counts.loss} down, {t.counts.neutral} within ±5%
      </p>

      <ValueChart />

      <WhatMoved />

      <Section
        title="Holdings"
        count={data.holdings.length}
        aside={
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
        }
      >
        {data.holdings.length ? (
          <HoldingsTable holdings={data.holdings} totals={t} />
        ) : (
          <Empty title={`No ${filter === 'ETF' ? 'ETF' : 'stock'} holdings`}>Switch the filter back to All.</Empty>
        )}
      </Section>

      {data.holdings.length > 0 && <AllocationSection allocation={data.allocation} />}
    </div>
  );
}

function Figure({ label, value, sub, valueClass = '', big }: { label: string; value: string; sub?: string; valueClass?: string; big?: boolean }) {
  return (
    <div className="min-w-0 py-3 pr-4 xl:px-4 xl:first:pl-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`num mt-0.5 font-semibold tracking-tight ${big ? 'text-[26px] leading-8' : 'text-lg leading-8'} ${valueClass}`}>{value}</dd>
      {sub && <dd className={`tnum text-xs ${/^[+\u2212\d]/.test(sub) ? valueClass || 'text-muted' : 'text-muted'}`}>{sub}</dd>}
    </div>
  );
}

function Statement({ totals: t, realized, dividends, total }: { totals: HoldingTotals; realized: number; dividends: number; total: number }) {
  return (
    <dl className="grid grid-cols-2 border-y border-rule-strong sm:grid-cols-4 xl:grid-cols-[1.3fr_repeat(6,1fr)] xl:divide-x xl:divide-rule">
      <Figure big label="Market value" value={money(t.equity)} />
      <Figure label="Cost basis" value={money(t.cost)} />
      <Figure label="Unrealized gain" value={money(t.gain, { signed: true })} sub={pct(t.gainPct)} valueClass={tone(t.gain)} />
      <Figure label="Today" value={money(t.dayChange, { signed: true })} sub={pct(t.dayChangePct)} valueClass={tone(t.dayChange)} />
      <Figure label="Realized gain" value={money(realized, { signed: true })} valueClass={tone(realized)} />
      <Figure label="Dividends" value={money(dividends, { signed: true })} valueClass={tone(dividends)} />
      <Figure label="Total return" value={money(total, { signed: true })} sub="realized + unrealized + dividends" valueClass={tone(total)} />
    </dl>
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
          {h.assetType === 'ETF' && <span className="ml-1.5 text-[11px] text-muted">ETF</span>}
          <Flag flag={h.flag} />
        </span>
      ),
      total: 'Total',
    },
    { key: 'shares', label: 'Shares', numeric: true, sort: (h) => h.shares, render: (h) => shares(h.shares) },
    { key: 'avg', label: 'Avg cost', numeric: true, sort: (h) => h.avgCost, render: (h) => money(h.avgCost, { precise: true }), className: 'hidden lg:table-cell' },
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
    { key: 'equity', label: 'Value', numeric: true, sort: (h) => h.equity, render: (h) => money(h.equity), total: money(t.equity) },
    { key: 'cost', label: 'Cost', numeric: true, sort: (h) => h.totalCost, render: (h) => money(h.totalCost), total: money(t.cost), className: 'hidden lg:table-cell' },
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
      render: (h) => <span className="inline-flex items-center justify-end gap-2">
        <span aria-hidden className="relative hidden h-3 w-16 sm:block">
          <span className="absolute inset-y-0 left-1/2 w-px bg-rule-strong" />
          <span className={`absolute inset-y-0.5 ${h.gain >= 0 ? 'left-1/2 bg-gain/70' : 'right-1/2 bg-loss/70'}`} style={{ width: `${Math.abs(h.gainPct ?? 0) / maxGain * 50}%` }} />
        </span>
        {/* Fixed width, so every row's bar starts from the same zero line. */}
        <span className={`w-[5.5rem] text-right ${tone(h.gain)}`}>{pct(h.gainPct)}</span>
      </span>,
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
      className: 'hidden 2xl:table-cell',
    },
    {
      key: 'divs',
      label: 'Dividends',
      title: 'Dividends received on this ticker, all time',
      numeric: true,
      sort: (h) => h.dividends,
      render: (h) => (h.dividends ? <span className="text-gain">{money(h.dividends, { signed: true })}</span> : <span className="text-muted">—</span>),
      className: 'hidden xl:table-cell',
    },
    {
      key: 'weight',
      label: 'Weight',
      numeric: true,
      sort: (h) => h.pctOfEquity,
      render: (h) => (
        <span className="inline-flex items-center justify-end gap-2" title={`${pct(h.pctOfCost, { signed: false })} of cost`}>
          <span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full rounded-full bg-accent/70" style={{ width: `${Math.min(100, h.pctOfEquity * 100)}%` }} />
          </span>
          <span className="w-12">{pct(h.pctOfEquity, { signed: false })}</span>
        </span>
      ),
      className: 'hidden lg:table-cell',
    },
  ];
  return <Table caption="Holdings" rows={holdings} columns={columns} rowKey={(h) => h.ticker} initialSort={{ key: 'gainPct', dir: 'desc' }} showTotals />;
}

function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading portfolio">
      <div className="mt-5 grid h-[74px] animate-pulse grid-cols-1 rounded bg-surface-2" />
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
      title="Value"
      aside={
        <span className="flex flex-wrap items-center gap-3">
          {data && data.days.length > 0 && (
            <span className="tnum text-xs text-muted">
              Gain over range <span className={`font-semibold ${tone(data.summary.gain)}`}>{money(data.summary.gain, { signed: true })}</span>
            </span>
          )}
          <Button size="sm" variant={trades ? 'secondary' : 'ghost'} aria-pressed={trades} onClick={() => setTrades(!trades)} title={trades ? 'Hide trade markers' : 'Mark buys, sells and splits on the chart'}>
            Trades
          </Button>
          <RangeSelector value={range} onChange={setRange} min={data?.firstDate} max={today} />
        </span>
      }
    >
      {!data ? (
        <div className="h-[220px] animate-pulse rounded bg-surface-2" />
      ) : data.days.length ? (
        <>
          <LineChartFrame
            label="Portfolio market value"
            rows={data.days.map((d) => ({ date: d.date, incomplete: d.incomplete, value: d.value, note: note(d) }))}
            series={[{ key: 'value', label: 'Market value', color: c.s1, area: true, format: (v) => money(v) }]}
            yFormat={axisMoney}
            height={220}
            markers={markers}
            letterLimit={30}
          />
          {markers.length > 0 && (
            <p className="mt-1 text-xs text-muted">
              {markers.length > 30 ? 'Blue dots are buys, grey dots sells and splits' : 'B = buy, S = sell, × = split'}, on the day’s closing value. Hover a day for the tickers and any dividends.
            </p>
          )}
        </>
      ) : (
        <Empty title="No trading days in this range">Pick a wider range.</Empty>
      )}
    </Section>
  );
}

type AllocView = 'byPosition' | 'byAssetType' | 'bySector';

function AllocationSection({ allocation }: { allocation: Allocation }) {
  const [view, setView] = usePersistent<AllocView>('allocation', 'bySector');
  const [funds, setFunds] = usePersistent<'split' | 'whole'>('allocationFunds', 'split');
  const hasFunds = allocation.bySector.some((s) => s.label === 'ETFs');
  const slices: Slice[] = view === 'bySector' && funds === 'split' ? allocation.bySectorSplit : allocation[view] ?? allocation.bySector;
  const max = Math.max(...slices.map((s) => s.pct), 1e-9);
  const unassigned = allocation.bySector.find((s) => s.label === 'Unassigned');
  return (
    <Section
      title="Allocation"
      aside={
        <Segmented<AllocView>
          label="Group by"
          value={view}
          onChange={setView}
          options={[
            { value: 'bySector', label: 'Sector' },
            { value: 'byAssetType', label: 'Asset type' },
            { value: 'byPosition', label: 'Position' },
          ]}
        />
      }
    >
      <ul className="divide-y divide-rule border-y border-rule">
        {slices.map((s) => (
          <li key={s.label} className="grid grid-cols-[minmax(7rem,14rem)_1fr_auto_auto] items-center gap-x-4 py-2 text-[13px]">
            <span className={`truncate ${s.label === 'Unassigned' ? 'text-muted italic' : 'font-medium'}`}>
              {s.label}
              {view !== 'byPosition' && <span className="ml-1.5 text-xs font-normal text-muted not-italic">{s.count}</span>}
            </span>
            <span aria-hidden className="h-3.5">
              <span className={`block h-full rounded-r-[4px] ${s.label === 'Unassigned' ? 'bg-[var(--series-muted)]' : 'bg-[var(--series-1)]'}`} style={{ width: `${(s.pct / max) * 100}%`, minWidth: 2 }} />
            </span>
            <span className="num w-24 text-right text-muted">{money(s.value)}</span>
            <span className="num w-16 text-right font-semibold">{pct(s.pct, { signed: false })}</span>
          </li>
        ))}
      </ul>
      {view === 'bySector' && hasFunds && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
          <Segmented<'split' | 'whole'>
            label="Funds"
            value={funds}
            onChange={setFunds}
            options={[
              { value: 'split', label: 'Split into sectors' },
              { value: 'whole', label: 'One group' },
            ]}
          />
          {funds === 'split' && (
            <span>
              Each fund’s value is spread across the sectors, bonds and cash it holds. Counts are holdings with money in the sector.
              {allocation.bySectorSplit.some((x) => x.label === 'ETFs') && ' Funds with no breakdown yet stay under ETFs.'}
            </span>
          )}
        </div>
      )}
      {view === 'bySector' && unassigned && (
        <p className="mt-2 text-xs text-muted">
          {unassigned.count} stock{unassigned.count > 1 ? 's have' : ' has'} no sector.{' '}
          <Link to="/securities" className="font-medium text-accent hover:underline">
            Set sectors
          </Link>
        </p>
      )}
    </Section>
  );
}
