import { Link } from 'react-router-dom';
import { axisMoney, Legend, LineChartFrame, Sparkline, useChartColors, type Row, type SeriesDef } from '../components/charts.tsx';
import { RangeSelector } from '../components/RangeSelector.tsx';
import { Table } from '../components/Table.tsx';
import { TickerLink } from '../components/TickerLink.tsx';
import type { MoneyAdded as MoneyBreakdown } from '../../../src/engine/moneyAdded.ts';
import { MoneyAdded } from '../components/MoneyAdded.tsx';
import { MonthlyReturns } from '../components/MonthlyReturns.tsx';
import { CustomBenchmark } from '../components/CustomBenchmark.tsx';
import { useRefresh } from '../lib/refresh.tsx';
import type { MonthReturn } from '../../../src/engine/returns.ts';
import { Empty, ErrorLine, Notice, PageTitle, Section, Skeleton } from '../components/ui.tsx';
import { date, money, pct, tone } from '../lib/format.ts';
import { rangeQuery } from '../lib/range.ts';
import { useApi } from '../lib/useApi.ts';
import { usePersistent, usePersistentRange } from '../lib/usePersistentRange.ts';

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

export default function Performance() {
  const config = useApi<{ today: string; customBenchmark: string | null }>('/api/config');
  const { bump, poke } = useRefresh();
  const [range, setRange] = usePersistentRange('performance', { preset: '1Y' });
  // Lines turned off on the return chart. VT starts off.
  const [hidden, setHidden] = usePersistent<string[]>('performance:hiddenSeries', ['VT']);
  const today = config.data?.today;
  const q = today ? rangeQuery(range, today) : null;
  const series = useApi<SeriesResponse>(q === null ? null : `/api/series${q}`);
  const perf = useApi<PerformanceResponse>(q === null ? null : `/api/performance${q}`);
  const c = useChartColors();
  const benchmarks = [...new Set(['SPY', 'QQQ', 'VT', ...(config.data?.customBenchmark ? [config.data.customBenchmark] : [])])];
  const changedBenchmark = (custom: string | null) => {
    if (custom) setHidden(hidden.filter((k) => k !== custom));
    bump();
    poke();
  };

  const error = series.error ?? perf.error;
  if (error && !perf.data) return <ErrorLine error={error} />;
  const p = perf.data;
  const s = series.data;
  const loading = series.loading || perf.loading;

  const header = (
    <PageTitle title="Performance" aside={<RangeSelector value={range} onChange={setRange} min={s?.firstDate} max={today} />}>
      {p?.summary.from ? `${date(p.summary.from)} to ${date(p.summary.to)}` : 'Portfolio against SPY, QQQ and VT'}
    </PageTitle>
  );
  if (!p || !s) return (<>{header}<Skeleton rows={8} /></>);
  if (!s.firstDate) {
    return (
      <>
        {header}
        <Empty title="Nothing to chart yet">
          Add transactions on the <Link className="font-medium text-accent hover:underline" to="/transactions">Transactions</Link> page.
        </Empty>
      </>
    );
  }
  if (!s.days.length) return (<>{header}<Empty title="No trading days in this range">Pick a wider range.</Empty></>);

  const spy = p.benchmarks.SPY;
  const qqq = p.benchmarks.QQQ;
  const returnSeries: SeriesDef[] = [
    { key: 'twr', label: 'Portfolio (time-weighted)', color: c.s1, format: (v) => pct(v) },
    ...benchmarks.map((b, i) => ({ key: b, label: `${b} (total return)`, color: [c.s2, c.s3, c.s4, c.muted][i], format: (v: number) => pct(v) })),
  ];
  const shownSeries = returnSeries.filter((x) => !hidden.includes(x.key));
  const toggle = (key: string) => setHidden(hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key]);
  const returnRows: Row[] = s.days.map((d) => ({ date: d.date, incomplete: d.incomplete, twr: d.twr, ...Object.fromEntries(benchmarks.map((b) => [b, d.benchmarks[b]?.pct])) }));
  const missing = benchmarks.filter((b) => !p.benchmarks[b]?.available);
  const valueSeries: SeriesDef[] = [
    { key: 'value', label: 'Market value', color: c.s1, area: true, format: (v) => money(v) },
    { key: 'cost', label: 'Cost basis (invested)', color: c.muted, format: (v) => money(v) },
  ];
  const valueRows = s.days.map((d) => ({ date: d.date, incomplete: d.incomplete, value: d.value, cost: d.cost }));
  const last = returnRows.at(-1)!;
  const yPct = (v: number) => `${Math.round(v * 100)}%`;
  const yMoney = axisMoney;

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
    <div className={loading ? 'opacity-80 transition-opacity' : 'transition-opacity'}>
      {header}
      {missing.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn" title="Benchmark prices haven’t loaded yet">
            {missing.map((b) => `${b}${p.benchmarks[b]?.error ? `: ${p.benchmarks[b].error}` : ''}`).join(' · ')}.
            Check Data health if a ticker cannot be found.
          </Notice>
        </div>
      )}
      {p.incompleteDays > 0 && (
        <div className="mb-4">
          <Notice tone="warn" title={`${p.incompleteDays} day${p.incompleteDays > 1 ? 's' : ''} in this range ${p.incompleteDays > 1 ? 'are' : 'is'} incomplete`}>
            Some prices are still loading. Those days are left out of the time-weighted return and shaded on the charts.
          </Notice>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-6 border-y border-rule-strong sm:grid-cols-4">
        {[
          ['Gain over range', money(p.summary.gain, { signed: true }), tone(p.summary.gain), p.summary.dividends ? `incl. ${money(p.summary.dividends)} dividends` : null],
          ['Time-weighted return', pct(p.twr), tone(p.twr), p.twrAnnualized !== null ? `${pct(p.twrAnnualized)} a year` : null],
          [
            'Money-weighted (IRR)',
            p.irr === null ? 'n/a' : `${pct(p.irr)}`,
            p.irr === null ? 'text-muted' : tone(p.irr),
            p.irr === null ? 'Needs 30+ days and money in and out' : 'a year',
          ],
          ['Volatility', p.volatility === null ? 'n/a' : pct(p.volatility, { signed: false }), '', 'annualized'],
          ['SPY total return', pct(spy?.totalReturn), '', spy?.priceReturn != null ? `${pct(spy.priceReturn)} price only` : null],
          ['QQQ total return', pct(qqq?.totalReturn), '', qqq?.priceReturn != null ? `${pct(qqq.priceReturn)} price only` : null],
          [
            'Max drawdown',
            pct(p.drawdown.max),
            p.drawdown.max < 0 ? 'text-loss' : '',
            p.drawdown.troughDate ? `${date(p.drawdown.peakDate)} → ${date(p.drawdown.troughDate)}` : null,
          ],
          ['Value at start · net in', money(p.summary.startValue), '', `${money(p.summary.buys - p.summary.sells, { signed: true })} added`],
        ].map(([k, v, cls, sub]) => (
          <div key={k} className="min-w-0 border-b border-rule py-3 [&:nth-last-child(-n+2)]:border-b-0 sm:[&:nth-last-child(-n+4)]:border-b-0">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className={`num mt-0.5 text-lg leading-7 font-semibold tracking-tight ${cls}`}>{v}</dd>
            {sub && <dd className="text-xs text-muted">{sub}</dd>}
          </div>
        ))}
      </dl>

      <Section
        title="Return over the range"
        aside={(
          <Legend
            series={returnSeries}
            values={Object.fromEntries(returnSeries.map((x) => [x.key, pct(last[x.key] as number)]))}
            hidden={hidden}
            onToggle={toggle}
          />
        )}
      >
        <LineChartFrame label="Portfolio time-weighted return against benchmark total return" rows={returnRows} series={shownSeries} yFormat={yPct} zeroLine />
        <p className="mt-1 max-w-prose text-xs text-muted">
          The portfolio line is time-weighted, so money added or withdrawn doesn’t count as gain; dividends
          received count as return. The benchmarks are total return, with their dividends reinvested on each
          ex-date. Click a name in the legend to hide or show its line.
        </p>
        {benchmarks
          .filter((b) => p.benchmarks[b]?.available && p.benchmarks[b].totalReturn === null)
          .map((b) => (
            <p key={b} className="mt-2 text-xs text-warn">
              {b}: the selected range starts before its available history ({date(p.benchmarks[b].firstDate)}).
              Choose a later start to compare returns.
            </p>
          ))}
        <CustomBenchmark ticker={config.data?.customBenchmark ?? null} onChanged={changedBenchmark} />
      </Section>

      <Section title="Stocks versus ETFs">
        <Table caption="Stocks and ETFs compared with SPY" rows={[
          ...p.groups.map((g) => ({ label: g.assetType === 'Stock' ? 'Individual stocks' : 'ETFs', ...g })),
          { label: 'SPY', endValue: null, gain: null, twr: spy?.totalReturn ?? null, incompleteDays: 0 },
        ]} rowKey={(r) => r.label} columns={[
          { key: 'label', label: 'Group', render: (r) => <span className="font-semibold">{r.label}</span> },
          { key: 'value', label: 'Value at end', numeric: true, render: (r) => money(r.endValue) },
          { key: 'gain', label: 'Gain over range', numeric: true, render: (r) => <span className={tone(r.gain)}>{money(r.gain, { signed: true })}</span> },
          { key: 'twr', label: 'Total return', numeric: true, render: (r) => <span className={tone(r.twr)}>{pct(r.twr)}{r.incompleteDays > 0 ? ' *' : ''}</span> },
        ]} />
        <p className="mt-2 text-xs text-muted">
          Groups use time-weighted returns, including dividends and positions sold during the range. ETFs
          include every security marked ETF, including funds that do not track an index. * Missing-price days
          are excluded.
        </p>
      </Section>

      <MoneyAdded data={p.moneyAdded} />

      <Section title="Monthly returns"><MonthlyReturns months={p.months} /></Section>

      {p.accounts.length > 1 && <Section title="Accounts side by side">
        <Table caption="Accounts over the selected range" rows={p.accounts} rowKey={(r) => r.account} columns={[
          { key: 'account', label: 'Account', render: (r) => <span className="font-semibold">{r.account || '(no account)'}</span> },
          { key: 'value', label: 'Value at end', numeric: true, render: (r) => money(r.endValue) },
          { key: 'gain', label: 'Gain over range', numeric: true, render: (r) => <span className={tone(r.gain)}>{money(r.gain, { signed: true })}</span> },
          { key: 'twr', label: 'Time-weighted return', numeric: true, render: (r) => <span className={tone(r.twr)}>{pct(r.twr)}{r.incompleteDays > 0 ? ' *' : ''}</span> },
        ]} />
        <p className="mt-2 text-xs text-muted">
          Each selected account is replayed independently, with dividends included. * Missing-price days are
          excluded. Returns are not additive.
        </p>
      </Section>}

      <Section title="Drawdown">
        <LineChartFrame
          label="Drawdown from the highest point so far, time-weighted"
          rows={p.drawdown.series.map((d, i) => ({ date: d.date, incomplete: s.days[i]?.incomplete, drawdown: d.drawdown }))}
          series={[{ key: 'drawdown', label: 'Drawdown', color: c.s1, area: true, format: (v) => pct(v) }]}
          yFormat={yPct}
          height={160}
        />
        <p className="mt-1 text-xs text-muted">Fall from the highest point so far in the range, on the time-weighted index, so money added can’t hide a fall.</p>
      </Section>

      <Section title="What drove the gain" count={p.contribution.length}>
        <p className="mb-2.5 max-w-prose text-[13px] text-muted">
          Each position’s gain over the range: value at the end, minus value at the start, minus what was
          bought, plus what was sold. Dividends are reinvested, so they are already in the value at the end.
          These add up to the gain over the range. Return is that gain on the money at work in the position:
          its value at the start plus what was bought.
        </p>
        <p className="mb-2.5 max-w-prose text-xs text-muted">
          Ahead of SPY compares your gain with a SPY shadow bought on the same dates for the same dollars,
          with the same fractions sold and SPY dividends reinvested. Positive means your position gained more
          dollars. A dash means the history needed for the comparison is unavailable.
        </p>
        {p.contribution.length ? (
          <ContributionTable
            rows={p.contribution}
            total={p.summary.gain}
            atWork={p.summary.startValue + p.summary.buys}
          />
        ) : (
          <Empty title="No positions in this range" />
        )}
      </Section>

      <Section title="Invested vs value" aside={<Legend series={valueSeries} />}>
        <LineChartFrame label="Market value and cost basis over time" rows={valueRows} series={valueSeries} yFormat={yMoney} height={240} />
      </Section>

      <Section title="Same money in a benchmark">
        <p className="mb-2.5 max-w-prose text-[13px] text-muted">
          Each buy puts the same dollars into the benchmark on that day; selling part of a holding sells the
          same part of its benchmark shadow. Dividends are reinvested on both sides: yours buy more of the
          same ticker, the benchmark’s buy more of the benchmark.
        </p>
        {benchmarks
          .filter((b) => p.benchmarks[b]?.available && !p.benchmarks[b].shadowAvailable)
          .map((b) => (
            <p key={b} className="mb-2 text-xs text-warn">
              {b} is omitted here because its history starts after your first trade.
              Its return line can still be compared over a later range.
            </p>
          ))}
        <Table
          caption="Dollar comparison with benchmarks"
          rows={compare}
          rowKey={(r) => r.key}
          columns={[
            { key: 'name', label: '', render: (r) => <span className="font-semibold whitespace-nowrap">{r.key}</span> },
            { key: 'value', label: 'Value now', numeric: true, render: (r) => money(r.value) },
            { key: 'cost', label: 'Cost basis', numeric: true, render: (r) => money(r.cost), className: 'hidden md:table-cell' },
            {
              key: 'unrealized',
              label: 'Unrealized',
              numeric: true,
              render: (r) => <span className={tone(r.unrealized)}>{money(r.unrealized, { signed: true })}</span>,
              className: 'hidden lg:table-cell',
            },
            {
              key: 'realized',
              label: 'Realized',
              numeric: true,
              render: (r) => <span className={tone(r.realized)}>{money(r.realized, { signed: true })}</span>,
              className: 'hidden lg:table-cell',
            },
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
                  {r.key === 'Portfolio' ? money(r.dividends, { signed: true }) : `(${money(r.dividends)} reinvested)`}
                </span>
              ),
              className: 'hidden lg:table-cell',
            },
            { key: 'total', label: 'Total gain', numeric: true, render: (r) => <span className={tone(r.total)}>{money(r.total, { signed: true })}</span> },
            { key: 'range', label: 'Gain over range', numeric: true, render: (r) => <span className={tone(r.rangeGain)}>{money(r.rangeGain, { signed: true })}</span> },
          ]}
        />
      </Section>

      <Section title="Holdings: price change over the range" count={p.holdings.length}>
        <p className="mb-2.5 text-[13px] text-muted">The ticker’s own price move, split-adjusted. Not your return on it: trades inside the range are ignored.</p>
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
                    {h.assetType === 'ETF' && <span className="ml-1.5 text-[11px] text-muted">ETF</span>}
                  </span>
                ),
              },
              { key: 'start', label: 'Start', numeric: true, sort: (h) => h.price?.start ?? null, render: (h) => money(h.price?.start) },
              { key: 'end', label: 'End', numeric: true, sort: (h) => h.price?.end ?? null, render: (h) => money(h.price?.end) },
              {
                key: 'change',
                label: 'Change',
                numeric: true,
                sort: (h) => h.price?.change ?? null,
                render: (h) => <span className={tone(h.price?.change)}>{pct(h.price?.change)}</span>,
              },
              { key: 'spark', label: <span className="sr-only">Trend</span>, render: (h) => <Sparkline values={h.price?.spark ?? []} />, className: 'hidden sm:table-cell' },
              { key: 'value', label: 'Value at end', numeric: true, sort: (h) => h.value, render: (h) => money(h.value), className: 'hidden md:table-cell' },
            ]}
          />
        ) : (
          <Empty title="Nothing held at the end of this range" />
        )}
      </Section>
    </div>
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
        { key: 'start', label: 'Value at start', numeric: true, sort: (r) => r.startValue, render: (r) => money(r.startValue), className: 'hidden md:table-cell' },
        {
          key: 'buys',
          label: 'Bought',
          numeric: true,
          sort: (r) => r.buys,
          render: (r) => (r.buys ? money(r.buys) : <span className="text-muted">—</span>),
          className: 'hidden lg:table-cell',
        },
        {
          key: 'sells',
          label: 'Sold',
          numeric: true,
          sort: (r) => r.sells,
          render: (r) => (r.sells ? money(r.sells) : <span className="text-muted">—</span>),
          className: 'hidden lg:table-cell',
        },
        {
          key: 'divs',
          label: 'Dividends',
          title: 'Reinvested, so already in the value at the end',
          numeric: true,
          sort: (r) => r.dividends,
          render: (r) => (r.dividends ? money(r.dividends) : <span className="text-muted">—</span>),
          className: 'hidden lg:table-cell',
        },
        { key: 'end', label: 'Value at end', numeric: true, sort: (r) => r.endValue, render: (r) => money(r.endValue), className: 'hidden sm:table-cell' },
        {
          key: 'gain',
          label: 'Contribution',
          numeric: true,
          sort: (r) => r.gain,
          render: (r) => <span className={tone(r.gain)}>{money(r.gain, { signed: true })}</span>,
          total: <span className={tone(total)}>{money(total, { signed: true })}</span>,
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
          render: (r) => <span className={tone(r.gain)}>{pct(r.share)}</span>,
          total: rows[0]?.share == null ? '—' : pct(1, { signed: false }),
          className: 'hidden sm:table-cell',
        },
        {
          key: 'bar',
          label: <span className="sr-only">Contribution bar</span>,
          render: (r) => (
            <span aria-hidden className="relative block h-3 w-40">
              <span className="absolute inset-y-0 left-1/2 w-px bg-rule-strong" />
              <span
                className={`absolute inset-y-0.5 ${r.gain >= 0 ? 'left-1/2 rounded-r-[3px] bg-gain/70' : 'right-1/2 rounded-l-[3px] bg-loss/70'}`}
                style={{ width: `${(Math.abs(r.gain) / maxAbs) * 50}%` }}
              />
            </span>
          ),
          className: 'hidden md:table-cell',
        },
      ]}
    />
  );
}
