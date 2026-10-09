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
import { Columns, Empty, ErrorLine, Notice, PageHeader, Section, Segmented, Skeleton, Stat, StatRow } from '../components/ui.tsx';
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
  groups: { assetType: string; endValue: number; gain: number; twr: number | null; incompleteDays: number; investedFrom: string | null; investedTo: string | null }[];
  accounts: { account: string; endValue: number; gain: number; twr: number | null; incompleteDays: number; investedFrom: string | null; investedTo: string | null }[];
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
  /** The benchmark the "vs" columns compare with, chosen once for the area. */
  vs: string;
  setVs: (b: string) => void;
}

export default function PerformanceArea() {
  const config = useApi<{ today: string; customBenchmark: string | null }>('/api/config');
  const { bump, poke } = useRefresh();
  const [range, setRange] = usePersistentRange('performance', { preset: '1Y' });
  const [vs, setVs] = usePersistent<string>('performance:vs', 'SPY');
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
          Add transactions under <Link className="font-semibold text-accent hover:underline" to="/data/transactions">Data</Link>.
        </Empty>
      </>
    );
  }
  if (!s.days.length) return <>{header}<Empty title="No trading days in this range">Pick a wider range.</Empty></>;
  const ctx: Ctx = {
    p, s, benchmarks, customBenchmark: config.data?.customBenchmark ?? null, changedBenchmark,
    vs: benchmarks.includes(vs) ? vs : 'SPY', setVs,
  };
  return (
    <div className={loading ? 'opacity-80 transition-opacity' : 'transition-opacity'}>
      {header}
      <Outlet context={ctx} />
    </div>
  );
}

/** A benchmark chooser for a "vs" column: the benchmarks whose return is known over the range. */
function VsPicker({ p, benchmarks, vs, setVs }: Pick<Ctx, 'p' | 'benchmarks' | 'vs' | 'setVs'>) {
  const usable = benchmarks.filter((b) => p.benchmarks[b]?.totalReturn != null);
  if (usable.length < 2) return null;
  return <Segmented<string> label="Compared with" value={vs} onChange={setVs} options={usable.map((b) => ({ value: b, label: `vs ${b}` }))} />;
}

/** Drawdown from the running peak of a return series (0 at the start). */
function drawdownOf(pcts: (number | null | undefined)[]): (number | null)[] {
  let peak = -Infinity;
  return pcts.map((v) => {
    if (v == null) return null;
    const level = 1 + v;
    peak = Math.max(peak, level);
    return level / peak - 1;
  });
}

type ChartView = 'return' | 'drawdown';
type Unit = 'pct' | 'money';

