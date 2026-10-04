// Per-ticker price change over a range: a pure price measure, not a return.
import type { PriceBar, Quote, Split } from './types.ts';

/** Share-basis ratio between two dates. Splits must belong to one security. */
export function splitRatio(splits: Split[], after: string, through: string): number {
  return splits.filter((s) => s.exDate > after && s.exDate <= through).reduce((ratio, s) => ratio * s.ratio, 1);
}

/** Closes restated to the share basis at `through`. Splits must belong to this security. */
export function splitAdjustedBars(bars: PriceBar[], splits: Split[], through: string): PriceBar[] {
  return bars.filter((b) => b.date <= through).map((b) => ({ ...b,
    close: b.close / splitRatio(splits, b.date, through) }));
}

export interface PriceChange {
  /** Close the day before the range, restated on the end date's share basis. */
  start: number;
  end: number;
  change: number;
  /** Closes in the range on the end date's share basis, sampled to ~n points. */
  spark: number[];
}

export function priceChange(
  ticker: string,
  bars: PriceBar[],
  splits: Split[],
  from: string,
  to: string,
  quote: Quote | null,
  n = 40,
): PriceChange | null {
  const own = splits.filter((s) => s.ticker === ticker);
  const inRange = bars.filter((b) => b.date >= from && b.date <= to);
  const startBar = bars.filter((b) => b.date < from).at(-1) ?? inRange[0];
  if (!startBar) return null;
  let endDate = inRange.at(-1)?.date ?? startBar.date;
  let endClose = inRange.at(-1)?.close ?? startBar.close;
  const qDate = quote?.asOf.slice(0, 10);
  const withQuote = quote && qDate && qDate <= to && qDate > endDate;
  if (withQuote) {
    endDate = qDate;
    endClose = quote.last;
  }
  // Restate a close on `date` to the share basis of `endDate`.
  const restate = (date: string, close: number) => close / splitRatio(own, date, endDate);
  const series = inRange.map((b) => restate(b.date, b.close));
  if (withQuote) series.push(endClose);
  const step = Math.max(1, Math.ceil(series.length / n));
  const spark = series.filter((_, i) => i % step === 0);
  if (series.length && spark.at(-1) !== series.at(-1)) spark.push(series.at(-1)!);
  const start = restate(startBar.date, startBar.close);
  return { start, end: endClose, change: start ? endClose / start - 1 : 0, spark };
}
