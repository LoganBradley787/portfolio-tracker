// Turns transactions and splits into one ordered event stream.
//
// Order: date, then splits, then dividends, then trades on the same date,
// then seq. A split with ex-date D therefore applies to shares bought before
// D, and a trade dated D is taken to be at post-split shares and price (spec
// 7.1). A dividend with ex-date D is paid on the shares held going into D: a
// buy on D does not get it, a sale on D still does.
import type { Dividend, Split, Transaction } from './types.ts';

export type ReplayEvent =
  | { kind: 'split'; date: string; ticker: string; ratio: number }
  | { kind: 'dividend'; date: string; ticker: string; amount: number }
  | { kind: 'trade'; date: string; tx: Transaction };

const RANK = { split: 0, dividend: 1, trade: 2 } as const;

export function orderEvents(transactions: Transaction[], splits: Split[], asOf?: string, dividends: Dividend[] = []): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  for (const s of splits) events.push({ kind: 'split', date: s.exDate, ticker: s.ticker, ratio: s.ratio });
  for (const d of dividends) events.push({ kind: 'dividend', date: d.exDate, ticker: d.ticker, amount: d.amount });
  for (const tx of transactions) events.push({ kind: 'trade', date: tx.date, tx });
  const filtered = asOf ? events.filter((e) => e.date <= asOf) : events;
  return filtered.sort(compareEvents);
}

function compareEvents(a: ReplayEvent, b: ReplayEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.kind !== b.kind) return RANK[a.kind] - RANK[b.kind];
  if (a.kind !== 'trade' && b.kind !== 'trade') return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0;
  if (a.kind === 'trade' && b.kind === 'trade') return a.tx.seq - b.tx.seq;
  return 0;
}
