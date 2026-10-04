export type Preset = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'All' | 'Custom';

export const PRESETS: Preset[] = ['1M', '3M', '6M', 'YTD', '1Y', 'All', 'Custom'];

export interface RangeValue {
  preset: Preset;
  from?: string;
  to?: string;
}

function shift(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

function plusDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Query string for a range relative to `today`. The range starts the day after "one month ago". */
export function rangeQuery(r: RangeValue, today: string): string {
  const q = new URLSearchParams();
  const months: Partial<Record<Preset, number>> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 };
  if (months[r.preset]) q.set('from', plusDay(shift(today, -months[r.preset]!)));
  else if (r.preset === 'YTD') q.set('from', `${today.slice(0, 4)}-01-01`);
  else if (r.preset === 'Custom') {
    if (r.from) q.set('from', r.from);
    if (r.to) q.set('to', r.to);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
