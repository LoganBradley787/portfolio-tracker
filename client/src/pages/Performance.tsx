// The Performance area: one range, fetched once, read by four pages.
import { Link, Outlet, useOutletContext } from 'react-router-dom';
import { axisMoney, axisPct, Legend, LineChartFrame, GainBar, Sparkline, useChartColors, type Row, type SeriesDef } from '../components/charts.tsx';
import { RangeSelector } from '../components/RangeSelector.tsx';
import { Table } from '../components/Table.tsx';
import { TickerLink } from '../components/TickerLink.tsx';
import type { MoneyAdded as MoneyBreakdown } from '../../../src/engine/moneyAdded.ts';
import { MonthlyReturns } from '../components/MonthlyReturns.tsx';
import { CustomBenchmark } from '../components/CustomBenchmark.tsx';
import { useRefresh } from '../lib/refresh.tsx';
import type { MonthReturn } from '../../../src/engine/returns.ts';
import { Columns, Empty, ErrorLine, Note, Notice, PageHeader, Section, Segmented, Skeleton, Stat, StatRow } from '../components/ui.tsx';
import { PERFORMANCE_TABS } from '../lib/areas.ts';
import { date, money, pct, tone } from '../lib/format.ts';
import { rangeQuery } from '../lib/range.ts';
import { useApi } from '../lib/useApi.ts';
import { usePersistent, usePersistentRange } from '../lib/usePersistentRange.ts';
import { useState } from 'react';

interface SeriesDay {
  date: string;
  value: number;
  cost: number;
  incomplete: boolean;
  twr: number | null;
  benchmarks: Record<string, { close: number | null; pct: number | null; shadowValue: number | null }>;
}
interface SeriesResponse {
  firstDate: string | null;
  lastDate: string | null;
  days: SeriesDay[];
  incompleteDays: number;
}
interface Shadow {
  value: number;
  cost: number;
  unrealized: number;
  realized: number;
  dividends: number;
  total: number;
  rangeGain: number;
}
interface PerformanceResponse {
  from: string;
  to: string;
  summary: { from: string | null; to: string | null; days: number; startValue: number; endValue: number; buys: number; sells: number; dividends: number; gain: number };
  twr: number | null;
  twrAnnualized: number | null;
  irr: number | null;
  volatility: number | null;
  drawdown: { max: number; peakDate: string | null; troughDate: string | null; current: number; series: { date: string; drawdown: number }[] };
  contribution: {
    ticker: string;
    startValue: number;
    endValue: number;
    buys: number;
    sells: number;
    dividends: number;
    gain: number;
    returnPct: number | null;
    share: number | null;
    spyGain: number | null;
    aheadOfSpy: number | null;
  }[];
  groups: { assetType: string; endValue: number; gain: number; twr: number | null; incompleteDays: number }[];
  accounts: { account: string; endValue: number; gain: number; twr: number | null; incompleteDays: number }[];
  months: MonthReturn[];
  moneyAdded: MoneyBreakdown;
  incompleteDays: number;
  portfolio: { value: number; cost: number; unrealized: number; realized: number; dividends: number };
  benchmarks: Record<string, {
    available: boolean;
    shadowAvailable: boolean;
    firstDate: string | null;
    error: string | null;
    priceReturn: number | null;
    totalReturn: number | null;
    shadow: Shadow;
  }>;
  holdings: { ticker: string; assetType: string; shares: number; value: number; price: { start: number; end: number; change: number; spark: number[] } | null }[];
}

interface Ctx {
  p: PerformanceResponse;
  s: SeriesResponse;
  benchmarks: string[];
  customBenchmark: string | null;
  changedBenchmark: (custom: string | null) => void;
}

