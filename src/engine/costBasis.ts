// Cost-basis strategies and the ledger that replays events through one.
//
// A strategy keeps state per grouping key. Average cost pools per ticker
// across accounts (sheet parity); FIFO keeps lots per (account, ticker).
import { orderEvents } from './replay.ts';
import { ZERO_SHARES, type CostMethod, type Dividend, type Split, type Transaction } from './types.ts';

/** A piece of a lot consumed by a sale (FIFO only). */
export interface ConsumedLot {
  acquired: string;
  shares: number;
  cost: number;
}

export interface SellOutcome {
  /** Shares actually removed: the request clamped to what was held. */
  sharesSold: number;
  /** Shares held in the group before the sale. */
  held: number;
  costRemoved: number;
  lots?: ConsumedLot[];
}

export interface CostStrategy {
  readonly method: CostMethod;
  buy(tx: Transaction): void;
  sell(tx: Transaction): SellOutcome;
  split(ticker: string, ratio: number): void;
  /** Shares and cost per ticker, summed over every group for that ticker. */
  totals(ticker: string): { shares: number; cost: number };
  /** Accounts with an open position in the ticker. */
  accounts(ticker: string): string[];
  tickers(): string[];
}

interface Pool {
  shares: number;
  cost: number;
  accounts: Set<string>;
}

export class AverageCost implements CostStrategy {
  readonly method = 'average' as const;
  private pools = new Map<string, Pool>();

  private pool(ticker: string): Pool {
    let p = this.pools.get(ticker);
    if (!p) this.pools.set(ticker, (p = { shares: 0, cost: 0, accounts: new Set() }));
    return p;
  }

  buy(tx: Transaction): void {
    const p = this.pool(tx.ticker);
    p.shares += tx.shares;
    p.cost += tx.shares * tx.price;
    p.accounts.add(tx.account);
  }

  sell(tx: Transaction): SellOutcome {
    const p = this.pool(tx.ticker);
    const held = p.shares;
    const sharesSold = Math.min(tx.shares, Math.max(held, 0));
    const costRemoved = held > ZERO_SHARES ? (p.cost / held) * sharesSold : 0;
    p.shares -= sharesSold;
    p.cost -= costRemoved;
    if (Math.abs(p.shares) <= ZERO_SHARES) {
      p.shares = 0;
      p.cost = 0;
      p.accounts.clear();
    }
    return { sharesSold, held, costRemoved };
  }

  split(ticker: string, ratio: number): void {
    const p = this.pools.get(ticker);
    if (p) p.shares *= ratio;
  }

  totals(ticker: string) {
    const p = this.pools.get(ticker);
    return { shares: p?.shares ?? 0, cost: p?.cost ?? 0 };
  }

  accounts(ticker: string): string[] {
    return [...(this.pools.get(ticker)?.accounts ?? [])].sort();
  }

  tickers(): string[] {
    return [...this.pools.keys()];
  }
}

interface Lot {
  /** Derived dividend purchase; preserved while the lot remains open. */
  drip?: boolean;
  acquired: string;
  shares: number;
  cost: number;
}

/** FIFO: lots per (account, ticker); a sale consumes that account's oldest lots. */
export class Fifo implements CostStrategy {
  readonly method = 'fifo' as const;
  /** ticker → account → lots, oldest first. */
  private lots = new Map<string, Map<string, Lot[]>>();

  private byAccount(ticker: string): Map<string, Lot[]> {
    let m = this.lots.get(ticker);
    if (!m) this.lots.set(ticker, (m = new Map()));
    return m;
  }

  private group(account: string, ticker: string): Lot[] {
    const m = this.byAccount(ticker);
    let g = m.get(account);
    if (!g) m.set(account, (g = []));
    return g;
  }

  buy(tx: Transaction): void {
    this.group(tx.account, tx.ticker).push({ acquired: tx.date, shares: tx.shares, cost: tx.shares * tx.price, ...(tx.drip ? { drip: true } : {}) });
  }

  sell(tx: Transaction): SellOutcome {
    const g = this.group(tx.account, tx.ticker);
    const held = g.reduce((a, l) => a + l.shares, 0);
    let remaining = Math.min(tx.shares, Math.max(held, 0));
    const sharesSold = remaining;
    const consumed: ConsumedLot[] = [];
    while (remaining > ZERO_SHARES && g.length) {
      const lot = g[0];
      const take = Math.min(lot.shares, remaining);
      const cost = lot.shares > 0 ? (lot.cost * take) / lot.shares : 0;
      consumed.push({ acquired: lot.acquired, shares: take, cost });
      lot.shares -= take;
      lot.cost -= cost;
      remaining -= take;
      if (lot.shares <= ZERO_SHARES) g.shift();
    }
    return { sharesSold, held, costRemoved: consumed.reduce((a, c) => a + c.cost, 0), lots: consumed };
  }

  split(ticker: string, ratio: number): void {
    for (const g of this.lots.get(ticker)?.values() ?? []) for (const lot of g) lot.shares *= ratio;
  }

  totals(ticker: string) {
    let shares = 0;
    let cost = 0;
    for (const g of this.lots.get(ticker)?.values() ?? []) {
      for (const lot of g) {
        shares += lot.shares;
        cost += lot.cost;
      }
    }
    return { shares, cost };
  }

