// Dividend reinvestment (DRIP). Every dividend is assumed to be reinvested, and
// the entered transactions don't include those purchases, so they are
// derived here: each dividend buys the same ticker, in the account that
// received it, at the ex-date close. The rest of the engine then sees them as
// ordinary buys flagged `drip`.
//
// When an account's entered shares of a ticker are all sold, its reinvested
// shares are taken to have been sold in the same sale (the broker sold the
// whole position; the sheet only knew the entered shares).
import { orderEvents } from './replay.ts';
import { ZERO_SHARES, type Dividend, type PriceBar, type Split, type Transaction } from './types.ts';

export interface Reinvestment {
  date: string;
  ticker: string;
  account: string;
  amount: number;
  price: number;
  shares: number;
}

/** A dividend that stayed cash: no close near the ex-date, or the account sold out that day. */
export interface CashDividend {
  date: string;
  ticker: string;
  account: string;
  amount: number;
  reason: 'no close' | 'sold';
}

export interface DripResult {
  /** The input transactions (a closing sale may grow to include reinvested shares) plus the reinvestment buys. */
  transactions: Transaction[];
  reinvestments: Reinvestment[];
  cash: CashDividend[];
}

/** A dividend is reinvested at the first close on or after the ex-date, within this many days. */
const MAX_PRICE_LAG_DAYS = 7;
/** Reinvestment buys sort after every entered trade on the same date. */
const DRIP_SEQ = 1e15;

const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

function closeOnOrAfter(bars: PriceBar[], date: string): number | null {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date < date) lo = mid + 1;
    else hi = mid;
  }
  const b = bars[lo];
  return b && b.date <= addDays(date, MAX_PRICE_LAG_DAYS) && b.close > 0 ? b.close : null;
}

export function reinvestDividends(input: { transactions: Transaction[]; splits: Split[]; dividends: Dividend[]; bars: Record<string, PriceBar[]> }): DripResult {
  if (!input.dividends.length) return { transactions: input.transactions, reinvestments: [], cash: [] };

  // Shares per (account, ticker): everything held, and the part that was entered by hand.
  const held = new Map<string, Map<string, { total: number; entered: number }>>();
  const slot = (ticker: string, account: string) => {
    let byAccount = held.get(ticker);
    if (!byAccount) held.set(ticker, (byAccount = new Map()));
    let s = byAccount.get(account);
    if (!s) byAccount.set(account, (s = { total: 0, entered: 0 }));
    return s;
  };

  const out: Transaction[] = [];
  const reinvestments: Reinvestment[] = [];
  const cash: CashDividend[] = [];
  let pending: { date: string; ticker: string; account: string; amount: number }[] = [];
  let nextId = -1;

  // Reinvest the day's dividends once that day's trades are in.
  const flush = () => {
    for (const p of pending) {
      const s = slot(p.ticker, p.account);
      if (s.total <= ZERO_SHARES) {
        cash.push({ ...p, reason: 'sold' });
        continue;
      }
      const price = closeOnOrAfter(input.bars[p.ticker] ?? [], p.date);
      if (price === null) {
        cash.push({ ...p, reason: 'no close' });
        continue;
      }
      const shares = p.amount / price;
      s.total += shares;
      reinvestments.push({ ...p, price, shares });
      const id = nextId--;
      out.push({ id, seq: DRIP_SEQ - id, ticker: p.ticker, type: 'Buy', shares, price, date: p.date, account: p.account, note: 'Reinvested dividend', drip: true });
    }
    pending = [];
  };

  for (const e of orderEvents(input.transactions, input.splits, undefined, input.dividends)) {
    if (pending.length && e.date > pending[0].date) flush();
    if (e.kind === 'split') {
      for (const s of held.get(e.ticker)?.values() ?? []) {
        s.total *= e.ratio;
        s.entered *= e.ratio;
      }
      continue;
    }
    if (e.kind === 'dividend') {
      for (const [account, s] of held.get(e.ticker) ?? []) {
        if (s.total > ZERO_SHARES) pending.push({ date: e.date, ticker: e.ticker, account, amount: s.total * e.amount });
      }
      continue;
    }
    const tx = e.tx;
    const s = slot(tx.ticker, tx.account);
    if (tx.type === 'Buy') {
      s.total += tx.shares;
      s.entered += tx.shares;
      out.push(tx);
      continue;
    }
    const sold = Math.min(tx.shares, s.total);
    s.total -= sold;
    s.entered = Math.max(0, s.entered - tx.shares);
    if (s.entered <= ZERO_SHARES && s.total > ZERO_SHARES) {
      out.push({ ...tx, shares: sold + s.total });
      s.total = 0;
    } else {
      out.push(tx);
    }
  }
  flush();

  reinvestments.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker) || a.account.localeCompare(b.account));
  cash.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker) || a.account.localeCompare(b.account));
  return { transactions: out, reinvestments, cash };
}
