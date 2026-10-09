// The chart to explore: the whole history, big, with trades, splits and
// dividends on it. Drag across a stretch to zoom in; scroll to pan and zoom;
// pick a layer. The Overview's chart only shows the value.
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
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

/**
 * The event layers are strokeless lines whose dots are the marks, drawn from
 * columns on the same rows as the value. That keeps the tooltip's index honest
 * (a Scatter with its own data confuses it) and makes hundreds of marks one element.
 */
function markShape(kind: 'buy' | 'sell' | 'split', dense: boolean, c: ReturnType<typeof useChartColors>) {
  return (props: { cx?: number | null; cy?: number | null; value?: number | null; key?: string }) => {
    const { cx, cy } = props;
    if (cx == null || cy == null || props.value == null) return null;
    const r = dense ? 3 : 4.5;
    return (
      <g key={props.key}>
        <circle cx={cx} cy={cy} r={r} fill={kind === 'buy' ? c.ink : c.surface} stroke={c.ink} strokeWidth={1.5} />
        {kind === 'split' && !dense && (
          <text x={cx} y={cy - r - 3} textAnchor="middle" fill={c.ink} fontSize={13} fontWeight={700}>
            ×
          </text>
        )}
      </g>
    );
  };
}

export default function Chart() {
  const { data, error } = useApi<SeriesResponse>('/api/series');
  const [layers, setLayers] = usePersistent<Layer[]>('chart:layers', ['buys', 'sells', 'dividends']);
  // The window is a pair of indexes into the days; null means everything.
  const [window_, setWindow] = useState<[number, number] | null>(null);
  const [quick, setQuick] = useState<Quick | null>('All');
  const c = useChartColors();
  // Dragging never touches React state: the selection is a div moved by hand,
  // and the chart is only re-rendered once, when the mouse is released.
  const box = useRef<HTMLDivElement>(null);
  const selection = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: string; to: string; fromX: number; toX: number } | null>(null);
  const wheel = useRef({ x: 0, y: 0, at: 0.5, pending: false });

  const on = (l: Layer) => layers.includes(l);
  const toggle = (l: Layer) => setLayers(on(l) ? layers.filter((k) => k !== l) : [...layers, l]);

  const all = useMemo(() => data?.days ?? [], [data]);
  const [lo, hi] = window_ ?? [0, Math.max(0, all.length - 1)];
  const days = useMemo(() => all.slice(lo, hi + 1), [all, lo, hi]);
  const events = useMemo(() => new Map((data?.events ?? []).map((e) => [e.date, e])), [data]);

  const rows: Row[] = useMemo(
    () =>
      days.map((d) => {
        const e = events.get(d.date);
        const parts = [
          e?.buys.length ? `Bought ${e.buys.join(', ')}` : '',
          e?.sells.length ? `Sold ${e.sells.join(', ')}` : '',
          e?.splits.length ? `Split ${e.splits.join(', ')}` : '',
          d.dividends >= 0.005 ? `Dividends ${money(d.dividends)}` : '',
        ].filter(Boolean);
        return {
          date: d.date,
          incomplete: d.incomplete,
          value: d.value,
          cost: d.cost,
          note: parts.length ? parts.join(' · ') : undefined,
          buy: e?.buys.length ? d.value : null,
          sell: e?.sells.length ? d.value : null,
          split: e?.splits.length ? d.value : null,
          dividend: d.dividends >= 0.005 ? d.value : null,
          dividendAmount: d.dividends,
        };
      }),
    [days, events],
  );
  const series: SeriesDef[] = useMemo(
    () => [
      { key: 'value', label: 'Market value', color: c.s1, area: true, format: (v) => money(v) },
      ...(on('invested') ? [{ key: 'cost', label: 'Money invested', color: c.muted, dashed: true, format: (v: number) => money(v) }] : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, layers],
  );
  const runs = useMemo(() => incompleteRuns(rows), [rows]);
  const x = useMemo(() => axisTicks(rows), [rows]);

  const dense = days.length > 400;
  const maxDividend = Math.max(...days.map((d) => d.dividends), 1e-9);
  const dividendShape = useMemo(
    () => (props: { cx?: number | null; cy?: number | null; value?: number | null; payload?: Row; key?: string }) => {
      if (props.cx == null || props.cy == null || props.value == null) return null;
      const amount = Number(props.payload?.dividendAmount ?? 0);
      return <circle key={props.key} cx={props.cx} cy={props.cy} r={dense ? 3 : 3 + 6 * Math.sqrt(amount / maxDividend)} fill={c.s2} fillOpacity={0.85} stroke={c.surface} strokeWidth={1} />;
    },
    [dense, maxDividend, c],
  );
  const markLine = (key: string, shape: (p: any) => ReactElement | null) => (
    <Line key={key} dataKey={key} stroke="none" dot={shape} activeDot={false} isAnimationActive={false} legendType="none" tooltipType="none" />
  );

  const setRange = (a: number, b: number) => {
    const lo2 = Math.max(0, Math.min(a, b));
    const hi2 = Math.min(all.length - 1, Math.max(a, b));
    if (hi2 - lo2 < 2) return;
    const whole = lo2 === 0 && hi2 === all.length - 1;
    setWindow(whole ? null : [lo2, hi2]);
    setQuick(whole ? 'All' : null);
  };
  const zoomTo = (fromDate: string, toDate: string) => {
    const a = all.findIndex((d) => d.date >= fromDate);
    let b = all.length - 1;
    while (b > 0 && all[b].date > toDate) b--;
    if (a < 0) return;
    setRange(a, b);
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
    setRange(lo - Math.round(width / 2), hi + Math.round(width / 2));
  };

  // Scrolling sideways pans; scrolling up and down zooms around the pointer.
  // Deltas are gathered and applied once a frame so a trackpad cannot flood the chart.
  const windowRef = useRef<[number, number]>([lo, hi]);
  windowRef.current = [lo, hi];
  const lengthRef = useRef(all.length);
  lengthRef.current = all.length;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const apply = () => {
      const w = wheel.current;
      w.pending = false;
      const [a, b] = windowRef.current;
      const n = lengthRef.current;
      const width = b - a;
      const { x: dx, y: dy, at } = w;
      w.x = 0;
      w.y = 0;
      if (Math.abs(dx) >= Math.abs(dy)) {
        const by = Math.round((dx / Math.max(el.clientWidth, 1)) * width);
        if (!by) return;
        const lo2 = Math.max(0, Math.min(n - 1 - width, a + by));
        setWindow([lo2, lo2 + width]);
        setQuick(null);
      } else {
        const factor = dy > 0 ? 1.2 : 1 / 1.2;
        const newWidth = Math.min(n - 1, Math.max(5, Math.round(width * factor)));
        const anchor = a + at * width;
        const lo2 = Math.round(anchor - at * newWidth);
        const lo3 = Math.max(0, Math.min(n - 1 - newWidth, lo2));
        const whole = lo3 === 0 && lo3 + newWidth >= n - 1;
        setWindow(whole ? null : [lo3, lo3 + newWidth]);
        setQuick(whole ? 'All' : null);
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const w = wheel.current;
      w.x += e.deltaX;
      w.y += e.deltaY;
      w.at = Math.min(1, Math.max(0, (e.clientX - el.getBoundingClientRect().left) / Math.max(el.clientWidth, 1)));
      if (!w.pending) {
        w.pending = true;
        requestAnimationFrame(apply);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // The figure only exists once the data is in, so attach again when it appears.
  }, [all.length]);

  const pointerX = (ev: { clientX: number }) => ev.clientX - (box.current?.getBoundingClientRect().left ?? 0);
  const paint = () => {
    const d = drag.current;
    const sel = selection.current;
    if (!sel) return;
    if (!d || d.fromX === d.toX) {
      sel.style.display = 'none';
      return;
    }
    sel.style.display = 'block';
    sel.style.left = `${Math.min(d.fromX, d.toX)}px`;
    sel.style.width = `${Math.abs(d.toX - d.fromX)}px`;
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
              {first.value > 0 && <span className="ml-2 font-medium">({pct(gain / first.value)})</span>}
            </span>
          </p>
          <div className="num mt-1 flex items-center gap-2 text-[14px] text-muted">
            {date(first.date)} – {date(last.date)} · {days.length} trading days
            <Info label="About this chart">
              Market value of the selected accounts at each close. Drag across any stretch of the chart to zoom into it. Scroll sideways to pan, scroll up or down to zoom around the pointer, or use the arrows and the range buttons.
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
        <div ref={box} style={{ height: 520 }} className="relative cursor-crosshair overscroll-contain">
          <div ref={selection} aria-hidden className="pointer-events-none absolute inset-y-4 z-10 hidden border-x border-ink/40 bg-ink/[0.08]" />
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={rows}
              margin={{ top: 16, right: 84, bottom: 0, left: 0 }}
              onMouseDown={(e, ev) => {
                if (!e?.activeLabel) return;
                const px = pointerX(ev);
                drag.current = { from: String(e.activeLabel), to: String(e.activeLabel), fromX: px, toX: px };
                paint();
              }}
              onMouseMove={(e, ev) => {
                const d = drag.current;
                if (!d || !e?.activeLabel) return;
                d.to = String(e.activeLabel);
                d.toX = pointerX(ev);
                paint();
              }}
              onMouseUp={() => {
                const d = drag.current;
                drag.current = null;
                paint();
                if (d && d.from !== d.to) zoomTo(d.from < d.to ? d.from : d.to, d.from < d.to ? d.to : d.from);
              }}
              onMouseLeave={() => {
                drag.current = null;
                paint();
              }}
            >
              <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
              {runs.map(([a, b]) => (
                <ReferenceArea key={a} x1={a} x2={b} fill={c.shade} fillOpacity={0.8} ifOverflow="hidden" />
              ))}
              <XAxis dataKey="date" ticks={x.ticks} tickFormatter={x.format} minTickGap={28} interval="preserveStartEnd" tick={{ fill: c.text, fontSize: 12, fontWeight: 500 }} tickLine={false} axisLine={{ stroke: c.axis, strokeOpacity: 0.6 }} allowDuplicatedCategory={false} />
              <YAxis tickFormatter={axisMoney} tick={{ fill: c.text, fontSize: 12, fontWeight: 500 }} tickLine={false} axisLine={false} width={64} tickCount={7} domain={['auto', 'auto']} />
              <Tooltip content={<ChartTooltip series={series} />} cursor={{ stroke: c.axis, strokeWidth: 1 }} isAnimationActive={false} />
              <Area type="linear" dataKey="value" stroke={c.s1} strokeWidth={2} fill={c.s1} fillOpacity={0.06} dot={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 1.5, fill: c.s1 }} isAnimationActive={false} connectNulls />
              {on('invested') && <Line type="stepAfter" dataKey="cost" stroke={c.muted} strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={false} isAnimationActive={false} />}
              {on('dividends') && markLine('dividend', dividendShape)}
              {on('buys') && markLine('buy', markShape('buy', dense, c))}
              {on('sells') && markLine('sell', markShape('sell', dense, c))}
              {on('splits') && markLine('split', markShape('split', dense, c))}
              <ReferenceDot x={last.date} y={last.value} r={3} fill={c.s1} stroke="none" ifOverflow="visible" label={{ value: money(last.value), position: 'right', fill: c.s1, fontSize: 12, fontWeight: 600 }} />
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