  accounts(ticker: string): string[] {
    return [...(this.lots.get(ticker) ?? [])]
      .filter(([, g]) => g.reduce((a, l) => a + l.shares, 0) > ZERO_SHARES)
      .map(([a]) => a)
      .sort();
  }

  tickers(): string[] {
    return [...this.lots.keys()];
  }

  openLots(ticker: string): (Lot & { account: string })[] {
    return [...(this.lots.get(ticker) ?? [])].flatMap(([account, lots]) => lots.map((lot) => ({ ...lot, account })));
  }
}

export interface Position {
  ticker: string;
  shares: number;
  cost: number;
  accounts: string[];
  lots?: (Lot & { account: string })[];
  /** Dividends received on this ticker, all time (0 unless dividends were passed in). */
  dividends?: number;
}

/** A dividend received: shares held going into the ex-date × amount per share. */
export interface DividendEvent {
  date: string;
  ticker: string;
  shares: number;
  perShare: number;
  amount: number;
}

export interface Sale {
  txId: number;
  seq: number;
  date: string;
  account: string;
  ticker: string;
  /** Shares on the transaction, as traded. */
  shares: number;
  /** Shares actually sold after clamping to the shares held. */
  sharesSold: number;
  price: number;
  proceeds: number;
  costRemoved: number;
  avgBuyPrice: number;
  gain: number;
  gainPerShare: number;
  gainPct: number;
  lots?: ConsumedLot[];
}

/** A sale over the shares held by less than this many dollars is treated as selling everything. */
const OVERSELL_TOLERANCE = 1;

export interface Oversell {
  txId: number;
  ticker: string;
  account: string;
  date: string;
  requested: number;
  held: number;
}

/** Running shares and cost for the ticker after each trade, in replay order. */
export interface Step {
  txId: number;
  ticker: string;
  date: string;
  shares: number;
  cost: number;
}

export interface Ledger {
  /** Open positions only (more than 1e-9 shares). */
  positions: Map<string, Position>;
  sales: Sale[];
  oversells: Oversell[];
  steps: Step[];
  dividends: DividendEvent[];
  dividendsByTicker: Map<string, number>;
}

export interface LedgerOptions {
  method: CostMethod;
  /** Inclusive. Events after this date are ignored. */
  asOf?: string;
  dividends?: Dividend[];
}

export function makeStrategy(method: CostMethod): CostStrategy {
  return method === 'fifo' ? new Fifo() : new AverageCost();
}

export function runLedger(transactions: Transaction[], splits: Split[], opts: LedgerOptions): Ledger {
  const strategy = makeStrategy(opts.method);
  const sales: Sale[] = [];
  const oversells: Oversell[] = [];
  const steps: Step[] = [];
  const dividends: DividendEvent[] = [];
  const dividendsByTicker = new Map<string, number>();

  for (const e of orderEvents(transactions, splits, opts.asOf, opts.dividends)) {
    if (e.kind === 'split') {
      strategy.split(e.ticker, e.ratio);
      continue;
    }
    if (e.kind === 'dividend') {
      const { shares } = strategy.totals(e.ticker);
      if (shares > ZERO_SHARES) {
        const amount = shares * e.amount;
        dividends.push({ date: e.date, ticker: e.ticker, shares, perShare: e.amount, amount });
        dividendsByTicker.set(e.ticker, (dividendsByTicker.get(e.ticker) ?? 0) + amount);
      }
      continue;
    }
    const tx = e.tx;
    if (tx.type === 'Buy') {
      strategy.buy(tx);
    } else {
      const out = strategy.sell(tx);
      const excess = tx.shares - out.held;
      // Reinvested shares are estimates, so a closing sale can be over by a few
      // cents' worth. That closes the position quietly; a larger gap is reported.
      const rounding = out.held > ZERO_SHARES && excess * tx.price < OVERSELL_TOLERANCE;
      if (excess > ZERO_SHARES && !rounding) {
        oversells.push({ txId: tx.id, ticker: tx.ticker, account: tx.account, date: tx.date, requested: tx.shares, held: out.held });
      }
      if (out.sharesSold > ZERO_SHARES) {
        const proceeds = out.sharesSold * tx.price;
        const gain = proceeds - out.costRemoved;
        sales.push({
          txId: tx.id,
          seq: tx.seq,
          date: tx.date,
          account: tx.account,
          ticker: tx.ticker,
          shares: tx.shares,
          sharesSold: out.sharesSold,
          price: tx.price,
          proceeds,
          costRemoved: out.costRemoved,
          avgBuyPrice: out.costRemoved / out.sharesSold,
          gain,
          gainPerShare: gain / out.sharesSold,
          gainPct: out.costRemoved !== 0 ? gain / out.costRemoved : 0,
          ...(out.lots ? { lots: out.lots } : {}),
        });
      }
    }
    const t = strategy.totals(tx.ticker);
    steps.push({ txId: tx.id, ticker: tx.ticker, date: tx.date, shares: t.shares, cost: t.cost });
  }

  const positions = new Map<string, Position>();
  for (const ticker of strategy.tickers()) {
    const t = strategy.totals(ticker);
    if (t.shares > ZERO_SHARES) positions.set(ticker, { ticker, ...t, accounts: strategy.accounts(ticker), dividends: dividendsByTicker.get(ticker) ?? 0,
      ...(strategy instanceof Fifo ? { lots: strategy.openLots(ticker) } : {}) });
  }
  return { positions, sales, oversells, steps, dividends, dividendsByTicker };
}
