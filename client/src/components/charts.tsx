// Line charts on the ledger palette. One axis per chart; a crosshair tooltip
// lists every series at the hovered date; incomplete days are shaded.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { date as fmtDate } from '../lib/format.ts';

/** Reads the chart tokens from CSS, re-reading when the theme flips. */
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
      surface: v('--surface'),
      shade: v('--warn-soft'),
    };
  };
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setColors(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return colors;
}

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  /** Draw a 10% wash under the line. */
  area?: boolean;
  format: (v: number) => string;
}

export type Row = { date: string; incomplete?: boolean } & Record<string, number | string | boolean | null | undefined>;

/**
 * X ticks on calendar boundaries: weeks for a month, months up to ~8 months,
 * quarters up to ~3 years, then years. Each tick is the first trading day.
 */
function axisTicks(rows: Row[]): { ticks: string[]; format: (d: string) => string } {
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
  const sign = v < 0 ? '\u2212' : '';
  if (a >= 1e6) return `${sign}$${+(a / 1e6).toFixed(1)}M`;
  if (a >= 1000) return `${sign}$${+(a / 1000).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}

/** Runs of incomplete days as [start, end] pairs. */
function incompleteRuns(rows: Row[]): [string, string][] {
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

function ChartTooltip({ active, payload, label, series }: { active?: boolean; payload?: any[]; label?: string; series: SeriesDef[] }) {
  if (!active || !payload?.length || !label) return null;
  const row = payload[0].payload as Row;
  return (
    <div className="rounded-md border border-rule bg-surface px-3 py-2 text-xs shadow-[0_2px_8px_rgb(0_0_0/0.12)]">
      <p className="mb-1 text-muted">
        {fmtDate(label)}
        {row.incomplete ? ' · incomplete' : ''}
      </p>
      {series.map((s) => {
        const v = row[s.key];
        return (
          <p key={s.key} className="flex items-center gap-2 py-px">
            <span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ background: s.color }} />
            <span className="num font-semibold text-ink">{typeof v === 'number' ? s.format(v) : '—'}</span>
            <span className="text-muted">{s.label}</span>
          </p>
        );
      })}
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
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-label="Legend">
      {series.map((s) => {
        const off = hidden?.includes(s.key) ?? false;
        const entry = (
          <>
            <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: off ? 'var(--rule-strong)' : s.color }} />
            <span className={off ? 'text-muted line-through' : 'text-muted'}>{s.label}</span>
            {values?.[s.key] !== undefined && <span className={`tnum font-semibold ${off ? 'text-muted' : 'text-ink'}`}>{values[s.key]}</span>}
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
                className="-mx-1 flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-surface-2"
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
  height = 280,
  zeroLine,
  label,
  markers = [],
}: {
  rows: Row[];
  series: SeriesDef[];
  yFormat: (v: number) => string;
  height?: number;
  zeroLine?: boolean;
  label: string;
  markers?: { id: number; date: string; price: number; type: 'Buy' | 'Sell' }[];
}) {
  const c = useChartColors();
  const runs = useMemo(() => incompleteRuns(rows), [rows]);
  const x = useMemo(() => axisTicks(rows), [rows]);
  return (
    <figure aria-label={label} className="m-0">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
            {runs.map(([a, b]) => (
              <ReferenceArea key={a} x1={a} x2={b} fill={c.shade} fillOpacity={0.7} ifOverflow="hidden" />
            ))}
            {zeroLine && <ReferenceLine y={0} stroke={c.axis} strokeWidth={1} />}
            {markers.map((m) => <ReferenceDot key={m.id} x={m.date} y={m.price} r={4} fill={m.type === 'Buy' ? c.s1 : c.muted} stroke={c.surface} strokeWidth={1.5} ifOverflow="extendDomain" label={{ value: m.type === 'Buy' ? 'B' : 'S', position: 'top', fill: c.text, fontSize: 10 }} />)}
            <XAxis
              dataKey="date"
              ticks={x.ticks}
              tickFormatter={x.format}
              minTickGap={24}
              interval="preserveStartEnd"
              tick={{ fill: c.text, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: c.axis }}
            />
            <YAxis
              tickFormatter={yFormat}
              tick={{ fill: c.text, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={64}
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
                  fillOpacity={0.1}
                  dot={false}
                  activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2, fill: s.color }}
                  isAnimationActive={false}
                  connectNulls
                />
              ) : (
                <Line
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  dot={false}
                  activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2, fill: s.color }}
                  isAnimationActive={false}
                  connectNulls
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {runs.length > 0 && (
        <figcaption className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: c.shade }} />
          Shaded days are incomplete: some prices had not loaded yet, so those holdings are valued at cost.
        </figcaption>
      )}
      <DataTable rows={rows} series={series} />
    </figure>
  );
}

/** The table view: every plotted value, reachable without hovering. */
function DataTable({ rows, series }: { rows: Row[]; series: SeriesDef[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="mt-2 text-xs" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-muted hover:text-ink">Data table</summary>
      {open && (
        <div className="mt-2 max-h-64 overflow-auto rounded border border-rule">
          <table className="w-full">
            <thead className="sticky top-0 bg-surface-2 text-muted">
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

/** A small trend line: muted stroke, the latest point marked in the accent. */
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
      <path d={d} fill="none" stroke={c.muted} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r={2.5} fill={c.s1} />
    </svg>
  );
}
