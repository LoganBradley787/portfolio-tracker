// The chart to explore: the whole history, big, with trades, splits and
// dividends on it. Drag across a stretch to zoom in; step left and right;
// pick a layer. The Overview's chart only shows the value.
import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisMoney, axisTicks, ChartTooltip, incompleteRuns, useChartColors, type Row, type SeriesDef } from '../components/charts.tsx';
import { Button, Empty, ErrorLine, Info, PageHeader, Segmented, Skeleton } from '../components/ui.tsx';
import { PORTFOLIO_TABS } from '../lib/areas.ts';
import { date, money, pct, tone } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { usePersistent } from '../lib/usePersistentRange.ts';

interface Day {
  date: string;
  value: number;
  cost: number;
  incomplete: boolean;
  dividends: number;
}
interface DayEvents {
  date: string;
  buys: string[];
  sells: string[];
  splits: string[];
}
interface SeriesResponse {
  firstDate: string | null;
  days: Day[];
  events: DayEvents[];
}

type Layer = 'buys' | 'sells' | 'splits' | 'dividends' | 'invested';
const LAYERS: { key: Layer; label: string }[] = [
  { key: 'buys', label: 'Buys' },
  { key: 'sells', label: 'Sells' },
  { key: 'splits', label: 'Splits' },
  { key: 'dividends', label: 'Dividends' },
  { key: 'invested', label: 'Money invested' },
];

type Quick = '1M' | '3M' | '6M' | 'YTD' | '1Y' | '3Y' | 'All';
const QUICK: Quick[] = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', 'All'];

