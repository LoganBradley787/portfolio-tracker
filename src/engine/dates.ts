// Pure date arithmetic on ISO `YYYY-MM-DD` strings (UTC, no time zone).

const DAY_MS = 86_400_000;

export function toUtc(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

export function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return fromUtc(toUtc(date) + n * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  return new Date(toUtc(date)).getUTCDay();
}

export function isWeekday(date: string): boolean {
  const d = weekday(date);
  return d !== 0 && d !== 6;
}

/** The weekday strictly before `date`. */
export function previousWeekday(date: string): string {
  let d = addDays(date, -1);
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}

/** Steps back `n` weekdays from `date` (holidays are not known here). */
export function subtractWeekdays(date: string, n: number): string {
  let d = date;
  for (let i = 0; i < n; i++) d = previousWeekday(d);
  return d;
}
