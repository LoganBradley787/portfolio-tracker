import type { SoonLot } from '../../../src/engine/sellPreview.ts';
import { TurningLongTermSoon } from '../components/TurningLongTermSoon.tsx';
import { TickerLink } from '../components/TickerLink.tsx';
import { useState } from 'react';
import type { DividendEvent, Sale } from '../../../src/engine/costBasis.ts';
import { Table, type Column } from '../components/Table.tsx';
import { Button, Empty, ErrorLine, Notice, PageTitle, Section, Segmented, Skeleton } from '../components/ui.tsx';
import { date, money, pct, shares, tone } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { useMethod } from '../lib/method.tsx';
import { useAccount } from '../lib/account.tsx';
import type { DividendYear, TaxYear } from '../../../src/engine/realized.ts';

interface RealizedResponse {
  sales: Sale[];
  totalProceeds: number;
  totalCostRemoved: number;
  totalGain: number;
  realizedPlusUnrealized: number;
  unrealizedGain: number;
  dividends: number;
  totalReturn: number;
  dividendEvents: (DividendEvent & { reinvestedShares: number | null; reinvestPrice: number | null })[];
  dividendYears: DividendYear[];
  taxYears: TaxYear[] | null;
  turningLongTermSoon: SoonLot[];
}

type Filter = 'All' | 'Stock' | 'ETF';

export default function Realized() {
  const [filter, setFilter] = useState<Filter>('All');
  const [view, setView] = useState<'sales' | 'dividends' | 'tax'>('sales');
  const { method, setMethod } = useMethod();
  const { selected } = useAccount();
  const { data, error } = useApi<RealizedResponse>(`/api/realized${filter === 'All' ? '' : `?assetType=${filter}`}`);

  const columns: Column<Sale>[] = [
    { key: 'date', label: 'Date', sort: (s) => `${s.date}#${String(s.seq).padStart(9, '0')}`, render: (s) => <span className="num whitespace-nowrap">{date(s.date)}</span>, total: 'Total' },
    { key: 'ticker', label: 'Ticker', sort: (s) => s.ticker, render: (s) => <TickerLink ticker={s.ticker} /> },
    { key: 'account', label: 'Account', sort: (s) => s.account, render: (s) => <span className="text-muted">{s.account || '—'}</span>, className: 'hidden md:table-cell' },
    {
      key: 'shares',
      label: 'Shares',
      numeric: true,
      sort: (s) => s.sharesSold,
      render: (s) => (
        <span title={s.sharesSold !== s.shares ? `Recorded ${shares(s.shares)}; clamped to the ${shares(s.sharesSold)} held` : undefined} className={s.sharesSold !== s.shares ? 'text-warn' : ''}>
          {shares(s.sharesSold)}
        </span>
      ),
    },
    { key: 'price', label: 'Sale price', numeric: true, sort: (s) => s.price, render: (s) => money(s.price, { precise: true }) },
    { key: 'avg', label: 'Avg buy', numeric: true, sort: (s) => s.avgBuyPrice, render: (s) => money(s.avgBuyPrice, { precise: true }), className: 'hidden lg:table-cell' },
    { key: 'proceeds', label: 'Proceeds', numeric: true, sort: (s) => s.proceeds, render: (s) => money(s.proceeds), total: money(data?.totalProceeds), className: 'hidden sm:table-cell' },
    { key: 'cost', label: 'Cost', numeric: true, sort: (s) => s.costRemoved, render: (s) => money(s.costRemoved), total: money(data?.totalCostRemoved), className: 'hidden sm:table-cell' },
    {
      key: 'gain',
      label: 'Gain',
      numeric: true,
      sort: (s) => s.gain,
      render: (s) => <span className={tone(s.gain)}>{money(s.gain, { signed: true })}</span>,
      total: <span className={tone(data?.totalGain)}>{money(data?.totalGain, { signed: true })}</span>,
    },
    { key: 'gps', label: 'Per share', numeric: true, sort: (s) => s.gainPerShare, render: (s) => <span className={tone(s.gain)}>{money(s.gainPerShare, { signed: true, precise: true })}</span>, className: 'hidden xl:table-cell' },
    {
      key: 'gainPct',
      label: 'Gain %',
      numeric: true,
      sort: (s) => s.gainPct,
      render: (s) => <span className={tone(s.gain)}>{pct(s.gainPct)}</span>,
      total: <span className={tone(data?.totalGain)}>{data && data.totalCostRemoved ? pct(data.totalGain / data.totalCostRemoved) : ''}</span>,
    },
  ];

  return (
    <div>
      <PageTitle
        title="Realized gains"
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
        {method === 'fifo' ? 'Every sale, FIFO: each account’s oldest shares are sold first.' : selected === null ? 'Every sale, at average cost pooled per ticker across accounts.' : selected.length === 1 ? `Every sale in ${selected[0] || '(no account)'}, at this account’s own average cost.` : `Every sale in ${selected.map((a) => a || '(no account)').join(', ')}, at average cost pooled per ticker across them.`}
      </PageTitle>
      <div className="mb-4">
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'sales', label: 'Sales' },
            { value: 'dividends', label: 'Dividends' },
            { value: 'tax', label: 'By tax year' },
          ]}
        />
      </div>
      <ErrorLine error={error && !data ? error : null} />
      {!data ? (
        !error && <Skeleton />
      ) : (
        <>
          <dl className="mb-6 grid grid-cols-2 border-y border-rule-strong sm:grid-cols-5 sm:divide-x sm:divide-rule">
            {[
              ['Realized gain', money(data.totalGain, { signed: true }), tone(data.totalGain)],
              ['Unrealized gain', money(data.unrealizedGain, { signed: true }), tone(data.unrealizedGain)],
              ['Dividends', money(data.dividends, { signed: true }), tone(data.dividends)],
              ['Total return', money(data.totalReturn, { signed: true }), tone(data.totalReturn)],
              ['Sales', String(data.sales.length), ''],
            ].map(([label, value, cls]) => (
              <div key={label} className="py-3 pr-4 sm:px-4 sm:first:pl-0">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className={`num mt-0.5 text-lg font-semibold tracking-tight ${cls}`}>{value}</dd>
              </div>
            ))}
          </dl>
          {view === 'dividends' ? (
            <Dividends events={data.dividendEvents} years={data.dividendYears} />
          ) : view === 'tax' ? (
            method !== 'fifo' ? (
              <Notice
                tone="info"
                title="The tax-year view needs FIFO"
                action={
                  <Button size="sm" variant="primary" onClick={() => setMethod('fifo')}>
                    Switch to FIFO
                  </Button>
                }
              >
                Short- and long-term gains depend on which lots were sold, which average cost does not track.
              </Notice>
            ) : (
              <TaxYears years={data.taxYears ?? []} dividendYears={data.dividendYears} />
            )
          ) : data.sales.length ? (
            <Table caption="Sales" rows={data.sales} columns={columns} rowKey={(s) => s.txId} initialSort={{ key: 'date', dir: 'desc' }} showTotals />
          ) : (
            <Empty title="No sales yet">Sales appear here as soon as a Sell transaction is recorded.</Empty>
          )}
          <TurningLongTermSoon lots={data.turningLongTermSoon} />
        </>
      )}
    </div>
  );
}

