// Read-only sale estimates from remaining FIFO lots. All dates and prices are supplied.
import type { Position } from './costBasis.ts';
import { addDays } from './dates.ts';
import { isLongTerm, longTermDate, type TermTotals } from './realized.ts';
import { ZERO_SHARES } from './types.ts';

export type OpenLot = NonNullable<Position['lots']>[number];
export interface PreviewLot extends OpenLot {
  proceeds: number;
  gain: number;
  term: 'short' | 'long';
}
export interface SalePreview {
  shares: number;
  proceeds: number;
  cost: number;
  gain: number;
  averageGain: number | null;
  shortTerm: TermTotals;
  longTerm: TermTotals;
  lots: PreviewLot[];
}

/** Accounts holding this ticker, largest first; names break ties deterministically. */
export function previewAccounts(lots: OpenLot[]): { account: string; shares: number }[] {
  const held = new Map<string, number>();
  for (const l of lots) held.set(l.account, (held.get(l.account) ?? 0) + l.shares);
  return [...held].map(([account, shares]) => ({ account, shares })).filter((a) => a.shares > ZERO_SHARES)
    .sort((a, b) => b.shares - a.shares || a.account.localeCompare(b.account));
}

/** A sale consumes one account's lots. Default to the account holding most shares. */
export function previewSale(input: { lots: OpenLot[]; account?: string; price: number; today: string; shares?: number; averageCost?: number }): SalePreview {
  const account = input.account ?? previewAccounts(input.lots)[0]?.account;
  const accountLots = input.lots.filter((l) => l.account === account);
  const held = accountLots.reduce((a, l) => a + l.shares, 0);
  const requested = input.shares ?? held;
  if (!Number.isFinite(requested) || requested < 0 || (input.shares !== undefined && requested <= ZERO_SHARES) || requested > held + ZERO_SHARES) {
    throw new RangeError('Choose a positive number of shares no greater than the shares held.');
  }
  if (!Number.isFinite(input.price) || input.price < 0) throw new RangeError('A valid market price is required.');
  const shares = Math.min(requested, held);
  let remaining = shares;
  const lots: PreviewLot[] = [];
  const shortTerm = { proceeds: 0, cost: 0, gain: 0 };
  const longTerm = { proceeds: 0, cost: 0, gain: 0 };
  for (const lot of [...accountLots].sort((a, b) => a.acquired.localeCompare(b.acquired))) {
    if (remaining <= ZERO_SHARES) break;
    const take = Math.min(lot.shares, remaining);
    const cost = lot.cost * take / lot.shares;
    const proceeds = input.price * take;
    const gain = proceeds - cost;
    const term = isLongTerm(lot.acquired, input.today) ? 'long' : 'short';
    const bucket = term === 'long' ? longTerm : shortTerm;
    bucket.proceeds += proceeds;
    bucket.cost += cost;
    bucket.gain += gain;
    lots.push({ ...lot, shares: take, cost, proceeds, gain, term });
    remaining -= take;
  }
  const proceeds = shares * input.price;
  const cost = shortTerm.cost + longTerm.cost;
  return { shares, proceeds, cost, gain: proceeds - cost,
    averageGain: input.averageCost === undefined ? null : proceeds - shares * input.averageCost, shortTerm, longTerm, lots };
}

export interface SoonLot extends OpenLot {
  ticker: string;
  longTermDate: string;
  lastLongTermDate?: string;
  reinvestedLots?: number;
  gain: number | null;
}

/** First long-term day is strictly after today and at most 60 calendar days away. */
export function turningLongTermSoon(input: { positions: Map<string, Position>; prices: Record<string, number>; today: string }): SoonLot[] {
  const end = addDays(input.today, 60);
  const rows: SoonLot[] = [];
  const reinvested = new Map<string, SoonLot>();
  for (const [ticker, p] of input.positions) for (const lot of p.lots ?? []) {
    const date = longTermDate(lot.acquired);
    if (date <= input.today || date > end) continue;
    const price = input.prices[ticker];
    const gain = price === undefined ? null : lot.shares * price - lot.cost;
    if (!lot.drip) {
      rows.push({ ...lot, ticker, longTermDate: date, gain });
      continue;
    }
    const key = JSON.stringify([ticker, lot.account]);
    const group = reinvested.get(key);
    if (!group) {
      reinvested.set(key, { ...lot, ticker, longTermDate: date, lastLongTermDate: date, gain, reinvestedLots: 1 });
    } else {
      group.shares += lot.shares;
      group.cost += lot.cost;
      group.gain = group.gain === null || gain === null ? null : group.gain + gain;
      group.reinvestedLots!++;
      if (date < group.longTermDate) { group.longTermDate = date; group.acquired = lot.acquired; }
      if (date > group.lastLongTermDate!) group.lastLongTermDate = date;
    }
  }
  return [...rows, ...reinvested.values()].sort((a, b) => a.longTermDate.localeCompare(b.longTermDate)
    || a.ticker.localeCompare(b.ticker) || a.account.localeCompare(b.account));
}