export default function PerformanceArea() {
  const config = useApi<{ today: string; customBenchmark: string | null }>('/api/config');
  const { bump, poke } = useRefresh();
  const [range, setRange] = usePersistentRange('performance', { preset: '1Y' });
  const today = config.data?.today;
  const q = today ? rangeQuery(range, today) : null;
  const series = useApi<SeriesResponse>(q === null ? null : `/api/series${q}`);
  const perf = useApi<PerformanceResponse>(q === null ? null : `/api/performance${q}`);
  const benchmarks = [...new Set(['SPY', 'QQQ', 'VT', ...(config.data?.customBenchmark ? [config.data.customBenchmark] : [])])];
  const changedBenchmark = () => {
    bump();
    poke();
  };

  const error = series.error ?? perf.error;
  const p = perf.data;
  const s = series.data;
  const loading = series.loading || perf.loading;
  const header = (
    <PageHeader tabs={PERFORMANCE_TABS} controls={<RangeSelector value={range} onChange={setRange} min={s?.firstDate} max={today} />}>
      {p?.summary.from ? `${date(p.summary.from)} to ${date(p.summary.to)}` : 'The portfolio over a range, against SPY, QQQ and VT'}
      {p && p.incompleteDays > 0 && (
        <span className="text-warn"> · {p.incompleteDays} day{p.incompleteDays > 1 ? 's' : ''} incomplete: some prices are still loading, so those days are left out of the time-weighted return and shaded on the charts</span>
      )}
    </PageHeader>
  );
  if (error && !p) return <>{header}<ErrorLine error={error} /></>;
  if (!p || !s) return <>{header}<Skeleton rows={8} /></>;
  if (!s.firstDate) {
    return (
      <>
        {header}
        <Empty title="Nothing to chart yet">
          Add transactions under <Link className="font-medium text-accent hover:underline" to="/activity/transactions">Activity</Link>.
        </Empty>
      </>
    );
  }
  if (!s.days.length) return <>{header}<Empty title="No trading days in this range">Pick a wider range.</Empty></>;
  const ctx: Ctx = { p, s, benchmarks, customBenchmark: config.data?.customBenchmark ?? null, changedBenchmark };
  return (
    <div className={loading ? 'opacity-80 transition-opacity' : 'transition-opacity'}>
      {header}
      <Outlet context={ctx} />
    </div>
  );
}

type ChartView = 'return' | 'drawdown';