export function Returns() {
  const { p, s, benchmarks, customBenchmark, changedBenchmark, vs, setVs } = useOutletContext<Ctx>();
  const c = useChartColors();
  const [view, setView] = usePersistent<ChartView>('performance:chart', 'return');
  const [unit, setUnit] = usePersistent<Unit>('performance:unit', 'pct');
  // Lines turned off on the chart. VT starts off.
  const [hidden, setHidden] = usePersistent<string[]>('performance:hiddenSeries', ['VT']);
  const missing = benchmarks.filter((b) => !p.benchmarks[b]?.available);
  const colours = [c.s2, c.s3, c.s4, c.muted];
  const vsReturn = p.benchmarks[vs]?.totalReturn ?? null;

  const pctSeries: SeriesDef[] = [
    { key: 'twr', label: 'Portfolio', color: c.s1, format: (v) => pct(v) },
    ...benchmarks.map((b, i) => ({ key: b, label: b, color: colours[i], format: (v: number) => pct(v) })),
  ];
  const moneySeries: SeriesDef[] = [
    { key: 'twr', label: 'Portfolio', color: c.s1, format: (v) => money(v) },
    ...benchmarks.filter((b) => p.benchmarks[b]?.shadowAvailable).map((b) => ({ key: b, label: `Same money in ${b}`, color: colours[benchmarks.indexOf(b)], format: (v: number) => money(v) })),
  ];
  const toggle = (key: string) => setHidden(hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key]);

  const pctRows: Row[] = s.days.map((d) => ({ date: d.date, incomplete: d.incomplete, twr: d.twr, ...Object.fromEntries(benchmarks.map((b) => [b, d.benchmarks[b]?.pct])) }));
  const moneyRows: Row[] = s.days.map((d) => ({ date: d.date, incomplete: d.incomplete, twr: d.value, ...Object.fromEntries(benchmarks.map((b) => [b, d.benchmarks[b]?.shadowValue])) }));
  const ddPortfolio = new Map(p.drawdown.series.map((d) => [d.date, d.drawdown]));
  const ddBench = Object.fromEntries(benchmarks.map((b) => [b, drawdownOf(s.days.map((d) => d.benchmarks[b]?.pct))]));
  const ddRows: Row[] = s.days.map((d, i) => ({ date: d.date, incomplete: d.incomplete, twr: ddPortfolio.get(d.date) ?? null, ...Object.fromEntries(benchmarks.map((b) => [b, ddBench[b][i]])) }));

  const chartSeries = view === 'drawdown' ? pctSeries : unit === 'money' ? moneySeries : pctSeries;
  const chartRows = view === 'drawdown' ? ddRows : unit === 'money' ? moneyRows : pctRows;
  const last = chartRows.at(-1)!;
  const shown = chartSeries.filter((x) => !hidden.includes(x.key));

  const compare = [
    { key: 'Portfolio', value: p.portfolio.value, rangeGain: p.summary.gain, ret: p.twr, leadMoney: null as number | null, leadPct: null as number | null },
    ...benchmarks
      .filter((b) => p.benchmarks[b]?.shadowAvailable)
      .map((b) => ({
        key: `Same money in ${b}`,
        value: p.benchmarks[b].shadow.value,
        rangeGain: p.benchmarks[b].shadow.rangeGain,
        ret: p.benchmarks[b].totalReturn,
        leadMoney: p.summary.gain - p.benchmarks[b].shadow.rangeGain,
        leadPct: p.twr != null && p.benchmarks[b].totalReturn != null ? p.twr - p.benchmarks[b].totalReturn! : null,
      })),
  ];
  const groupRows = p.groups.map((g) => ({ label: g.assetType === 'Stock' ? 'Stocks' : 'ETFs', ...g }));

  // A group or account is measured against the benchmark over the days it was
  // actually invested, so an account opened last spring is not held to the whole range.
  const vsColumn = <T extends { twr: number | null; investedFrom: string | null; investedTo: string | null }>() => ({
    key: 'vs',
    label: `vs ${vs}`,
    numeric: true,
    render: (r: T) => {
      const own = r.investedFrom && r.investedTo ? benchmarkBetween(s.days, vs, r.investedFrom, r.investedTo) : null;
      const lead = r.twr != null && own != null ? r.twr - own : null;
      const partial = r.investedFrom && r.investedTo && (r.investedFrom > p.from || r.investedTo < p.to);
      return (
        <span className={`font-semibold ${tone(lead)}`} title={partial ? `${vs} measured ${date(r.investedFrom)} to ${date(r.investedTo)}, the days this was invested` : undefined}>
          {lead == null ? '—' : pct(lead)}
        </span>
      );
    },
  });

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

      <StatRow cols={6}>
        <Stat label="Gain over range" value={money(p.summary.gain, { signed: true })} tone={tone(p.summary.gain)} info="Value at the end, minus value at the start, minus money added, plus money taken out. Dividends count." />
        <Stat label="Return" value={pct(p.twr)} sub={p.twrAnnualized !== null ? `${pct(p.twrAnnualized)} a year` : undefined} tone={tone(p.twr)} info="Time-weighted, so money added or withdrawn does not count as gain. Dividends received count as return. This is the figure to compare with a benchmark." />
        <Stat label={`vs ${vs}`} value={p.twr != null && vsReturn != null ? pct(p.twr - vsReturn) : '—'} tone={tone(p.twr != null && vsReturn != null ? p.twr - vsReturn : null)} info={`Your return minus ${vs}’s total return over the same range, dividends reinvested on both sides.`} />
        <Stat label="Money-weighted" value={p.irr === null ? '—' : pct(p.irr)} tone={p.irr === null ? 'text-muted' : tone(p.irr)} info="The yearly rate that your actual deposits and withdrawals earned (an IRR). It rewards adding money before a rise. Needs 30 or more days and money in and out." />
        <Stat label="Volatility" value={p.volatility === null ? '—' : pct(p.volatility, { signed: false })} info="How much daily returns swing, annualized. SPY has run around 15 to 20% over long periods." />
        <Stat label="Max drawdown" value={pct(p.drawdown.max)} tone={p.drawdown.max < 0 ? 'text-loss' : ''} info={p.drawdown.troughDate ? `The largest fall from a high point so far in the range: ${date(p.drawdown.peakDate)} to ${date(p.drawdown.troughDate)}. Measured on the time-weighted index, so money added can’t hide a fall.` : 'The largest fall from a high point so far in the range.'} />
      </StatRow>

      <Section
        title={view === 'return' ? (unit === 'money' ? 'Your money, and the same money in a benchmark' : 'Return over the range') : 'Drawdown from the highest point'}
        info={
          view === 'drawdown'
            ? 'How far each line sits below its own highest point so far in the range. The portfolio is measured on the time-weighted index, so money added can’t hide a fall.'
            : unit === 'money'
              ? 'Your market value against what the same deposits, made on the same days, would be worth in each benchmark. Selling part of a holding sells the same part of its benchmark shadow. Dividends are reinvested on both sides.'
              : 'The portfolio line is time-weighted, so money added or withdrawn doesn’t count as gain; dividends received count as return. Benchmarks are total return, with dividends reinvested on each ex-date. Click a name in the legend to hide or show its line.'
        }
        aside={
          <span className="flex flex-wrap items-center gap-4">
            <Legend
              series={chartSeries}
              values={Object.fromEntries(chartSeries.map((x) => [x.key, typeof last[x.key] === 'number' ? x.format(last[x.key] as number) : '—']))}
              hidden={hidden}
              onToggle={toggle}
            />
            {view === 'return' && (
              <Segmented<Unit> label="Unit" value={unit} onChange={setUnit} options={[{ value: 'pct', label: '%' }, { value: 'money', label: '$' }]} />
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
        <LineChartFrame
          label={view === 'drawdown' ? 'Drawdown from the highest point so far, portfolio and benchmarks' : unit === 'money' ? 'Portfolio value against the same money in each benchmark' : 'Portfolio time-weighted return against benchmark total return'}
          rows={chartRows}
          series={shown}
          yFormat={view === 'return' && unit === 'money' ? axisMoney : axisPct}
          zeroLine={view === 'return' && unit === 'pct'}
          endLabels={view !== 'drawdown'}
          height={360}
        />
        {benchmarks
          .filter((b) => p.benchmarks[b]?.available && p.benchmarks[b].totalReturn === null)
          .map((b) => (
            <p key={b} className="mt-2 text-[13px] text-warn">
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
      </Section>

      <Columns split="wide-left" className="mt-12">
        <Section
          title="Same money in a benchmark"
          info={
            <>
              Each buy puts the same dollars into the benchmark on that day; selling part of a holding sells the same part of its benchmark shadow. Dividends are reinvested on both sides. Your lead is your gain over the range minus the benchmark’s, and your return minus its return.
              {benchmarks
                .filter((b) => p.benchmarks[b]?.available && !p.benchmarks[b].shadowAvailable)
                .map((b) => ` ${b} is left out because its history starts after your first trade.`)}
            </>
          }
        >
          <Table
            caption="Dollar comparison with benchmarks over the range"
            rows={compare}
            rowKey={(r) => r.key}
            columns={[
              { key: 'name', label: '', render: (r) => <span className="font-semibold whitespace-nowrap">{r.key}</span> },
              { key: 'value', label: 'Value now', numeric: true, render: (r) => money(r.value) },
              { key: 'range', label: 'Over range', numeric: true, render: (r) => <span className={`font-semibold ${tone(r.rangeGain)}`}>{money(r.rangeGain, { signed: true })}</span> },
              { key: 'ret', label: 'Return', numeric: true, render: (r) => <span className={tone(r.ret)}>{pct(r.ret)}</span> },
              {
                key: 'lead',
                label: 'Your lead',
                numeric: true,
                render: (r) =>
                  r.leadMoney === null ? (
                    ''
                  ) : (
                    <span className={`font-semibold ${tone(r.leadMoney)}`}>
                      {money(r.leadMoney, { signed: true })}
                      {r.leadPct !== null && <span className="ml-2 font-medium">({pct(r.leadPct)})</span>}
                    </span>
                  ),
              },
            ]}
          />
        </Section>

        <div className="space-y-10">
          <Section title="Stocks and ETFs" aside={<VsPicker p={p} benchmarks={benchmarks} vs={vs} setVs={setVs} />} info={`Time-weighted return of each group over the range, dividends included, positions sold in the range included. The last column is the group’s return minus ${vs}’s total return over the days the group was invested. A day with a missing price is left out of the return.`}>
            <Table caption={`Stocks and ETFs compared with ${vs}`} rows={groupRows} rowKey={(r) => r.label} columns={[
              { key: 'label', label: 'Group', render: (r) => <span className="font-semibold">{r.label}</span> },
              { key: 'value', label: 'Value', numeric: true, render: (r) => money(r.endValue) },
              { key: 'gain', label: 'Over range', numeric: true, render: (r) => <span className={tone(r.gain)}>{money(r.gain, { signed: true })}</span> },
              { key: 'twr', label: 'Return', numeric: true, render: (r) => <span className={tone(r.twr)} title={r.incompleteDays > 0 ? `${r.incompleteDays} day${r.incompleteDays > 1 ? 's' : ''} with a missing price left out` : undefined}>{pct(r.twr)}</span> },
              vsColumn<(typeof groupRows)[number]>(),
            ]} />
          </Section>

          {p.accounts.length > 1 && (
            <Section title="Accounts" info={`Each account replayed on its own over the range. Returns are not additive. The last column is the account’s return minus ${vs}’s over the days the account was invested, so a young account is compared over its own life; hover it for the dates.`}>
              <Table caption="Accounts over the selected range" rows={p.accounts} rowKey={(r) => r.account} columns={[
                { key: 'account', label: 'Account', render: (r) => <span className="font-semibold">{r.account || '(no account)'}</span> },
                { key: 'value', label: 'Value', numeric: true, render: (r) => money(r.endValue) },
                { key: 'gain', label: 'Over range', numeric: true, render: (r) => <span className={tone(r.gain)}>{money(r.gain, { signed: true })}</span> },
                { key: 'twr', label: 'Return', numeric: true, render: (r) => <span className={tone(r.twr)} title={r.incompleteDays > 0 ? `${r.incompleteDays} day${r.incompleteDays > 1 ? 's' : ''} with a missing price left out` : undefined}>{pct(r.twr)}</span> },
                vsColumn<PerformanceResponse['accounts'][number]>(),
              ]} />
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
      countLabel={view === 'gain' ? 'positions, sold ones included' : 'holdings'}
      info={
        view === 'gain'
          ? 'Each position’s gain over the range: value at the end, minus value at the start, minus what was bought, plus what was sold. Dividends are reinvested, so they are already in the value at the end. These add up to the gain over the range. Return is that gain on the money at work: value at the start plus what was bought. Ahead of SPY compares your gain with a SPY shadow bought on the same dates for the same dollars; a dash means the history needed is unavailable.'
          : 'The ticker’s own price move over the range, split-adjusted. Not your return on it: trades inside the range are ignored.'
      }
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
        p.contribution.length ? (
          <ContributionTable rows={p.contribution} total={p.summary.gain} atWork={p.summary.startValue + p.summary.buys} />
        ) : (
          <Empty title="No positions in this range" />
        )
      ) : p.holdings.length ? (
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
                  {h.assetType === 'ETF' && <span className="ml-1.5 text-[12px] font-medium text-faint">ETF</span>}
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
              render: (h) => <span className={`font-semibold ${tone(h.price?.change)}`}>{pct(h.price?.change)}</span>,
            },
            { key: 'spark', label: <span className="sr-only">Trend</span>, render: (h) => <Sparkline values={h.price?.spark ?? []} />, className: 'hidden sm:table-cell' },
            { key: 'value', label: 'Value at end', numeric: true, sort: (h) => h.value, render: (h) => money(h.value), className: 'hidden md:table-cell' },
          ]}
        />
      ) : (
        <Empty title="Nothing held at the end of this range" />
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
          render: (r) => <span className={`font-semibold ${tone(r.gain)}`}>{money(r.gain, { signed: true })}</span>,
          total: <span className={tone(total)}>{money(total, { signed: true })}</span>,
        },
        {
          key: 'bar',
          label: <span className="sr-only">Contribution bar</span>,
          render: (r) => <GainBar value={r.gain} max={maxAbs} className="h-3.5 w-32" />,
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
                <span className="mt-1 block text-[13px] font-normal text-muted">
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

/** A benchmark's total return from the close before `from` through `to`, from its daily index. Null if either end is missing. */
export function benchmarkBetween(days: { date: string; benchmarks: Record<string, { pct: number | null }> }[], b: string, from: string, to: string): number | null {
  const level = (i: number) => {
    const v = days[i]?.benchmarks[b]?.pct;
    return v == null ? null : 1 + v;
  };
  const a = days.findIndex((d) => d.date >= from);
  let z = days.length - 1;
  while (z > 0 && days[z].date > to) z--;
  if (a < 0 || z < a) return null;
  // The first invested day's return counts for the subset, so start from the close before it.
  const start = a > 0 ? level(a - 1) : level(a);
  const end = level(z);
  return start && end ? end / start - 1 : null;
}

/** A benchmark's return in each calendar month of the range, from its daily total-return index. */
export function benchmarkMonths(days: { date: string; benchmarks: Record<string, { pct: number | null }> }[], b: string): Map<string, number | null> {
  const out = new Map<string, number | null>();
  let prev: number | null = null;
  let month = '';
  let endLevel: number | null = null;
  let broken = false;
  const close = () => {
    if (month) out.set(month, broken || prev === null || endLevel === null ? null : endLevel / prev - 1);
  };
  for (const d of days) {
    const m = d.date.slice(0, 7);
    const v = d.benchmarks[b]?.pct;
    if (m !== month) {
      close();
      // A month starts from the last level of the month before; the first month from its own first day.
      prev = endLevel ?? (v == null ? null : 1 + v);
      month = m;
      broken = false;
    }
    if (v == null) broken = true;
    else endLevel = 1 + v;
  }
  close();
  return out;
}

type MonthMode = 'return' | 'vs';

export function Months() {
  const { p, s, benchmarks, vs, setVs } = useOutletContext<Ctx>();
  const [mode, setMode] = usePersistent<MonthMode>('performance:months', 'return');
  const compare = mode === 'vs' ? benchmarkMonths(s.days, vs) : undefined;
  return (
    <Section
      title={mode === 'vs' ? `Monthly return, against ${vs}` : 'Monthly return'}
      info={
        mode === 'vs'
          ? `Each month’s time-weighted return minus ${vs}’s total return that month, dividends reinvested on both sides. Green months beat it. A month with a dotted underline is partial: the range or your first trade starts inside it.`
          : 'Compounded daily time-weighted returns, including dividends. A month with a dotted underline is partial: the range or your first trade starts inside it. A month with missing prices or no invested days shows a dash.'
      }
      aside={
        <span className="flex flex-wrap items-center gap-3">
          {mode === 'vs' && <VsPicker p={p} benchmarks={benchmarks} vs={vs} setVs={setVs} />}
          <Segmented<MonthMode> label="Show" value={mode} onChange={setMode} options={[{ value: 'return', label: 'Return' }, { value: 'vs', label: 'Against a benchmark' }]} />
        </span>
      }
    >
      <MonthlyReturns months={p.months} compare={compare} />
    </Section>
  );
}

type MoneyView = 'lines' | 'growth';

export function MoneyAddedPage() {
  const { p, s } = useOutletContext<Ctx>();
  const c = useChartColors();
  const data = p.moneyAdded;
  const [period, setPeriod] = useState<'years' | 'months'>('years');
  const [view, setView] = usePersistent<MoneyView>('performance:money', 'lines');
  const valueSeries: SeriesDef[] = [
    { key: 'value', label: 'Market value', color: c.s1, format: (v) => money(v) },
    { key: 'cost', label: 'Money invested', color: c.muted, dashed: true, format: (v) => money(v) },
  ];
  const growthSeries: SeriesDef[] = [{ key: 'growth', label: 'Growth', color: c.s1, area: true, format: (v) => money(v, { signed: true }) }];
  const valueRows = s.days.map((d) => ({ date: d.date, incomplete: d.incomplete, value: d.value, cost: d.cost }));
  const growthRows = s.days.map((d) => ({ date: d.date, incomplete: d.incomplete, growth: d.value - d.cost }));
  return (
    <div>
      <StatRow cols={3}>
        <Stat label="Today’s value" value={money(data.value)} />
        <Stat label="Net money added" value={money(data.added)} info="All history through today, for the selected accounts: buys minus sells. Reinvested dividends are not buys; sale proceeds include reinvested shares." />
        <Stat label="Growth" value={money(data.growth, { signed: true })} tone={tone(data.growth)} info="Today’s value minus net money added, reinvested dividends included. This is not remaining cost basis." />
      </StatRow>
      <Section
        title={view === 'growth' ? 'Growth over the range' : 'Value and money invested over the range'}
        info={
          view === 'growth'
            ? 'Market value minus money invested, day by day: what the portfolio has made beyond what was put in, with reinvested dividends counted as growth.'
            : 'Market value at each close against the money invested at that point (buys minus sells, reinvested dividends excluded). The gap between the lines is the growth.'
        }
        aside={
          <span className="flex flex-wrap items-center gap-4">
            {view === 'lines' && <Legend series={valueSeries} />}
            <Segmented<MoneyView> label="Chart" value={view} onChange={setView} options={[{ value: 'lines', label: 'Value and invested' }, { value: 'growth', label: 'Growth' }]} />
          </span>
        }
      >
        {view === 'growth' ? (
          <LineChartFrame label="Market value minus money invested over time" rows={growthRows} series={growthSeries} yFormat={axisMoney} zeroLine height={320} />
        ) : (
          <LineChartFrame label="Market value and money invested over time" rows={valueRows} series={valueSeries} yFormat={axisMoney} height={320} />
        )}
      </Section>
      <Section
        title="Money added"
        info="Buys minus sells in each period, for the selected accounts. Reinvested dividends are not counted as buys."
        aside={
          <Segmented label="Money added period" value={period} onChange={setPeriod} options={[
            { value: 'years', label: 'By year' }, { value: 'months', label: 'By month' },
          ]} />
        }
      >
        <div className="max-w-3xl">
          {data[period].length ? <Table caption={`${period === 'years' ? 'Yearly' : 'Monthly'} money added`} rows={[...data[period]].reverse()} rowKey={(r) => r.period} showTotals columns={[
            { key: 'period', label: period === 'years' ? 'Year' : 'Month', render: (r) => <span className="num">{r.period}</span>, total: 'Total' },
            { key: 'buys', label: 'Buys', numeric: true, render: (r) => money(r.buys), total: money(data.years.reduce((a, r) => a + r.buys, 0)) },
            { key: 'sells', label: 'Sells', numeric: true, render: (r) => <span className="text-muted">{money(r.sells)}</span>, total: money(data.years.reduce((a, r) => a + r.sells, 0)) },
            { key: 'net', label: 'Money added', numeric: true, render: (r) => <span className="font-semibold">{money(r.net, { signed: true })}</span>, total: money(data.added, { signed: true }) },
          ]} /> : <Empty title="No money added yet" />}
        </div>
      </Section>
    </div>
  );
}