function TaxYears({ years: saleYears, dividendYears }: { years: TaxYear[]; dividendYears: DividendYear[] }) {
  const divs = new Map(dividendYears.map((d) => [d.year, d.total]));
  const empty = (year: number): TaxYear => ({ year, shortTerm: { proceeds: 0, cost: 0, gain: 0 }, longTerm: { proceeds: 0, cost: 0, gain: 0 }, total: 0, lots: [] });
  const byYear = new Map(saleYears.map((y) => [y.year, y]));
  const years = [...new Set([...byYear.keys(), ...divs.keys()])].sort((a, b) => b - a).map((y) => byYear.get(y) ?? empty(y));
  if (!years.length) return <Empty title="No sales or dividends yet" />;
  return (
    <div>
      <p className="mb-4 max-w-prose text-xs text-muted">
        Not tax advice. Wash sales, fees and corporate actions other than splits are ignored. Lots are kept per account; long-term means held more than one year. Dividends are counted in the year of their ex-date (the pay date can fall later) and are not split into qualified and ordinary.
      </p>
      {years.map((y) => (
        <Section key={y.year} title={String(y.year)}>
          <dl className="mb-3 grid grid-cols-2 border-y border-rule-strong sm:grid-cols-4 sm:divide-x sm:divide-rule">
            {[
              ['Short-term gains', y.shortTerm.gain],
              ['Long-term gains', y.longTerm.gain],
              ['Dividends', divs.get(y.year) ?? 0],
              ['Total', y.total + (divs.get(y.year) ?? 0)],
            ].map(([k, v]) => (
              <div key={k as string} className="py-2.5 pr-4 sm:px-4 sm:first:pl-0">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className={`num mt-0.5 text-base font-semibold ${tone(v as number)}`}>{money(v as number, { signed: true })}</dd>
              </div>
            ))}
          </dl>
          {y.lots.length > 0 && (
          <Table
            caption={`Lots sold in ${y.year}`}
            rows={y.lots.map((l, i) => ({ ...l, i }))}
            rowKey={(l) => l.i}
            initialSort={{ key: 'sold', dir: 'asc' }}
            showTotals
            columns={[
              { key: 'sold', label: 'Sold', sort: (l) => l.saleDate + String(l.i).padStart(6, '0'), render: (l) => <span className="num whitespace-nowrap">{date(l.saleDate)}</span>, total: 'Total' },
              { key: 'ticker', label: 'Ticker', sort: (l) => l.ticker, render: (l) => <TickerLink ticker={l.ticker} /> },
              { key: 'account', label: 'Account', render: (l) => <span className="text-muted">{l.account || '—'}</span>, className: 'hidden md:table-cell' },
              { key: 'acquired', label: 'Acquired', sort: (l) => l.acquired, render: (l) => <span className="num whitespace-nowrap">{date(l.acquired)}</span>, className: 'hidden sm:table-cell' },
              { key: 'term', label: 'Term', sort: (l) => l.term, render: (l) => <span className="text-muted">{l.term === 'long' ? 'Long' : 'Short'}</span> },
              { key: 'shares', label: 'Shares', numeric: true, render: (l) => shares(l.shares) },
              { key: 'proceeds', label: 'Proceeds', numeric: true, render: (l) => money(l.proceeds), total: money(y.shortTerm.proceeds + y.longTerm.proceeds), className: 'hidden sm:table-cell' },
              { key: 'cost', label: 'Cost', numeric: true, render: (l) => money(l.cost), total: money(y.shortTerm.cost + y.longTerm.cost), className: 'hidden sm:table-cell' },
              {
                key: 'gain',
                label: 'Gain',
                numeric: true,
                sort: (l) => l.gain,
                render: (l) => <span className={tone(l.gain)}>{money(l.gain, { signed: true })}</span>,
                total: <span className={tone(y.total)}>{money(y.total, { signed: true })}</span>,
              },
            ]}
          />
          )}
        </Section>
      ))}
    </div>
  );
}