export function Returns() {
  const { p, s, benchmarks, customBenchmark, changedBenchmark } = useOutletContext<Ctx>();
  const c = useChartColors();
  const [view, setView] = usePersistent<ChartView>('performance:chart', 'return');
  // Lines turned off on the return chart. VT starts off.
  const [hidden, setHidden] = usePersistent<string[]>('performance:hiddenSeries', ['VT']);
  const spy = p.benchmarks.SPY;
  const qqq = p.benchmarks.QQQ;
  const missing = benchmarks.filter((b) => !p.benchmarks[b]?.available);

  const returnSeries: SeriesDef[] = [
    { key: 'twr', label: 'Portfolio', color: c.s1, format: (v) => pct(v) },
    ...benchmarks.map((b, i) => ({ key: b, label: b, color: [c.s2, c.s3, c.s4, c.muted][i], format: (v: number) => pct(v) })),
  ];
  const shownSeries = returnSeries.filter((x) => !hidden.includes(x.key));
  const toggle = (key: string) => setHidden(hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key]);
  const returnRows: Row[] = s.days.map((d) => ({ date: d.date, incomplete: d.incomplete, twr: d.twr, ...Object.fromEntries(benchmarks.map((b) => [b, d.benchmarks[b]?.pct])) }));
  const last = returnRows.at(-1)!;

  const compare = [
    {
      key: 'Portfolio',
      value: p.portfolio.value,
      cost: p.portfolio.cost,
      unrealized: p.portfolio.unrealized,
      realized: p.portfolio.realized,
      dividends: p.portfolio.dividends,
      total: p.portfolio.unrealized + p.portfolio.realized + p.portfolio.dividends,
      rangeGain: p.summary.gain,
    },
    ...benchmarks.filter((b) => p.benchmarks[b]?.shadowAvailable).map((b) => ({ key: `Same money in ${b}`, ...p.benchmarks[b].shadow })),
  ];

  return (
    <div>
      {missing.length > 0 && (
        <div className="mb-5">
          <Notice tone="warn" title="Benchmark prices haven’t loaded yet">
            {missing.map((b) => `${b}${p.benchmarks[b]?.error ? `: ${p.benchmarks[b].error}` : ''}`).join(' · ')}.
            Check Data health if a ticker cannot be found.
          </Notice>
        </div>
      )}

      <dl className="grid grid-cols-2 border-y border-rule-strong/60 sm:grid-cols-4">
        {[
          ['Gain over range', money(p.summary.gain, { signed: true }), tone(p.summary.gain), p.summary.dividends ? `incl. ${money(p.summary.dividends)} dividends` : null],
          ['Time-weighted return', pct(p.twr), tone(p.twr), p.twrAnnualized !== null ? `${pct(p.twrAnnualized)} a year` : null],
          [
            'Money-weighted (IRR)',
            p.irr === null ? 'n/a' : `${pct(p.irr)}`,
            p.irr === null ? 'text-muted' : tone(p.irr),
            p.irr === null ? 'needs 30+ days and money in and out' : 'a year',
          ],
          ['Volatility', p.volatility === null ? 'n/a' : pct(p.volatility, { signed: false }), '', 'annualized'],
          ['SPY total return', pct(spy?.totalReturn), '', spy?.priceReturn != null ? `${pct(spy.priceReturn)} price only` : null],
          ['QQQ total return', pct(qqq?.totalReturn), '', qqq?.priceReturn != null ? `${pct(qqq.priceReturn)} price only` : null],
          [
            'Max drawdown',
            pct(p.drawdown.max),
            p.drawdown.max < 0 ? 'text-loss' : '',
            p.drawdown.troughDate ? `${date(p.drawdown.peakDate)} to ${date(p.drawdown.troughDate)}` : null,
          ],
          ['Value at start', money(p.summary.startValue), '', `${money(p.summary.buys - p.summary.sells, { signed: true })} added since`],
        ].map(([k, v, cls, sub], i) => (
          <div key={k} className={`min-w-0 border-b border-rule py-3 pr-4 sm:px-4 [&:nth-last-child(-n+2)]:border-b-0 sm:[&:nth-last-child(-n+4)]:border-b-0 ${i % 4 === 0 ? 'sm:pl-0' : 'sm:border-l sm:border-l-rule'}`}>
            <dt className="text-xs text-muted">{k}</dt>
            <dd className={`num mt-1 text-[17px] leading-6 font-medium tracking-tight ${cls}`}>{v}</dd>
            {sub && <dd className="mt-0.5 text-xs text-muted">{sub}</dd>}
          </div>
        ))}
      </dl>

      <Section
        title={view === 'return' ? 'Return over the range' : 'Drawdown from the highest point'}
        aside={
          <span className="flex flex-wrap items-center gap-4">
            {view === 'return' && (
              <Legend
                series={returnSeries}
                values={Object.fromEntries(returnSeries.map((x) => [x.key, pct(last[x.key] as number)]))}
                hidden={hidden}
                onToggle={toggle}
              />
            )}
            <Segmented<ChartView>
              label="Chart"
              value={view}
              onChange={setView}
              options={[
                { value: 'return', label: 'Return' },
                { value: 'drawdown', label: 'Drawdown' },
              ]}
            />
          </span>
        }
      >
        {view === 'return' ? (
          <>
            <LineChartFrame label="Portfolio time-weighted return against benchmark total return" rows={returnRows} series={shownSeries} yFormat={axisPct} zeroLine height={300} />
            <Note>
              The portfolio line is time-weighted, so money added or withdrawn doesn’t count as gain; dividends received
              count as return. Benchmarks are total return, with dividends reinvested on each ex-date. Click a name in the
              legend to hide or show its line.
            </Note>
            {benchmarks
              .filter((b) => p.benchmarks[b]?.available && p.benchmarks[b].totalReturn === null)
              .map((b) => (
                <p key={b} className="mt-2 text-xs text-warn">
                  {b}: the selected range starts before its available history ({date(p.benchmarks[b].firstDate)}). Choose a later start to compare returns.
                </p>
              ))}
            <CustomBenchmark
              ticker={customBenchmark}
              onChanged={(custom) => {
                // A benchmark just added should be visible, whatever was hidden before.
                if (custom) setHidden(hidden.filter((k) => k !== custom));
                changedBenchmark(custom);
              }}
            />
          </>
        ) : (
          <>
            <LineChartFrame
              label="Drawdown from the highest point so far, time-weighted"
              rows={p.drawdown.series.map((d, i) => ({ date: d.date, incomplete: s.days[i]?.incomplete, drawdown: d.drawdown }))}
              series={[{ key: 'drawdown', label: 'Drawdown', color: c.s1, area: true, format: (v) => pct(v) }]}
              yFormat={axisPct}
              height={300}
            />
            <Note>Fall from the highest point so far in the range, on the time-weighted index, so money added can’t hide a fall.</Note>
          </>
        )}
      </Section>

      <Columns split="wide-left" className="mt-10">
        <Section title="Same money in a benchmark">
          <Table
            caption="Dollar comparison with benchmarks"
            rows={compare}
            rowKey={(r) => r.key}
            columns={[
              { key: 'name', label: '', render: (r) => <span className="font-medium whitespace-nowrap">{r.key}</span> },
              { key: 'value', label: 'Value now', numeric: true, render: (r) => money(r.value) },
              { key: 'cost', label: 'Cost basis', numeric: true, render: (r) => <span className="text-muted">{money(r.cost)}</span>, className: 'hidden md:table-cell' },
              {
                key: 'dividends',
                label: 'Dividends',
                numeric: true,
                render: (r) => (
                  <span
                    title={r.key === 'Portfolio'
                      ? 'Reinvested in the same ticker; the shares bought are in value at what they cost'
                      : 'Reinvested; already inside value and realized'}
                    className={r.key === 'Portfolio' ? tone(r.dividends) : 'text-muted'}
                  >
                    {r.key === 'Portfolio' ? money(r.dividends, { signed: true }) : `(${money(r.dividends)})`}
                  </span>
                ),
                className: 'hidden xl:table-cell',
              },
              { key: 'total', label: 'Total gain', numeric: true, render: (r) => <span className={tone(r.total)}>{money(r.total, { signed: true })}</span> },
              { key: 'range', label: 'Over range', numeric: true, render: (r) => <span className={`font-medium ${tone(r.rangeGain)}`}>{money(r.rangeGain, { signed: true })}</span> },
            ]}
          />
          <Note>
            Each buy puts the same dollars into the benchmark on that day; selling part of a holding sells the same part of its
            benchmark shadow. Dividends are reinvested on both sides.
            {benchmarks
              .filter((b) => p.benchmarks[b]?.available && !p.benchmarks[b].shadowAvailable)
              .map((b) => ` ${b} is omitted because its history starts after your first trade.`)}
          </Note>
        </Section>

        <div className="space-y-8">
          <Section title="Stocks and ETFs">
            <Table caption="Stocks and ETFs compared with SPY" rows={[
              ...p.groups.map((g) => ({ label: g.assetType === 'Stock' ? 'Stocks' : 'ETFs', ...g })),
              { label: 'SPY', endValue: null, gain: null, twr: spy?.totalReturn ?? null, incompleteDays: 0 },
            ]} rowKey={(r) => r.label} columns={[
              { key: 'label', label: 'Group', render: (r) => <span className="font-medium">{r.label}</span> },
              { key: 'value', label: 'Value', numeric: true, render: (r) => money(r.endValue) },
              { key: 'gain', label: 'Over range', numeric: true, render: (r) => <span className={tone(r.gain)}>{money(r.gain, { signed: true })}</span> },
              { key: 'twr', label: 'Return', numeric: true, render: (r) => <span className={tone(r.twr)}>{pct(r.twr)}{r.incompleteDays > 0 ? ' *' : ''}</span> },
            ]} />
            <Note>Time-weighted, dividends included, positions sold in the range included. * Missing-price days excluded.</Note>
          </Section>

          {p.accounts.length > 1 && (
            <Section title="Accounts">
              <Table caption="Accounts over the selected range" rows={p.accounts} rowKey={(r) => r.account} columns={[
                { key: 'account', label: 'Account', render: (r) => <span className="font-medium">{r.account || '(no account)'}</span> },
                { key: 'value', label: 'Value', numeric: true, render: (r) => money(r.endValue) },
                { key: 'gain', label: 'Over range', numeric: true, render: (r) => <span className={tone(r.gain)}>{money(r.gain, { signed: true })}</span> },
                { key: 'twr', label: 'Return', numeric: true, render: (r) => <span className={tone(r.twr)}>{pct(r.twr)}{r.incompleteDays > 0 ? ' *' : ''}</span> },
              ]} />
              <Note>Each account replayed on its own. Returns are not additive.</Note>
            </Section>
          )}
        </div>
      </Columns>
    </div>
  );
}

