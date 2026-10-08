// The Activity area: the ledger and what it produced. Transactions, sales,
// dividends and tax years each get a page.
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import type { SoonLot } from '../../../src/engine/sellPreview.ts';
import type { DividendEvent, Sale } from '../../../src/engine/costBasis.ts';
import type { DividendYear, TaxYear } from '../../../src/engine/realized.ts';
import type { IncomeSummary } from '../../../src/engine/income.ts';
import { Table, type Column } from '../components/Table.tsx';
import { TickerLink } from '../components/TickerLink.tsx';
import { Button, Columns, Empty, ErrorLine, Notice, PageHeader, Section, Segmented, Skeleton, Stat, StatRow } from '../components/ui.tsx';
import { ACTIVITY_TABS } from '../lib/areas.ts';
import { date, money, pct, shares, tone } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { useMethod } from '../lib/method.tsx';
import { useAccount } from '../lib/account.tsx';


export default function ActivityArea() {
  return <Outlet />;
}

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

export function Sales() {
  const [filter, setFilter] = useState<Filter>('All');
  const { method } = useMethod();
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
        <span title={s.sharesSold !== s.shares ? `Recorded ${shares(s.shares)}; clamped to the ${shares(s.sharesSold)} held` : undefined} className={s.sharesSold !== s.shares ? 'text-warn' : 'text-muted'}>
          {shares(s.sharesSold)}
        </span>
      ),
    },
    { key: 'price', label: 'Sale price', numeric: true, sort: (s) => s.price, render: (s) => money(s.price, { precise: true }) },
    { key: 'avg', label: 'Avg buy', numeric: true, sort: (s) => s.avgBuyPrice, render: (s) => <span className="text-muted">{money(s.avgBuyPrice, { precise: true })}</span>, className: 'hidden lg:table-cell' },
    { key: 'proceeds', label: 'Proceeds', numeric: true, sort: (s) => s.proceeds, render: (s) => money(s.proceeds), total: money(data?.totalProceeds), className: 'hidden sm:table-cell' },
    { key: 'cost', label: 'Cost', numeric: true, sort: (s) => s.costRemoved, render: (s) => <span className="text-muted">{money(s.costRemoved)}</span>, total: money(data?.totalCostRemoved), className: 'hidden sm:table-cell' },
    {
      key: 'gain',
      label: 'Gain',
      numeric: true,
      sort: (s) => s.gain,
      render: (s) => <span className={`font-medium ${tone(s.gain)}`}>{money(s.gain, { signed: true })}</span>,
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

  const header = (
    <PageHeader
      tabs={ACTIVITY_TABS}
      controls={
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
    </PageHeader>
  );
  if (error && !data) return <>{header}<ErrorLine error={error} /></>;
  if (!data) return <>{header}<Skeleton /></>;
  return (
    <div>
      {header}
      <StatRow cols={5} className="mb-8">
        <Stat label={`Realized gain, ${data.sales.length} sale${data.sales.length === 1 ? '' : 's'}`} value={money(data.totalGain, { signed: true })} tone={tone(data.totalGain)} />
        <Stat label="Proceeds" value={money(data.totalProceeds)} />
        <Stat label="Unrealized gain" value={money(data.unrealizedGain, { signed: true })} tone={tone(data.unrealizedGain)} />
        <Stat label="Dividends" value={money(data.dividends, { signed: true })} tone={tone(data.dividends)} />
        <Stat label="Total return" value={money(data.totalReturn, { signed: true })} tone={tone(data.totalReturn)} />
      </StatRow>
      {data.sales.length ? (
        <Table caption="Sales" rows={data.sales} columns={columns} rowKey={(s) => s.txId} initialSort={{ key: 'date', dir: 'desc' }} showTotals />
      ) : (
        <Empty title="No sales yet">Sales appear here as soon as a Sell transaction is recorded.</Empty>
      )}
    </div>
  );
}

type Income = IncomeSummary & { received: { year: number; total: number }[] };

export function Dividends() {
  const realized = useApi<RealizedResponse>('/api/realized');
  const outlook = useApi<{ today: string; income: Income }>('/api/outlook');
  const header = (
    <PageHeader tabs={ACTIVITY_TABS}>
      Every dividend is reinvested on its ex-date at that day’s close, in the account that received it.
    </PageHeader>
  );
  const error = realized.error ?? outlook.error;
  if (error && !(realized.data && outlook.data)) return <>{header}<ErrorLine error={error} /></>;
  if (!realized.data || !outlook.data) return <>{header}<Skeleton /></>;
  const events = realized.data.dividendEvents;
  const income = outlook.data.income;
  const thisYear = Number(outlook.data.today.slice(0, 4));
  const years = income.received.map((y, i) => {
    const before = income.received[i + 1]?.total;
    return { ...y, change: before ? y.total / before - 1 : null, partial: y.year === thisYear };
  });
  const lastFull = years.find((y) => !y.partial);

  if (!events.length && !income.rows.length) {
    return (
      <>
        {header}
        <Empty title="No dividends yet">Dividends are booked on each ex-date for the shares held going into it, from the dividend data Tiingo sends with prices.</Empty>
      </>
    );
  }
  return (
    <div>
      {header}
      <StatRow cols={4} className="mb-8">
        <Stat label="Next 12 months, estimated" value={money(income.annual)} info="The last twelve months’ dividends per share, on the shares held today. A cut, a rise or a special dividend is not anticipated." />
        <Stat label="A month, on average" value={money(income.annual / 12)} info="A twelfth of the yearly estimate. Payments bunch up by quarter." />
        <Stat label="Yield on today’s value" value={pct(income.yield, { signed: false })} info="Expected income divided by the value of the selected accounts." />
        {lastFull ? (
          <Stat label={`Received in ${lastFull.year}`} value={money(lastFull.total)} sub={lastFull.change === null ? undefined : pct(lastFull.change)} info={lastFull.change === null ? 'The first full year.' : `Compared with ${lastFull.year - 1}.`} />
        ) : (
          <Stat label={`Received in ${thisYear} so far`} value={money(years[0]?.total ?? 0)} />
        )}
      </StatRow>

      <Columns split="wide-left">
        <Section
          title="Expected by holding"
          count={income.rows.length}
          info="Each holding’s last twelve months of dividends per share, repeated on the shares held today. A cut, a rise or a one-off special dividend is not anticipated. The next ex-date is a guess from the usual gap between payments."
        >
          {income.rows.length > 0 ? (
            <Table
              caption="Expected dividend income by holding"
              rows={income.rows}
              rowKey={(r) => r.ticker}
              initialSort={{ key: 'annual', dir: 'desc' }}
              showTotals
              columns={[
                { key: 'ticker', label: 'Ticker', sort: (r) => r.ticker, render: (r) => <TickerLink ticker={r.ticker} />, total: 'Total' },
                { key: 'perShare', label: 'Per share, 12 mo', numeric: true, sort: (r) => r.perShare, render: (r) => <span className="text-muted">{money(r.perShare, { precise: true })}</span>, className: 'hidden sm:table-cell' },
                { key: 'annual', label: 'Next 12 months', numeric: true, sort: (r) => r.annual, render: (r) => <span className="font-medium">{money(r.annual)}</span>, total: money(income.annual) },
                { key: 'yield', label: 'Yield', numeric: true, sort: (r) => r.yield, render: (r) => pct(r.yield, { signed: false }), total: pct(income.yield, { signed: false }) },
                {
                  key: 'next', label: 'Next expected', numeric: true, sort: (r) => r.nextExDate,
                  render: (r) => (r.nextExDate ? <span className="text-muted">about {date(r.nextExDate)}</span> : <span className="text-faint">—</span>),
                  className: 'hidden md:table-cell',
                },
              ]}
            />
          ) : (
            <Empty title="Nothing held pays a dividend" />
          )}
        </Section>

        <Section title="Received by year" info="What was received in each calendar year. The figure moves with the money invested as well as with the dividends themselves.">
          {years.length > 0 ? (
            <Table
              caption="Dividends received by year"
              rows={years}
              rowKey={(y) => y.year}
              columns={[
                { key: 'year', label: 'Year', render: (y) => <span className="num">{y.year}{y.partial ? <span className="text-muted"> so far</span> : ''}</span> },
                { key: 'total', label: 'Received', numeric: true, render: (y) => <span className="font-medium">{money(y.total)}</span> },
                {
                  key: 'change', label: 'On the year before', numeric: true,
                  render: (y) => (y.change === null || y.partial ? <span className="text-faint">—</span> : <span className={tone(y.change)}>{pct(y.change)}</span>),
                },
              ]}
            />
          ) : (
            <Empty title="None received yet" />
          )}
        </Section>
      </Columns>

      <Section
        title="Every dividend"
        count={events.length}
        className="mt-10"
        info="Each dividend is reinvested on its ex-date at that day’s close. Your broker buys on the pay date, a few days to weeks later, so its share counts can differ slightly. Reinvested shares earn later dividends and cost what was reinvested. Don’t enter the broker’s reinvestment buys as transactions, or they’ll be counted twice."
      >
        {events.length ? (
          <Table
            caption="Dividends received"
            rows={events.map((e, i) => ({ ...e, i }))}
            rowKey={(e) => e.i}
            initialSort={{ key: 'date', dir: 'desc' }}
            showTotals
            columns={[
              { key: 'date', label: 'Ex-date', sort: (e) => e.date, render: (e) => <span className="num whitespace-nowrap">{date(e.date)}</span>, total: 'Total' },
              { key: 'ticker', label: 'Ticker', sort: (e) => e.ticker, render: (e) => <TickerLink ticker={e.ticker} /> },
              { key: 'shares', label: 'Shares', numeric: true, sort: (e) => e.shares, render: (e) => <span className="text-muted">{shares(e.shares)}</span>, className: 'hidden sm:table-cell' },
              { key: 'per', label: 'Per share', numeric: true, sort: (e) => e.perShare, render: (e) => <span className="text-muted">{money(e.perShare, { precise: true })}</span>, className: 'hidden sm:table-cell' },
              {
                key: 'amount',
                label: 'Amount',
                numeric: true,
                sort: (e) => e.amount,
                render: (e) => <span className="font-medium text-gain">{money(e.amount, { signed: true })}</span>,
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
        ) : (
          <Empty title="No dividends received yet" />
        )}
      </Section>
    </div>
  );
}

export function Taxes() {
  const { method, setMethod } = useMethod();
  const { data, error } = useApi<RealizedResponse>('/api/realized');
  const header = (
    <PageHeader tabs={ACTIVITY_TABS}>
      Not tax advice. Wash sales, fees and corporate actions other than splits are ignored. Lots are kept per account; long-term means held more than one year.
    </PageHeader>
  );
  if (error && !data) return <>{header}<ErrorLine error={error} /></>;
  if (!data) return <>{header}<Skeleton /></>;
  if (method !== 'fifo') {
    return (
      <>
        {header}
        <Notice
          tone="info"
          title="Tax years need FIFO"
          action={
            <Button size="sm" variant="primary" onClick={() => setMethod('fifo')}>
              Switch to FIFO
            </Button>
          }
        >
          Short- and long-term gains depend on which lots were sold, which average cost does not track. The setting changes every cost and gain figure in the app.
        </Notice>
      </>
    );
  }
  return (
    <div>
      {header}
      <TaxYears years={data.taxYears ?? []} dividendYears={data.dividendYears} />
      <TurningLongTermSoon lots={data.turningLongTermSoon} />
    </div>
  );
}

function TaxYears({ years: saleYears, dividendYears }: { years: TaxYear[]; dividendYears: DividendYear[] }) {
  const divs = new Map(dividendYears.map((d) => [d.year, d.total]));
  const empty = (year: number): TaxYear => ({ year, shortTerm: { proceeds: 0, cost: 0, gain: 0 }, longTerm: { proceeds: 0, cost: 0, gain: 0 }, total: 0, lots: [] });
  const byYear = new Map(saleYears.map((y) => [y.year, y]));
  const years = [...new Set([...byYear.keys(), ...divs.keys()])].sort((a, b) => b - a).map((y) => byYear.get(y) ?? empty(y));
  const [open, setOpen] = useState<number | null>(years[0]?.year ?? null);
  if (!years.length) return <Empty title="No sales or dividends yet" />;
  return (
    <Section title="By tax year" info="Dividends are counted in the year of their ex-date (the pay date can fall later) and are not split into qualified and ordinary. Long-term means held more than one year.">
      <Table
        caption="Gains and dividends by tax year"
        rows={years}
        rowKey={(y) => y.year}
        columns={[
          { key: 'year', label: 'Year', render: (y) => <span className="num font-medium">{y.year}</span> },
          { key: 'short', label: 'Short-term', numeric: true, render: (y) => <span className={tone(y.shortTerm.gain)}>{money(y.shortTerm.gain, { signed: true })}</span> },
          { key: 'long', label: 'Long-term', numeric: true, render: (y) => <span className={tone(y.longTerm.gain)}>{money(y.longTerm.gain, { signed: true })}</span> },
          { key: 'divs', label: 'Dividends', numeric: true, render: (y) => <span className={tone(divs.get(y.year) ?? 0)}>{money(divs.get(y.year) ?? 0, { signed: true })}</span> },
          { key: 'total', label: 'Total', numeric: true, render: (y) => <span className={`font-medium ${tone(y.total + (divs.get(y.year) ?? 0))}`}>{money(y.total + (divs.get(y.year) ?? 0), { signed: true })}</span> },
          { key: 'lots', label: 'Lots sold', numeric: true, render: (y) => <span className="text-muted">{y.lots.length || '—'}</span> },
          {
            key: 'open',
            label: <span className="sr-only">Show lots</span>,
            render: (y) =>
              y.lots.length ? (
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === y.year ? null : y.year)} aria-expanded={open === y.year}>
                  {open === y.year ? 'Hide lots' : 'Lots'}
                </Button>
              ) : null,
          },
        ]}
      />
      {years.filter((y) => y.year === open && y.lots.length > 0).map((y) => (
        <Section key={y.year} title={`Lots sold in ${y.year}`} count={y.lots.length}>
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
              { key: 'acquired', label: 'Acquired', sort: (l) => l.acquired, render: (l) => <span className="num whitespace-nowrap text-muted">{date(l.acquired)}</span>, className: 'hidden sm:table-cell' },
              { key: 'term', label: 'Term', sort: (l) => l.term, render: (l) => <span className="text-muted">{l.term === 'long' ? 'Long' : 'Short'}</span> },
              { key: 'shares', label: 'Shares', numeric: true, render: (l) => shares(l.shares) },
              { key: 'proceeds', label: 'Proceeds', numeric: true, render: (l) => money(l.proceeds), total: money(y.shortTerm.proceeds + y.longTerm.proceeds), className: 'hidden sm:table-cell' },
              { key: 'cost', label: 'Cost', numeric: true, render: (l) => <span className="text-muted">{money(l.cost)}</span>, total: money(y.shortTerm.cost + y.longTerm.cost), className: 'hidden sm:table-cell' },
              {
                key: 'gain',
                label: 'Gain',
                numeric: true,
                sort: (l) => l.gain,
                render: (l) => <span className={`font-medium ${tone(l.gain)}`}>{money(l.gain, { signed: true })}</span>,
                total: <span className={tone(y.total)}>{money(y.total, { signed: true })}</span>,
              },
            ]}
          />
        </Section>
      ))}
    </Section>
  );
}