function Dividends({ events, years }: { events: RealizedResponse['dividendEvents']; years: DividendYear[] }) {
  if (!events.length) {
    return <Empty title="No dividends yet">Dividends are booked on each ex-date for the shares held going into it, from the dividend data Tiingo sends with prices.</Empty>;
  }
  return (
    <div>
      <p className="mb-3 max-w-prose text-[13px] text-muted">
        Every dividend is reinvested: on the ex-date, the shares held going into it are paid, and the money buys more of the same ticker at that day’s close, in the same account. Your broker buys on the pay date, a few days to weeks later, so its share counts can differ slightly. Reinvested shares earn later dividends and cost what was reinvested. Don’t enter the broker’s reinvestment buys as transactions, or they’ll be counted twice.
      </p>
      <dl className="mb-6 flex flex-wrap gap-x-8 gap-y-2 border-y border-rule py-3">
        {years.map((y) => (
          <div key={y.year}>
            <dt className="text-xs text-muted">{y.year}</dt>
            <dd className="num mt-0.5 font-semibold text-gain">{money(y.total, { signed: true })}</dd>
          </div>
        ))}
      </dl>
      <Table
        caption="Dividends received"
        rows={events.map((e, i) => ({ ...e, i }))}
        rowKey={(e) => e.i}
        initialSort={{ key: 'date', dir: 'desc' }}
        showTotals
        columns={[
          { key: 'date', label: 'Ex-date', sort: (e) => e.date, render: (e) => <span className="num whitespace-nowrap">{date(e.date)}</span>, total: 'Total' },
          { key: 'ticker', label: 'Ticker', sort: (e) => e.ticker, render: (e) => <TickerLink ticker={e.ticker} /> },
          { key: 'shares', label: 'Shares', numeric: true, sort: (e) => e.shares, render: (e) => shares(e.shares), className: 'hidden sm:table-cell' },
          { key: 'per', label: 'Per share', numeric: true, sort: (e) => e.perShare, render: (e) => money(e.perShare, { precise: true }), className: 'hidden sm:table-cell' },
          {
            key: 'amount',
            label: 'Amount',
            numeric: true,
            sort: (e) => e.amount,
            render: (e) => <span className="text-gain">{money(e.amount, { signed: true })}</span>,
            total: <span className="text-gain">{money(events.reduce((a, e) => a + e.amount, 0), { signed: true })}</span>,
          },
          {
            key: 'bought',
            label: 'Reinvested',
            title: 'Shares bought with the dividend, at the ex-date close',
            numeric: true,
            sort: (e) => e.reinvestedShares ?? -1,
            render: (e) =>
              e.reinvestedShares === null ? (
                <span className="text-muted" title="No close near the ex-date, or the position was sold that day">Kept as cash</span>
              ) : (
                <span className="num whitespace-nowrap">
                  {shares(e.reinvestedShares)} <span className="text-muted">@ {money(e.reinvestPrice!, { precise: true })}</span>
                </span>
              ),
            className: 'hidden md:table-cell',
          },
        ]}
      />
    </div>
  );
}