type HoldingView = 'gain' | 'price';

export function PerformanceHoldings() {
  const { p } = useOutletContext<Ctx>();
  const [view, setView] = useState<HoldingView>('gain');
  return (
    <Section
      title={view === 'gain' ? 'What drove the gain' : 'Price change over the range'}
      count={view === 'gain' ? p.contribution.length : p.holdings.length}
      aside={
        <Segmented<HoldingView>
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'gain', label: 'Your gain' },
            { value: 'price', label: 'Price change' },
          ]}
        />
      }
    >
      {view === 'gain' ? (
        <>
          {p.contribution.length ? (
            <ContributionTable rows={p.contribution} total={p.summary.gain} atWork={p.summary.startValue + p.summary.buys} />
          ) : (
            <Empty title="No positions in this range" />
          )}
          <Note>
            Each position’s gain over the range: value at the end, minus value at the start, minus what was bought, plus what
            was sold. Dividends are reinvested, so they are already in the value at the end. These add up to the gain over the
            range. Return is that gain on the money at work: value at the start plus what was bought. Ahead of SPY compares
            your gain with a SPY shadow bought on the same dates for the same dollars; a dash means the history needed is
            unavailable.
          </Note>
        </>
      ) : (
        <>
          {p.holdings.length ? (
            <Table
              caption="Price change by holding"
              rows={p.holdings}
              rowKey={(h) => h.ticker}
              initialSort={{ key: 'change', dir: 'desc' }}
              columns={[
                {
                  key: 'ticker',
                  label: 'Ticker',
                  sort: (h) => h.ticker,
                  render: (h) => (
                    <span className="whitespace-nowrap">
                      <TickerLink ticker={h.ticker} />
                      {h.assetType === 'ETF' && <span className="ml-1.5 text-[11px] text-faint">ETF</span>}
                    </span>
                  ),
                },
                { key: 'start', label: 'Start', numeric: true, sort: (h) => h.price?.start ?? null, render: (h) => <span className="text-muted">{money(h.price?.start)}</span> },
                { key: 'end', label: 'End', numeric: true, sort: (h) => h.price?.end ?? null, render: (h) => money(h.price?.end) },
                {
                  key: 'change',
                  label: 'Change',
                  numeric: true,
                  sort: (h) => h.price?.change ?? null,
                  render: (h) => <span className={`font-medium ${tone(h.price?.change)}`}>{pct(h.price?.change)}</span>,
                },
                { key: 'spark', label: <span className="sr-only">Trend</span>, render: (h) => <Sparkline values={h.price?.spark ?? []} />, className: 'hidden sm:table-cell' },
                { key: 'value', label: 'Value at end', numeric: true, sort: (h) => h.value, render: (h) => money(h.value), className: 'hidden md:table-cell' },
              ]}
            />
          ) : (
            <Empty title="Nothing held at the end of this range" />
          )}
          <Note>The ticker’s own price move, split-adjusted. Not your return on it: trades inside the range are ignored.</Note>
        </>
      )}
    </Section>
  );
}

