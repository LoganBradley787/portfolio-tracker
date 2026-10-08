// Line charts on the ledger palette. A few horizontal hairlines, no vertical
// grid, a confident line, the latest value written at its end. A crosshair
// tooltip states the value in ink; incomplete days are shaded.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { date as fmtDate } from '../lib/format.ts';

/** Reads the chart tokens from CSS once. */
export function useChartColors() {
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    return {
      s1: v('--series-1'),
      s2: v('--series-2'),
      s3: v('--series-3'),
      s4: v('--series-4'),
      muted: v('--series-muted'),
      grid: v('--rule'),
      axis: v('--rule-strong'),
      text: v('--muted'),
      ink: v('--ink'),
      surface: v('--surface'),
      bg: v('--bg'),
      shade: v('--warn-soft'),
      gain: v('--gain'),
      loss: v('--loss'),
    };
  };
  const [colors] = useState(read);
  return colors;
}

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  /** Draw a faint wash under the line. */
  area?: boolean;
  /** Dashed, for a reference such as cost basis. */
  dashed?: boolean;
  format: (v: number) => string;
}

/** `note` is a line of plain text for the tooltip, e.g. the trades made that day. */
export type Row = { date: string; incomplete?: boolean; note?: string } & Record<string, number | string | boolean | null | undefined>;

export interface Marker {
  id: number;
  date: string;
  price: number;
  type: 'Buy' | 'Sell' | 'Split';
}

const MARKER_LETTER = { Buy: 'B', Sell: 'S', Split: '×' };

/**
 * X ticks on calendar boundaries: weeks for a month, months up to ~8 months,
 * quarters up to ~3 years, then years. Each tick is the first trading day.
 */
export function axisTicks(rows: Row[]): { ticks: string[]; format: (d: string) => string } {
  const span = rows.length;
  const utc = (d: string) => new Date(d + 'T00:00:00Z');
  const key =
    span > 750
      ? (d: string) => d.slice(0, 4)
      : span > 180
        ? (d: string) => `${d.slice(0, 4)}-${Math.floor((Number(d.slice(5, 7)) - 1) / 3)}`
        : span > 30
          ? (d: string) => d.slice(0, 7)
          : (d: string) => {
              const t = utc(d);
              t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
              return t.toISOString().slice(0, 10);
            };
  const ticks: string[] = [];
  let prev = '';
  rows.forEach((r, i) => {
    const k = key(r.date);
    if (k !== prev && i > 0) ticks.push(r.date);
    prev = k;
  });
  const format = (d: string) => {
    const t = utc(d);
    if (span > 750) return String(t.getUTCFullYear());
    if (span > 30) return t.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace(' ', ' ’');
    return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  return { ticks, format };
}

/** Compact dollars for an axis: $950, $12.5k, $1.2M. */
export function axisMoney(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}$${+(a / 1e6).toFixed(1)}M`;
  if (a >= 1000) return `${sign}$${+(a / 1000).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}

export const axisPct = (v: number) => `${Math.round(v * 100)}%`;

/** Runs of incomplete days as [start, end] pairs. */
export function incompleteRuns(rows: Row[]): [string, string][] {
  const runs: [string, string][] = [];
  let start: string | null = null;
  rows.forEach((r, i) => {
    if (r.incomplete && start === null) start = r.date;
    if (start !== null && (!r.incomplete || i === rows.length - 1)) {
      runs.push([start, r.incomplete ? r.date : rows[i - 1].date]);
      start = null;
    }
  });
  return runs;
}

/** One series: the value alone, in ink. Several: each with its colour and name. */
export function ChartTooltip({ active, payload, label, series }: { active?: boolean; payload?: any[]; label?: string; series: SeriesDef[] }) {
  if (!active || !payload?.length || !label) return null;
  const row = payload[0].payload as Row;
  const shown = series.filter((s) => typeof row[s.key] === 'number');
  return (
    <div className="rounded-md border border-rule-strong/50 bg-surface px-3.5 py-2.5 shadow-[0_6px_20px_rgb(10_20_40/0.12)]">
      <p className="num text-[13px] font-medium text-muted">
        {fmtDate(label)}
        {row.incomplete ? ' · incomplete' : ''}
      </p>
      {shown.length === 1 ? (
        <p className="num mt-0.5 text-[18px] font-semibold text-ink">{shown[0].format(row[shown[0].key] as number)}</p>
      ) : (
        shown.map((s) => (
          <p key={s.key} className="mt-0.5 flex items-center gap-2 text-[14px]">
            <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: s.color }} />
            <span className="num font-semibold text-ink">{s.format(row[s.key] as number)}</span>
            <span className="text-muted">{s.label}</span>
          </p>
        ))
      )}
      {row.note && <p className="mt-1 max-w-64 text-[13px] text-ink">{row.note}</p>}
    </div>
  );
}

