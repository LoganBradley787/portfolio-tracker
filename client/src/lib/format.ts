import { display, HIDDEN } from './display.ts';

const MINUS = '−';

const money2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money4 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const money0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const sharesFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
const pctFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function sign(n: number, s: string, signed: boolean): string {
  if (n < 0 && Math.abs(n) >= 0.005) return MINUS + s;
  return signed && n > 0 && Math.abs(n) >= 0.005 ? '+' + s : s;
}

/**
 * $1,234.56 (or −$1,234.56; +$… when signed). `whole` rounds to the dollar,
 * for estimates. Follows the display setting (hidden or scaled) unless
 * `asIs`, for figures that are not the owner's, such as a share price.
 */
export function money(n: number | null | undefined, opts: { signed?: boolean; precise?: boolean; whole?: boolean; asIs?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (!opts.asIs) {
    if (display.hidden()) return HIDDEN;
    n *= display.factor();
  }
  const f = opts.whole ? money0 : opts.precise ? money4 : money2;
  return sign(n, '$' + f.format(Math.abs(n)), !!opts.signed);
}

export function pct(n: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = n * 100;
  if (Math.abs(v) < 0.005) return '0.00%';
  return sign(v, pctFmt.format(Math.abs(v)) + '%', opts.signed ?? true);
}

/** A share count, following the display setting like a dollar amount. */
export function shares(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (display.hidden()) return HIDDEN;
  return sharesFmt.format(n * display.factor());
}

export function tone(n: number | null | undefined): string {
  if (n == null || Math.abs(n) < 0.005) return 'text-muted';
  return n > 0 ? 'text-gain' : 'text-loss';
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** ISO date → "Oct 2, 2026". */
export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dateFmt.format(new Date(iso.slice(0, 10) + 'T00:00:00Z'));
}

/** ISO date or timestamp → "Oct 2, 2026" or "Oct 2, 12:27 PM". */
export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.length <= 10 ? date(iso) : timeFmt.format(new Date(iso));
}