function ContributionTable({ rows, total, atWork }: { rows: PerformanceResponse['contribution']; total: number; atWork: number }) {
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.gain)), 1e-9);
  const compared = rows.filter((r) => r.aheadOfSpy !== null);
  const excluded = rows.length - compared.length;
  const aheadTotal = compared.length ? compared.reduce((sum, r) => sum + r.aheadOfSpy!, 0) : null;
  return (
    <Table
      caption="Contribution by position"
      rows={rows}
      rowKey={(r) => r.ticker}
      initialSort={{ key: 'gain', dir: 'desc' }}
      showTotals
      columns={[
        { key: 'ticker', label: 'Ticker', sort: (r) => r.ticker, render: (r) => <TickerLink ticker={r.ticker} />, total: 'Total' },
        { key: 'start', label: 'Value at start', numeric: true, sort: (r) => r.startValue, render: (r) => <span className="text-muted">{money(r.startValue)}</span>, className: 'hidden md:table-cell' },
        {
          key: 'buys',
          label: 'Bought',
          numeric: true,
          sort: (r) => r.buys,
          render: (r) => (r.buys ? <span className="text-muted">{money(r.buys)}</span> : <span className="text-faint">—</span>),
          className: 'hidden lg:table-cell',
        },
        {
          key: 'sells',
          label: 'Sold',
          numeric: true,
          sort: (r) => r.sells,
          render: (r) => (r.sells ? <span className="text-muted">{money(r.sells)}</span> : <span className="text-faint">—</span>),
          className: 'hidden lg:table-cell',
        },
        {
          key: 'divs',
          label: 'Dividends',
          title: 'Reinvested, so already in the value at the end',
          numeric: true,
          sort: (r) => r.dividends,
          render: (r) => (r.dividends ? <span className="text-muted">{money(r.dividends)}</span> : <span className="text-faint">—</span>),
          className: 'hidden xl:table-cell',
        },
        { key: 'end', label: 'Value at end', numeric: true, sort: (r) => r.endValue, render: (r) => money(r.endValue), className: 'hidden sm:table-cell' },
        {
          key: 'gain',
          label: 'Contribution',
          numeric: true,
          sort: (r) => r.gain,
          render: (r) => <span className={`font-medium ${tone(r.gain)}`}>{money(r.gain, { signed: true })}</span>,
          total: <span className={tone(total)}>{money(total, { signed: true })}</span>,
        },
        {
          key: 'bar',
          label: <span className="sr-only">Contribution bar</span>,
          render: (r) => <GainBar value={r.gain} max={maxAbs} className="h-3 w-32" />,
          className: 'hidden md:table-cell',
        },
        {
          key: 'spy', label: 'Ahead of SPY', title: 'Position gain minus matched SPY shadow gain over this range', numeric: true,
          sort: (r) => r.aheadOfSpy,
          render: (r) => <span className={tone(r.aheadOfSpy)}>{money(r.aheadOfSpy, { signed: true })}</span>,
          total: (
            <span>
              <span className={tone(aheadTotal)}>{money(aheadTotal, { signed: true })}</span>
              {excluded > 0 && (
                <span className="mt-1 block text-xs font-normal text-muted">
                  {excluded} position{excluded === 1 ? '' : 's'} excluded
                </span>
              )}
            </span>
          ),
        },
        {
          key: 'return',
          label: 'Return',
          title: 'Contribution ÷ (value at start + bought)',
          numeric: true,
          sort: (r) => r.returnPct,
          render: (r) => <span className={tone(r.gain)}>{pct(r.returnPct)}</span>,
          total: <span className={tone(total)}>{pct(atWork > 0 ? total / atWork : null)}</span>,
        },
        {
          key: 'share',
          label: 'Share of gain',
          title: 'Contribution ÷ the gain over the range; a dash when the range did not gain',
          numeric: true,
          sort: (r) => r.share,
          render: (r) => <span className="text-muted">{pct(r.share)}</span>,
          total: rows[0]?.share == null ? '—' : pct(1, { signed: false }),
          className: 'hidden sm:table-cell',
        },
      ]}
    />
  );
}

