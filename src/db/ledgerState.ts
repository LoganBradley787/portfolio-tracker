// Shared transaction filtering and dividend reinvestment for current positions.
import type { Queries } from './queries.ts';
import { reinvestDividends } from '../engine/drip.ts';
import { runLedger } from '../engine/costBasis.ts';
import type { CostMethod } from '../engine/types.ts';

export function loadLedgerState(q: Queries, accounts?: string[], reinvest = true) {
  const all = q.listTransactions();
  const transactions = accounts === undefined ? all : all.filter((t) => accounts.includes(t.account));
  const splits = q.listSplits();
  const dividends = q.allDividends();
  const bars = q.allBars();
  const drip = reinvestDividends({ transactions, splits, dividends, bars, reinvest });
  // As entered transactions stay available; ledger transactions include reinvested dividends.
  return { transactions, splits, dividends, bars, drip, ledgerTransactions: drip.transactions };
}

export function currentLedger(q: Queries, accounts?: string[], method: CostMethod = 'average', reinvest = true) {
  const state = loadLedgerState(q, accounts, reinvest);
  const ledger = runLedger(state.ledgerTransactions, state.splits, { method, dividends: state.dividends });
  return { state, ledger };
}