/** With `onToggle`, each entry is a button that shows or hides its series; `hidden` lists the keys turned off. */
export function Legend({
  series,
  values,
  hidden,
  onToggle,
}: {
  series: SeriesDef[];
  values?: Record<string, ReactNode>;
  hidden?: string[];
  onToggle?: (key: string) => void;
}) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" aria-label="Legend">
      {series.map((s) => {
        const off = hidden?.includes(s.key) ?? false;
        const entry = (
          <>
            <span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: off ? 'var(--rule-strong)' : s.color }} />
            <span className={`font-medium ${off ? 'text-faint line-through' : 'text-muted'}`}>{s.label}</span>
            {values?.[s.key] !== undefined && <span className={`tnum font-semibold ${off ? 'text-faint' : 'text-ink'}`}>{values[s.key]}</span>}
          </>
        );
        return (
          <li key={s.key}>
            {onToggle ? (
              <button
                type="button"
                aria-pressed={!off}
                title={off ? `Show ${s.label}` : `Hide ${s.label}`}
                onClick={() => onToggle(s.key)}
                className="-mx-1 flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-ink/[0.04]"
              >
                {entry}
              </button>
            ) : (
              <span className="flex items-center gap-1.5">{entry}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function LineChartFrame({
  rows,
  series,
  yFormat,
  height = 260,
  zeroLine,
  label,
  markers = [],
  letterLimit = Infinity,
  endLabels = true,
  dataTable = false,
}: {
  rows: Row[];
  series: SeriesDef[];
  yFormat: (v: number) => string;
  height?: number;
  zeroLine?: boolean;
  label: string;
  markers?: Marker[];
  /** Past this many markers the letters collide, so only the dots are drawn. */
  letterLimit?: number;
  /** Write each series' latest value at the end of its line. */
  endLabels?: boolean;
  dataTable?: boolean;
}) {
  const c = useChartColors();
  const runs = useMemo(() => incompleteRuns(rows), [rows]);
  const x = useMemo(() => axisTicks(rows), [rows]);
  const last = rows.at(-1);
  const ends = endLabels && last
    ? series.flatMap((s) => (typeof last[s.key] === 'number' ? [{ s, v: last[s.key] as number }] : []))
    : [];
  // Room on the right for the longest end label, at about 7px a character.
  const rightMargin = ends.length ? 14 + 7 * Math.max(...ends.map(({ s, v }) => s.format(v).length)) : 8;
  return (
    <figure aria-label={label} className="m-0">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 10, right: rightMargin, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} strokeDasharray="0" />
            {runs.map(([a, b]) => (
              <ReferenceArea key={a} x1={a} x2={b} fill={c.shade} fillOpacity={0.8} ifOverflow="hidden" />
            ))}
            {zeroLine && <ReferenceLine y={0} stroke={c.axis} strokeWidth={1} />}
            {markers.map((m) => (
              <ReferenceDot
                key={m.id}
                x={m.date}
                y={m.price}
                r={markers.length > letterLimit ? 2.5 : 3.5}
                fill={m.type === 'Buy' ? c.ink : c.bg}
                stroke={c.ink}
                strokeWidth={1}
                ifOverflow="extendDomain"
                label={markers.length > letterLimit ? undefined : { value: MARKER_LETTER[m.type], position: 'top', fill: c.text, fontSize: 10 }}
              />
            ))}
            <XAxis
              dataKey="date"
              ticks={x.ticks}
              tickFormatter={x.format}
              minTickGap={24}
              interval="preserveStartEnd"
              tick={{ fill: c.text, fontSize: 12, fontWeight: 500 }}
              tickLine={false}
              axisLine={{ stroke: c.axis, strokeOpacity: 0.6 }}
            />
            <YAxis
              tickFormatter={yFormat}
              tick={{ fill: c.text, fontSize: 12, fontWeight: 500 }}
              tickLine={false}
              axisLine={false}
              width={56}
              tickCount={5}
              domain={['auto', 'auto']}
            />
            <Tooltip content={<ChartTooltip series={series} />} cursor={{ stroke: c.axis, strokeWidth: 1 }} isAnimationActive={false} />
            {series.map((s) =>
              s.area ? (
                <Area
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={s.color}
                  fillOpacity={0.06}
                  dot={false}
                  activeDot={{ r: 3.5, stroke: c.surface, strokeWidth: 1.5, fill: s.color }}
                  isAnimationActive={false}
                  connectNulls
                />
              ) : (
                <Line
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={s.dashed ? 1.5 : 2}
                  strokeDasharray={s.dashed ? '4 3' : undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  dot={false}
                  activeDot={{ r: 3.5, stroke: c.surface, strokeWidth: 1.5, fill: s.color }}
                  isAnimationActive={false}
                  connectNulls
                />
              ),
            )}
            {ends.map(({ s, v }) => (
              <ReferenceDot
                key={`end-${s.key}`}
                x={last!.date}
                y={v}
                r={2.5}
                fill={s.color}
                stroke="none"
                ifOverflow="visible"
                label={{ value: s.format(v), position: 'right', fill: s.color, fontSize: 12, fontWeight: 600 }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {runs.length > 0 && (
        <figcaption className="mt-1.5 flex items-center gap-1.5 text-[13px] text-muted">
          <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: c.shade }} />
          Shaded days are incomplete: some prices had not loaded yet, so those holdings are valued at cost.
        </figcaption>
      )}
      {dataTable && <DataTable rows={rows} series={series} />}
    </figure>
  );
}

/** The table view: every plotted value, reachable without hovering. */
function DataTable({ rows, series }: { rows: Row[]; series: SeriesDef[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="mt-3 text-[13px]" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="inline cursor-pointer font-semibold text-muted hover:text-ink">{open ? 'Hide the data table' : 'Show the data table'}</summary>
      {open && (
        <div className="mt-2 max-h-64 overflow-auto border-y border-rule">
          <table className="w-full">
            <thead className="sticky top-0 bg-bg text-muted">
              <tr>
                <th className="px-2 py-1 text-left font-medium">Date</th>
                {series.map((s) => (
                  <th key={s.key} className="px-2 py-1 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.date} className="border-t border-rule">
                  <td className="num px-2 py-0.5">{r.date}</td>
                  {series.map((s) => (
                    <td key={s.key} className="num px-2 py-0.5 text-right">
                      {typeof r[s.key] === 'number' ? s.format(r[s.key] as number) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

export interface FanRow {
  /** X label, e.g. the calendar year. */
  label: string;
  low: number;
  midLow: number;
  mid: number;
  midHigh: number;
  high: number;
  /** A reference line with no spread, e.g. money put in. */
  base: number;
}

/** A widening range around a middle line: the outer band, the inner band, the middle, and a dashed baseline. */
export function FanChart({ rows, label, yFormat, format, names, target, height = 280 }: {
  rows: FanRow[];
  label: string;
  yFormat: (v: number) => string;
  format: (v: number) => string;
  names: { outer: string; inner: string; mid: string; base: string; target?: string };
  target?: number | null;
  height?: number;
}) {
  const c = useChartColors();
  const data = rows.map((r) => ({ ...r, outer: [r.low, r.high], inner: [r.midLow, r.midHigh] }));
  const tip = ({ active, payload }: { active?: boolean; payload?: readonly any[] }) => {
    if (!active || !payload?.length) return null;
    const r = payload[0].payload as FanRow;
    return (
      <div className="rounded border border-rule bg-surface px-3 py-2 text-[13px] shadow-[0_4px_16px_rgb(20_30_50/0.10)]">
        <p className="mb-1 text-muted">{r.label}</p>
        {([[names.outer, `${format(r.low)} – ${format(r.high)}`], [names.inner, `${format(r.midLow)} – ${format(r.midHigh)}`], [names.mid, format(r.mid)], [names.base, format(r.base)]] as const).map(([k, v]) => (
          <p key={k} className="flex items-baseline justify-between gap-4 py-px">
            <span className="text-muted">{k}</span>
            <span className="num font-medium text-ink">{v}</span>
          </p>
        ))}
      </div>
    );
  };
  return (
    <figure aria-label={label} className="m-0">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
            <XAxis dataKey="label" minTickGap={24} interval="preserveStartEnd" tick={{ fill: c.text, fontSize: 12, fontWeight: 500 }} tickLine={false} axisLine={{ stroke: c.axis, strokeOpacity: 0.6 }} />
            <YAxis tickFormatter={yFormat} tick={{ fill: c.text, fontSize: 12, fontWeight: 500 }} tickLine={false} axisLine={false} width={56} tickCount={5} domain={[0, 'auto']} />
            <Tooltip content={tip} cursor={{ stroke: c.axis, strokeWidth: 1 }} isAnimationActive={false} />
            <Area type="monotone" dataKey="outer" stroke="none" fill={c.s1} fillOpacity={0.08} isAnimationActive={false} activeDot={false} />
            <Area type="monotone" dataKey="inner" stroke="none" fill={c.s1} fillOpacity={0.16} isAnimationActive={false} activeDot={false} />
            <Line type="monotone" dataKey="base" stroke={c.muted} strokeWidth={1.25} strokeDasharray="3 3" dot={false} activeDot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="mid" stroke={c.s1} strokeWidth={1.5} dot={false} activeDot={{ r: 3.5, stroke: c.surface, strokeWidth: 1.5, fill: c.s1 }} isAnimationActive={false} />
            {target != null && target > 0 && <ReferenceLine y={target} stroke={c.s2} strokeWidth={1.25} ifOverflow="extendDomain" label={{ value: names.target ?? '', position: 'insideTopLeft', fill: c.text, fontSize: 12, fontWeight: 500 }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-medium text-muted">
        <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: c.s1 }} />{names.mid}</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: c.s1, opacity: 0.24 }} />{names.inner}</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: c.s1, opacity: 0.1 }} />{names.outer}</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="inline-block w-3.5 border-t border-dashed" style={{ borderColor: c.muted }} />{names.base}</span>
      </figcaption>
    </figure>
  );
}

/** A small trend line: muted stroke, the latest point marked in ink. */
export function Sparkline({ values, width = 96, height = 24 }: { values: number[]; width?: number; height?: number }) {
  const c = useChartColors();
  if (values.length < 2) return <span className="inline-block" style={{ width, height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const y = (v: number) => (max === min ? height / 2 : 3 + (1 - (v - min) / (max - min)) * (height - 6));
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg width={width} height={height} aria-hidden className="inline-block align-middle">
      <path d={d} fill="none" stroke={c.muted} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r={2} fill={c.ink} />
    </svg>
  );
}

/** A horizontal bar from a shared zero line: green to the right, red to the left. */
export function GainBar({ value, max, className = 'h-3 w-full' }: { value: number; max: number; className?: string }) {
  return (
    <span aria-hidden className={`relative block ${className}`}>
      <span className="absolute inset-y-0 left-1/2 w-px bg-rule-strong/70" />
      <span
        className={`absolute inset-y-0.5 ${value >= 0 ? 'left-1/2 bg-gain/75' : 'right-1/2 bg-loss/75'}`}
        style={{ width: `${(Math.abs(value) / Math.max(max, 1e-9)) * 50}%`, minWidth: Math.abs(value) > 0 ? 1 : 0 }}
      />
    </span>
  );
}