export function Months() {
  const { p } = useOutletContext<Ctx>();
  return (
    <Section title="Monthly returns">
      <MonthlyReturns months={p.months} />
    </Section>
  );
}

export function MoneyAddedPage() {
  const { p, s } = useOutletContext<Ctx>();
  const c = useChartColors();
  const data = p.moneyAdded;
  const [period, setPeriod] = useState<'years' | 'months'>('years');
  const valueSeries: SeriesDef[] = [
    { key: 'value', label: 'Market value', color: c.s1, format: (v) => money(v) },
    { key: 'cost', label: 'Money invested', color: c.muted, dashed: true, format: (v) => money(v) },
  ];
  const valueRows = s.days.map((d) => ({ date: d.date, incomplete: d.incomplete, value: d.value, cost: d.cost }));
  return (
    <div>
      <StatRow cols={3}>
        <Stat label="Today’s value" value={money(data.value)} />
        <Stat label="Net money added" value={money(data.added)} sub="all history, buys minus sells" />
        <Stat label="Growth" value={money(data.growth, { signed: true })} tone={tone(data.growth)} sub="value minus net money added" />
      </StatRow>
      <Section title="Value and money invested over the range" aside={<Legend series={valueSeries} />}>
        <LineChartFrame label="Market value and cost basis over time" rows={valueRows} series={valueSeries} yFormat={axisMoney} height={260} />
      </Section>
      <Section
        title="Money added"
        aside={
          <Segmented label="Money added period" value={period} onChange={setPeriod} options={[
            { value: 'years', label: 'By year' }, { value: 'months', label: 'By month' },
          ]} />
        }
      >
        <div className="max-w-2xl">
          {data[period].length ? <Table caption={`${period === 'years' ? 'Yearly' : 'Monthly'} money added`} rows={[...data[period]].reverse()} rowKey={(r) => r.period} showTotals columns={[
            { key: 'period', label: period === 'years' ? 'Year' : 'Month', render: (r) => <span className="num">{r.period}</span>, total: 'Total' },
            { key: 'buys', label: 'Buys', numeric: true, render: (r) => money(r.buys), total: money(data.years.reduce((a, r) => a + r.buys, 0)) },
            { key: 'sells', label: 'Sells', numeric: true, render: (r) => <span className="text-muted">{money(r.sells)}</span>, total: money(data.years.reduce((a, r) => a + r.sells, 0)) },
            { key: 'net', label: 'Money added', numeric: true, render: (r) => <span className="font-medium">{money(r.net, { signed: true })}</span>, total: money(data.added, { signed: true }) },
          ]} /> : <Empty title="No money added yet" />}
        </div>
        <Note>
          All history through today, for the selected accounts. Buys minus sells measures money invested in securities.
          Reinvested dividends are excluded from buys; sale proceeds include reinvested shares. Growth is today’s value minus
          net money added, including reinvested dividends. This is not remaining cost basis.
        </Note>
      </Section>
    </div>
  );
}