function monthsBack(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export default function Chart() {
  const { data, error } = useApi<SeriesResponse>('/api/series');
  const [layers, setLayers] = usePersistent<Layer[]>('chart:layers', ['buys', 'sells', 'dividends']);
  // The window is a pair of indexes into the days; null means everything.
  const [window_, setWindow] = useState<[number, number] | null>(null);
  const [quick, setQuick] = useState<Quick | null>('All');
  const [drag, setDrag] = useState<{ from: string; to: string } | null>(null);
  const c = useChartColors();

  const on = (l: Layer) => layers.includes(l);
  const toggle = (l: Layer) => setLayers(on(l) ? layers.filter((k) => k !== l) : [...layers, l]);

  const all = data?.days ?? [];
  const [lo, hi] = window_ ?? [0, Math.max(0, all.length - 1)];
  const days = all.slice(lo, hi + 1);
  const events = useMemo(() => new Map((data?.events ?? []).map((e) => [e.date, e])), [data]);

  const rows: Row[] = days.map((d) => {
    const e = events.get(d.date);
    const parts = [
      e?.buys.length ? `Bought ${e.buys.join(', ')}` : '',
      e?.sells.length ? `Sold ${e.sells.join(', ')}` : '',
      e?.splits.length ? `Split ${e.splits.join(', ')}` : '',
      d.dividends >= 0.005 ? `Dividends ${money(d.dividends)}` : '',
    ].filter(Boolean);
    return { date: d.date, incomplete: d.incomplete, value: d.value, cost: d.cost, note: parts.length ? parts.join(' · ') : undefined };
  });
  const series: SeriesDef[] = [
    { key: 'value', label: 'Market value', color: c.s1, area: true, format: (v) => money(v) },
    ...(on('invested') ? [{ key: 'cost', label: 'Money invested', color: c.muted, dashed: true, format: (v: number) => money(v) }] : []),
  ];
  const runs = useMemo(() => incompleteRuns(rows), [rows]);
  const x = useMemo(() => axisTicks(rows), [rows]);

  const marks = days.flatMap((d) => {
    const e = events.get(d.date);
    const out: { key: string; date: string; y: number; kind: 'buy' | 'sell' | 'split' | 'dividend'; amount?: number }[] = [];
    if (on('buys') && e?.buys.length) out.push({ key: `b${d.date}`, date: d.date, y: d.value, kind: 'buy' });
    if (on('sells') && e?.sells.length) out.push({ key: `s${d.date}`, date: d.date, y: d.value, kind: 'sell' });
    if (on('splits') && e?.splits.length) out.push({ key: `x${d.date}`, date: d.date, y: d.value, kind: 'split' });
    if (on('dividends') && d.dividends >= 0.005) out.push({ key: `d${d.date}`, date: d.date, y: d.value, kind: 'dividend', amount: d.dividends });
    return out;
  });
  const dense = days.length > 400;
  const maxDividend = Math.max(...marks.filter((m) => m.kind === 'dividend').map((m) => m.amount ?? 0), 1e-9);

  const zoomTo = (fromDate: string, toDate: string) => {
    const a = all.findIndex((d) => d.date >= fromDate);
    let b = all.length - 1;
    while (b > 0 && all[b].date > toDate) b--;
    if (a < 0 || b - a < 2) return;
    setWindow([a, b]);
    setQuick(null);
  };
  const pick = (q: Quick) => {
    setQuick(q);
    if (q === 'All' || !all.length) return setWindow(null);
    const last = all[all.length - 1].date;
    const from = q === 'YTD' ? `${last.slice(0, 4)}-01-01` : monthsBack(last, { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '3Y': 36 }[q]);
    const a = Math.max(0, all.findIndex((d) => d.date >= from));
    setWindow([a, all.length - 1]);
  };
  const step = (dir: -1 | 1) => {
    const width = hi - lo;
    const by = Math.max(1, Math.round(width / 4));
    const a = Math.max(0, Math.min(all.length - 1 - width, lo + dir * by));
    setWindow([a, a + width]);
    setQuick(null);
  };
  const widen = () => {
    const width = hi - lo;
    const a = Math.max(0, lo - Math.round(width / 2));
    const b = Math.min(all.length - 1, hi + Math.round(width / 2));
    const whole = a === 0 && b === all.length - 1;
    setWindow(whole ? null : [a, b]);
    setQuick(whole ? 'All' : null);
  };

  const header = (
    <PageHeader
      tabs={PORTFOLIO_TABS}
      controls={
        <Segmented<Quick> label="Range" value={quick} onChange={pick} options={QUICK.map((q) => ({ value: q, label: q }))} />
      }
    />
  );
  if (error && !data) return <>{header}<ErrorLine error={error} /></>;
  if (!data) return <>{header}<Skeleton rows={12} /></>;
  if (!all.length) return <>{header}<Empty title="Nothing to chart yet">Add transactions under Data.</Empty></>;

  const first = days[0];
  const last = days[days.length - 1];
  const gain = last.value - first.value - (last.cost - first.cost);

  return (
    <div>
      {header}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <p className="num flex flex-wrap items-baseline gap-x-3">
            <span className="text-[34px] font-semibold tracking-tight text-ink">{money(last.value)}</span>
            <span className={`text-[18px] font-semibold ${tone(gain)}`}>
              {money(gain, { signed: true })}
              {first.value > 0 && <span className="ml-2 font-medium">{pct(gain / first.value)}</span>}
            </span>
          </p>
          <div className="num mt-1 flex items-center gap-2 text-[14px] text-muted">
            {date(first.date)} – {date(last.date)} · {days.length} trading days
            <Info label="About this chart">
              Market value of the selected accounts at each close. Drag across any stretch of the chart to zoom into it; use the arrows to step through time and the range buttons to jump.
              The gain shown is value at the end minus value at the start, with money added or taken out removed. Dividend dots are sized by the amount paid that day; buys are filled dots, sells are open, splits are crosses.
            </Info>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Layers" className="flex flex-wrap gap-1">
            {LAYERS.map((l) => (
              <button
                key={l.key}
                type="button"
                aria-pressed={on(l.key)}
                onClick={() => toggle(l.key)}
                className={`h-8 rounded-md border px-3 text-[13px] font-semibold transition-colors ${on(l.key) ? 'border-ink bg-ink text-bg' : 'border-rule-strong/60 text-muted hover:border-ink hover:text-ink'}`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <span className="mx-1 hidden h-6 w-px bg-rule-strong/60 sm:inline-block" />
          <Button size="sm" onClick={() => step(-1)} disabled={lo === 0} aria-label="Earlier">←</Button>
          <Button size="sm" onClick={() => step(1)} disabled={hi >= all.length - 1} aria-label="Later">→</Button>
          <Button size="sm" onClick={widen} disabled={window_ === null}>Zoom out</Button>
        </div>
      </div>

      <figure aria-label="Portfolio market value with trades and dividends" className="m-0 select-none">
        <div style={{ height: 520 }} className="cursor-crosshair">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={rows}
              margin={{ top: 16, right: 84, bottom: 0, left: 0 }}
              onMouseDown={(e) => e?.activeLabel && setDrag({ from: String(e.activeLabel), to: String(e.activeLabel) })}
              onMouseMove={(e) => drag && e?.activeLabel && setDrag({ ...drag, to: String(e.activeLabel) })}
              onMouseUp={() => {
                if (drag && drag.from !== drag.to) zoomTo(drag.from < drag.to ? drag.from : drag.to, drag.from < drag.to ? drag.to : drag.from);
                setDrag(null);
              }}
              onMouseLeave={() => setDrag(null)}
            >
              <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
              {runs.map(([a, b]) => (
                <ReferenceArea key={a} x1={a} x2={b} fill={c.shade} fillOpacity={0.8} ifOverflow="hidden" />
              ))}
              <XAxis dataKey="date" ticks={x.ticks} tickFormatter={x.format} minTickGap={28} interval="preserveStartEnd" tick={{ fill: c.text, fontSize: 12, fontWeight: 500 }} tickLine={false} axisLine={{ stroke: c.axis, strokeOpacity: 0.6 }} />
              <YAxis tickFormatter={axisMoney} tick={{ fill: c.text, fontSize: 12, fontWeight: 500 }} tickLine={false} axisLine={false} width={64} tickCount={7} domain={['auto', 'auto']} />
              <Tooltip content={<ChartTooltip series={series} />} cursor={{ stroke: c.axis, strokeWidth: 1 }} isAnimationActive={false} />
              <Area type="linear" dataKey="value" stroke={c.s1} strokeWidth={2} fill={c.s1} fillOpacity={0.06} dot={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 1.5, fill: c.s1 }} isAnimationActive={false} connectNulls />
              {on('invested') && <Line type="stepAfter" dataKey="cost" stroke={c.muted} strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={false} isAnimationActive={false} />}
              {marks.map((m) =>
                m.kind === 'dividend' ? (
                  <ReferenceDot key={m.key} x={m.date} y={m.y} r={dense ? 3 : 3 + 6 * Math.sqrt((m.amount ?? 0) / maxDividend)} fill={c.s2} fillOpacity={0.85} stroke={c.surface} strokeWidth={1} ifOverflow="extendDomain" />
                ) : (
                  <ReferenceDot
                    key={m.key}
                    x={m.date}
                    y={m.y}
                    r={dense ? 3 : 4.5}
                    fill={m.kind === 'buy' ? c.ink : c.surface}
                    stroke={c.ink}
                    strokeWidth={1.5}
                    ifOverflow="extendDomain"
                    label={dense || m.kind !== 'split' ? undefined : { value: '×', position: 'top', fill: c.ink, fontSize: 13, fontWeight: 700 }}
                  />
                ),
              )}
              <ReferenceDot x={last.date} y={last.value} r={3} fill={c.s1} stroke="none" ifOverflow="visible" label={{ value: money(last.value), position: 'right', fill: c.s1, fontSize: 12, fontWeight: 600 }} />
              {drag && drag.from !== drag.to && <ReferenceArea x1={drag.from} x2={drag.to} fill={c.ink} fillOpacity={0.08} stroke={c.ink} strokeOpacity={0.4} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] font-medium text-muted">
          <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: c.s1 }} />Market value</span>
          {on('invested') && <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: c.muted }} />Money invested</span>}
          {on('buys') && <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: c.ink }} />Buy</span>}
          {on('sells') && <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-full border-[1.5px]" style={{ borderColor: c.ink }} />Sell</span>}
          {on('splits') && <span className="flex items-center gap-1.5"><span aria-hidden className="font-bold text-ink">×</span>Split</span>}
          {on('dividends') && <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: c.s2 }} />Dividend, sized by amount</span>}
          {runs.length > 0 && <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: c.shade }} />Incomplete day</span>}
        </figcaption>
      </figure>

      <details className="mt-6 text-[13px]">
        <summary className="inline cursor-pointer font-semibold text-muted hover:text-ink">Show the data table</summary>
        <div className="mt-3 max-h-80 overflow-auto border-y border-rule">
          <table className="w-full text-[14px]">
            <thead className="sticky top-0 bg-bg text-muted">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">Date</th>
                <th className="px-2 py-1.5 text-right font-semibold">Market value</th>
                <th className="px-2 py-1.5 text-right font-semibold">Money invested</th>
                <th className="px-2 py-1.5 text-right font-semibold">Dividends</th>
                <th className="px-2 py-1.5 text-left font-semibold">Trades</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => {
                const e = events.get(d.date);
                return (
                  <tr key={d.date} className="border-t border-rule">
                    <td className="num px-2 py-1">{d.date}</td>
                    <td className="num px-2 py-1 text-right">{money(d.value)}</td>
                    <td className="num px-2 py-1 text-right text-muted">{money(d.cost)}</td>
                    <td className="num px-2 py-1 text-right text-muted">{d.dividends >= 0.005 ? money(d.dividends) : ''}</td>
                    <td className="px-2 py-1 text-muted">{[e?.buys.length ? `Buy ${e.buys.join(', ')}` : '', e?.sells.length ? `Sell ${e.sells.join(', ')}` : '', e?.splits.length ? `Split ${e.splits.join(', ')}` : ''].filter(Boolean).join(' · ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
