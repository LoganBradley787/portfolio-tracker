// External money invested in securities, rather than remaining cost basis.
import { runLedger } from './costBasis.ts';
import type { Split, Transaction } from './types.ts';

export interface MoneyPeriod {
  period: string;
  buys: number;
  sells: number;
  net: number;
}
export interface MoneyAdded {
  months: MoneyPeriod[];
  years: MoneyPeriod[];
  added: number;
  value: number;
  growth: number;
}

/** DRIP buys are internal; proceeds from selling reinvested shares are external. */
export function moneyAdded(input: { transactions: Transaction[]; splits: Split[]; today: string; value: number }): MoneyAdded {
  const transactions = input.transactions.filter((t) => t.date <= input.today);
  const months = new Map<string, MoneyPeriod>();
  const years = new Map<string, MoneyPeriod>();
  const first = transactions.reduce((a, t) => t.date < a ? t.date : a, input.today);
  if (transactions.length) {
    let period = first.slice(0, 7);
    while (period <= input.today.slice(0, 7)) {
      months.set(period, { period, buys: 0, sells: 0, net: 0 });
      const year = period.slice(0, 4);
      if (!years.has(year)) years.set(year, { period: year, buys: 0, sells: 0, net: 0 });
      const month = Number(period.slice(5));
      period = month === 12 ? `${Number(year) + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
    }
  }
  const add = (date: string, field: 'buys' | 'sells', amount: number) => {
    for (const p of [months.get(date.slice(0, 7))!, years.get(date.slice(0, 4))!]) {
      p[field] += amount;
      p.net += field === 'buys' ? amount : -amount;
    }
  };
  for (const t of transactions) if (t.type === 'Buy' && !t.drip) add(t.date, 'buys', t.shares * t.price);
  const ledger = runLedger(transactions, input.splits, { method: 'fifo', asOf: input.today });
  for (const s of ledger.sales) add(s.date, 'sells', s.proceeds);
  const added = [...years.values()].reduce((a, p) => a + p.net, 0);
  return { months: [...months.values()], years: [...years.values()], added, value: input.value, growth: input.value - added };
}