export function TurningLongTermSoon({ lots }: { lots: SoonLot[] }) {
  return (
    <Section title="Turning long-term in the next 60 days" count={lots.length} className="mt-10" info="Open FIFO lots in the selected accounts, including reinvested dividends, grouped by ticker and account. Gains use the latest stored prices.">
      {lots.length ? (
        <Table caption="Lots turning long-term within 60 days" rows={lots.map((l, i) => ({ ...l, i }))} rowKey={(l) => l.i} columns={[
          { key: 'date', label: 'Long-term from', render: (l) => <span className="num whitespace-nowrap font-medium">{date(l.longTermDate)}{l.lastLongTermDate && l.lastLongTermDate !== l.longTermDate ? ` – ${date(l.lastLongTermDate)}` : ''}</span> },
          { key: 'ticker', label: 'Ticker', render: (l) => <TickerLink ticker={l.ticker} /> },
          { key: 'account', label: 'Account', render: (l) => <span className="text-muted">{l.account || '(no account)'}</span> },
          { key: 'acquired', label: 'Lots', render: (l) => <span className="text-muted">{l.reinvestedLots ? `${l.reinvestedLots} reinvested ${l.reinvestedLots === 1 ? 'lot' : 'lots'}` : <span className="num">{date(l.acquired)}</span>}</span> },
          { key: 'shares', label: 'Shares', numeric: true, render: (l) => shares(l.shares) },
          { key: 'gain', label: 'Unrealized gain', numeric: true, render: (l) => l.gain === null ? <span className="text-muted">No price</span> : <span className={tone(l.gain)}>{money(l.gain, { signed: true })}</span> },
        ]} />
      ) : (
        <p className="border-y border-rule py-2.5 text-[13px] text-muted">No lots cross into long-term in the next 60 days.</p>
      )}
    </Section>
  );
}
