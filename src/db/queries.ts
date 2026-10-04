// Typed queries over the SQLite schema. Hand-written SQL, no ORM.
import type { Database } from 'better-sqlite3';
import type { AssetType, PriceBar, Quote, SecurityStatus, Split, Transaction, TxType } from '../engine/types.ts';
import type { ImportResult } from '../import/parse.ts';
import { backupDatabase } from './backup.ts';
import type { FundSnapshot } from '../engine/exposure.ts';
import type { FundBreakdown } from '../engine/allocation.ts';

export interface StoredFundHoldings {
  snapshot: FundSnapshot | null;
  lastCheckedAt: string | null;
  lastAttemptAt: string;
  lastError: string | null;
}

export interface StoredFundSectors {
  ticker: string;
  breakdown: FundBreakdown | null;
  lastCheckedAt: string | null;
  lastAttemptAt: string;
  lastError: string | null;
}

export interface TransactionInput {
  ticker: string;
  type: TxType;
  shares: number;
  price: number;
  date: string;
  account: string;
  note?: string;
}

export interface Security {
  ticker: string;
  assetType: AssetType;
  providerSymbol: string;
  name: string | null;
  sector: string | null;
  status: SecurityStatus;
  historyThrough: string | null;
  historyRequestedFrom: string | null;
  lastHistoryFetch: string | null;
  lastError: string | null;
}

export interface StoredSplit extends Split {
  source: 'provider' | 'manual';
}

export interface ImportedSplit {
  id: number;
  ticker: string;
  exDate: string;
  ratio: number;
}

export interface StoredQuote extends Quote {
  ticker: string;
  fetchedAt: string;
}

export interface ProviderRequest {
  at: string;
  kind: string;
  symbol: string | null;
  status: number | null;
  ok: boolean;
}

export type ImportMode = 'replace' | 'append';

type Row = Record<string, any>;

const toTx = (r: Row): Transaction => ({
  id: r.id,
  seq: r.seq,
  ticker: r.ticker,
  type: r.type,
  shares: r.shares,
  price: r.price,
  date: r.date,
  account: r.account,
  note: r.note,
});

const toSecurity = (r: Row): Security => ({
  ticker: r.ticker,
  assetType: r.asset_type,
  providerSymbol: r.provider_symbol ?? r.ticker,
  name: r.name,
  sector: r.sector,
  status: r.status,
  historyThrough: r.history_through,
  historyRequestedFrom: r.history_requested_from,
  lastHistoryFetch: r.last_history_fetch,
  lastError: r.last_error,
});

export class Queries {
  constructor(readonly db: Database) {}

  getFundHoldings(ticker: string): StoredFundHoldings | null {
    const row = this.db.prepare('SELECT * FROM fund_holdings_cache WHERE ticker = ?').get(ticker) as Row | undefined;
    return row ? {
      snapshot: row.snapshot_json ? JSON.parse(row.snapshot_json) as FundSnapshot : null,
      lastCheckedAt: row.last_checked_at,
      lastAttemptAt: row.last_attempt_at,
      lastError: row.last_error,
    } : null;
  }

  getFundHoldingsStatus(ticker: string): Omit<StoredFundHoldings, 'snapshot'> | null {
    const row = this.db.prepare(`SELECT last_checked_at, last_attempt_at, last_error
      FROM fund_holdings_cache WHERE ticker = ?`).get(ticker) as Row | undefined;
    return row ? { lastCheckedAt: row.last_checked_at, lastAttemptAt: row.last_attempt_at, lastError: row.last_error } : null;
  }

  saveFundHoldings(ticker: string, snapshot: FundSnapshot, at: string): void {
    this.db.prepare(`INSERT INTO fund_holdings_cache (ticker, snapshot_json, last_checked_at, last_attempt_at, last_error)
      VALUES (?, ?, ?, ?, NULL) ON CONFLICT(ticker) DO UPDATE SET
      snapshot_json = excluded.snapshot_json, last_checked_at = excluded.last_checked_at,
      last_attempt_at = excluded.last_attempt_at, last_error = NULL`).run(ticker, JSON.stringify(snapshot), at, at);
  }

  recordFundHoldingsFailure(ticker: string, at: string, error: string): void {
    this.db.prepare(`INSERT INTO fund_holdings_cache (ticker, last_attempt_at, last_error)
      VALUES (?, ?, ?) ON CONFLICT(ticker) DO UPDATE SET
      last_attempt_at = excluded.last_attempt_at, last_error = excluded.last_error`).run(ticker, at, error);
  }

  listFundSectors(): StoredFundSectors[] {
    return (this.db.prepare('SELECT * FROM fund_sectors ORDER BY ticker').all() as Row[]).map((row) => ({
      ticker: row.ticker,
      breakdown: row.breakdown_json ? JSON.parse(row.breakdown_json) as FundBreakdown : null,
      lastCheckedAt: row.last_checked_at,
      lastAttemptAt: row.last_attempt_at,
      lastError: row.last_error,
    }));
  }

  saveFundSectors(ticker: string, breakdown: FundBreakdown, at: string): void {
    this.db.prepare(`INSERT INTO fund_sectors (ticker, breakdown_json, last_checked_at, last_attempt_at, last_error)
      VALUES (?, ?, ?, ?, NULL) ON CONFLICT(ticker) DO UPDATE SET
      breakdown_json = excluded.breakdown_json, last_checked_at = excluded.last_checked_at,
      last_attempt_at = excluded.last_attempt_at, last_error = NULL`).run(ticker, JSON.stringify(breakdown), at, at);
  }

  /** Keeps the last good breakdown; only the attempt and its error are recorded. */
  recordFundSectorsFailure(ticker: string, at: string, error: string): void {
    this.db.prepare(`INSERT INTO fund_sectors (ticker, last_attempt_at, last_error)
      VALUES (?, ?, ?) ON CONFLICT(ticker) DO UPDATE SET
      last_attempt_at = excluded.last_attempt_at, last_error = excluded.last_error`).run(ticker, at, error);
  }

  customBenchmark(): string | null {
    const row = this.db.prepare('SELECT ticker FROM custom_benchmark WHERE id = 1').get() as { ticker: string } | undefined;
    return row?.ticker ?? null;
  }

  setCustomBenchmark(ticker: string | null): void {
    this.db.transaction(() => {
      if (ticker === null) this.db.prepare('DELETE FROM custom_benchmark').run();
      else {
        // A comparison symbol does not tell us whether an eventual holding is a stock or ETF.
        this.db.prepare('INSERT OR IGNORE INTO securities (ticker, asset_type_set) VALUES (?, 0)').run(ticker);
        this.db.prepare('INSERT INTO custom_benchmark (id, ticker) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET ticker = excluded.ticker').run(ticker);
      }
    })();
  }
  // ── Transactions ──────────────────────────────────────────────────────

  listTransactions(): Transaction[] {
    return this.db.prepare('SELECT * FROM transactions ORDER BY date, seq').all().map((r) => toTx(r as Row));
  }

  listAccounts(): string[] {
    return (this.db.prepare('SELECT DISTINCT account FROM transactions ORDER BY account').all() as { account: string }[]).map((r) => r.account);
  }

  getTransaction(id: number): Transaction | null {
    const r = this.db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Row | undefined;
    return r ? toTx(r) : null;
  }

  private nextSeq(): number {
    return ((this.db.prepare('SELECT MAX(seq) AS m FROM transactions').get() as Row).m ?? 0) + 1;
  }

  /** New rows go last for their date. */
  insertTransaction(input: TransactionInput, assetType?: AssetType): Transaction {
    return this.db.transaction(() => {
      const ticker = input.ticker.trim().toUpperCase();
      const info = this.db
        .prepare('INSERT INTO transactions (seq, ticker, type, shares, price, date, account, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(this.nextSeq(), ticker, input.type, input.shares, input.price, input.date, input.account ?? '', input.note ?? '');
      this.ensureSecurity(ticker, assetType);
      return this.getTransaction(Number(info.lastInsertRowid))!;
    })();
  }

  /** A row whose date changes goes last for its new date. */
  updateTransaction(id: number, input: TransactionInput): Transaction | null {
    return this.db.transaction(() => {
      const old = this.getTransaction(id);
      if (!old) return null;
      const ticker = input.ticker.trim().toUpperCase();
      const seq = old.date === input.date ? old.seq : this.nextSeq();
      this.db
        .prepare('UPDATE transactions SET seq = ?, ticker = ?, type = ?, shares = ?, price = ?, date = ?, account = ?, note = ? WHERE id = ?')
        .run(seq, ticker, input.type, input.shares, input.price, input.date, input.account ?? '', input.note ?? '', id);
      this.ensureSecurity(ticker);
      return this.getTransaction(id);
    })();
  }

  deleteTransaction(id: number): boolean {
    return this.db.prepare('DELETE FROM transactions WHERE id = ?').run(id).changes > 0;
  }

  /** Swaps a row with its neighbour on the same date. Returns false if there is none. */
  moveTransaction(id: number, direction: 'up' | 'down'): boolean {
    return this.db.transaction(() => {
      const tx = this.getTransaction(id);
      if (!tx) return false;
      const neighbour = this.db
        .prepare(
          direction === 'up'
            ? 'SELECT id, seq FROM transactions WHERE date = ? AND seq < ? ORDER BY seq DESC LIMIT 1'
            : 'SELECT id, seq FROM transactions WHERE date = ? AND seq > ? ORDER BY seq ASC LIMIT 1',
        )
        .get(tx.date, tx.seq) as Row | undefined;
      if (!neighbour) return false;
      const set = this.db.prepare('UPDATE transactions SET seq = ? WHERE id = ?');
      set.run(neighbour.seq, tx.id);
      set.run(tx.seq, neighbour.id);
      return true;
    })();
  }

  /**
   * Saves a parsed import. Replace-all backs the database up first, then
   * swaps every transaction and imported split for the new ones.
   */
  importTransactions(
    parsed: Pick<ImportResult, 'rows' | 'splits'>,
    mode: ImportMode,
    backup?: { dir: string; now: Date },
  ): { inserted: number; splits: number; backupPath?: string } {
    const backupPath = mode === 'replace' && backup ? backupDatabase(this.db, backup.dir, backup.now) : undefined;
    this.db.transaction(() => {
      if (mode === 'replace') {
        this.db.prepare('DELETE FROM transactions').run();
        this.db.prepare('DELETE FROM imported_splits').run();
      }
      const base = this.nextSeq() - 1;
      const ins = this.db.prepare(
        'INSERT INTO transactions (seq, ticker, type, shares, price, date, account, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const r of parsed.rows) {
        ins.run(base + r.seq, r.ticker, r.type, r.shares, r.price, r.date, r.account, r.note);
        this.ensureSecurity(r.ticker, r.assetType ?? undefined);
      }
      const insSplit = this.db.prepare('INSERT INTO imported_splits (ticker, ex_date, ratio) VALUES (?, ?, ?)');
      for (const s of parsed.splits) insSplit.run(s.ticker, s.exDate, s.ratio);
    })();
    return { inserted: parsed.rows.length, splits: parsed.splits.length, backupPath };
  }

  listImportedSplits(): ImportedSplit[] {
    return this.db
      .prepare('SELECT * FROM imported_splits ORDER BY ex_date, ticker')
      .all()
      .map((r: any) => ({ id: r.id, ticker: r.ticker, exDate: r.ex_date, ratio: r.ratio }));
  }

  // ── Securities ───────────────────────────────────────────────────────

  /** Creates the security if missing. The first asset type seen wins. */
  ensureSecurity(ticker: string, assetType?: AssetType): void {
    this.db.prepare('INSERT OR IGNORE INTO securities (ticker, asset_type) VALUES (?, ?)').run(ticker, assetType ?? 'Stock');
    if (assetType) this.db.prepare('UPDATE securities SET asset_type = ?, asset_type_set = 1 WHERE ticker = ? AND asset_type_set = 0').run(assetType, ticker);
  }

  listSecurities(): Security[] {
    return this.db.prepare('SELECT * FROM securities ORDER BY ticker').all().map((r) => toSecurity(r as Row));
  }

  getSecurity(ticker: string): Security | null {
    const r = this.db.prepare('SELECT * FROM securities WHERE ticker = ?').get(ticker) as Row | undefined;
    return r ? toSecurity(r) : null;
  }

  /**
   * Edits user-owned fields. Changing the provider symbol discards the
   * ticker's provider data so it is fetched again under the new symbol.
   */
  updateSecurity(
    ticker: string,
    patch: Partial<Pick<Security, 'assetType' | 'name' | 'sector' | 'providerSymbol'>>,
  ): Security | null {
    return this.db.transaction(() => {
      const cur = this.getSecurity(ticker);
      if (!cur) return null;
      const next = { ...cur, ...patch };
      const providerSymbol = (next.providerSymbol || ticker).trim().toUpperCase();
      if (patch.assetType !== undefined && patch.assetType !== cur.assetType) this.db.prepare('UPDATE securities SET asset_type_set = 1 WHERE ticker = ?').run(ticker);
      this.db
        .prepare('UPDATE securities SET asset_type = ?, name = ?, sector = ?, provider_symbol = ? WHERE ticker = ?')
        .run(next.assetType, next.name || null, next.sector || null, providerSymbol === ticker ? null : providerSymbol, ticker);
      if (providerSymbol !== cur.providerSymbol) this.resetMarketData(ticker);
      return this.getSecurity(ticker);
    })();
  }

  resetMarketData(ticker: string): void {
    this.db.prepare('DELETE FROM prices WHERE ticker = ?').run(ticker);
    this.db.prepare("DELETE FROM splits WHERE ticker = ? AND source = 'provider'").run(ticker);
    this.db.prepare('DELETE FROM dividends WHERE ticker = ?').run(ticker);
    this.db.prepare('DELETE FROM quotes WHERE ticker = ?').run(ticker);
    this.db
      .prepare("UPDATE securities SET status = 'pending', history_through = NULL, history_requested_from = NULL, last_history_fetch = NULL, last_error = NULL WHERE ticker = ?")
      .run(ticker);
  }

  setSecurityStatus(
    ticker: string,
    fields: { status?: SecurityStatus; historyThrough?: string | null; historyRequestedFrom?: string | null; lastHistoryFetch?: string; lastError?: string | null; name?: string | null },
  ): void {
    const cur = this.getSecurity(ticker);
    if (!cur) return;
    this.db
      .prepare('UPDATE securities SET status = ?, history_through = ?, history_requested_from = ?, last_history_fetch = ?, last_error = ?, name = COALESCE(name, ?) WHERE ticker = ?')
      .run(
        fields.status ?? cur.status,
        fields.historyThrough !== undefined ? fields.historyThrough : cur.historyThrough,
        fields.historyRequestedFrom !== undefined ? fields.historyRequestedFrom : cur.historyRequestedFrom,
        fields.lastHistoryFetch ?? cur.lastHistoryFetch,
        fields.lastError !== undefined ? fields.lastError : cur.lastError,
        fields.name ?? null,
        ticker,
      );
  }

  // ── Market data ──────────────────────────────────────────────────────

  upsertBars(ticker: string, bars: PriceBar[]): void {
    const stmt = this.db.prepare('INSERT INTO prices (ticker, date, close) VALUES (?, ?, ?) ON CONFLICT (ticker, date) DO UPDATE SET close = excluded.close');
    this.db.transaction(() => {
      for (const b of bars) stmt.run(ticker, b.date, b.close);
    })();
  }

  getBars(ticker: string): PriceBar[] {
    return this.db.prepare('SELECT date, close FROM prices WHERE ticker = ? ORDER BY date').all(ticker) as PriceBar[];
  }

  firstBarDate(ticker: string): string | null {
    return (this.db.prepare('SELECT MIN(date) AS d FROM prices WHERE ticker = ?').get(ticker) as Row).d ?? null;
  }

  lastQuoteFetch(): string | null {
    return (this.db.prepare('SELECT MAX(fetched_at) AS t FROM quotes').get() as Row).t ?? null;
  }

  allBars(): Record<string, PriceBar[]> {
    const out: Record<string, PriceBar[]> = {};
    const rows = this.db.prepare('SELECT ticker, date, close FROM prices ORDER BY ticker, date').all() as Row[];
    for (const r of rows) (out[r.ticker] ??= []).push({ date: r.date, close: r.close });
    return out;
  }

  /** Provider splits replace earlier provider rows for the same day; manual rows are kept. */
  upsertProviderSplits(ticker: string, splits: { exDate: string; ratio: number }[]): void {
    const stmt = this.db.prepare(
      "INSERT INTO splits (ticker, ex_date, ratio, source) VALUES (?, ?, ?, 'provider') ON CONFLICT (ticker, ex_date) DO UPDATE SET ratio = excluded.ratio, source = 'provider'",
    );
    this.db.transaction(() => {
      for (const s of splits) stmt.run(ticker, s.exDate, s.ratio);
    })();
  }

  insertManualSplit(split: Split): void {
    this.db
      .prepare("INSERT INTO splits (ticker, ex_date, ratio, source) VALUES (?, ?, ?, 'manual') ON CONFLICT (ticker, ex_date) DO NOTHING")
      .run(split.ticker, split.exDate, split.ratio);
  }

  listSplits(): StoredSplit[] {
    return this.db
      .prepare('SELECT * FROM splits ORDER BY ex_date, ticker')
      .all()
      .map((r: any) => ({ ticker: r.ticker, exDate: r.ex_date, ratio: r.ratio, source: r.source }));
  }

  upsertDividends(ticker: string, dividends: { exDate: string; amount: number }[]): void {
    const stmt = this.db.prepare(
      'INSERT INTO dividends (ticker, ex_date, amount) VALUES (?, ?, ?) ON CONFLICT (ticker, ex_date) DO UPDATE SET amount = excluded.amount',
    );
    this.db.transaction(() => {
      for (const d of dividends) stmt.run(ticker, d.exDate, d.amount);
    })();
  }

  allDividends(): { ticker: string; exDate: string; amount: number }[] {
    return this.db.prepare('SELECT ticker, ex_date AS exDate, amount FROM dividends ORDER BY ex_date, ticker').all() as any;
  }

  listDividends(ticker: string): { exDate: string; amount: number }[] {
    return this.db.prepare('SELECT ex_date AS exDate, amount FROM dividends WHERE ticker = ? ORDER BY ex_date').all(ticker) as any;
  }

  upsertQuote(q: StoredQuote): void {
    this.db
      .prepare(
        'INSERT INTO quotes (ticker, last, prev_close, as_of, fetched_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (ticker) DO UPDATE SET last = excluded.last, prev_close = excluded.prev_close, as_of = excluded.as_of, fetched_at = excluded.fetched_at',
      )
      .run(q.ticker, q.last, q.prevClose, q.asOf, q.fetchedAt);
  }

  listQuotes(): StoredQuote[] {
    return this.db
      .prepare('SELECT * FROM quotes ORDER BY ticker')
      .all()
      .map((r: any) => ({ ticker: r.ticker, last: r.last, prevClose: r.prev_close, asOf: r.as_of, fetchedAt: r.fetched_at }));
  }

  // ── Provider request log ─────────────────────────────────────────────

  logRequest(r: ProviderRequest): void {
    this.db
      .prepare('INSERT INTO provider_requests (at, kind, symbol, status, ok) VALUES (?, ?, ?, ?, ?)')
      .run(r.at, r.kind, r.symbol, r.status, r.ok ? 1 : 0);
  }

  /** Timestamps of requests at or after `since`, oldest first. */
  requestTimesSince(since: string): string[] {
    return (this.db.prepare('SELECT at FROM provider_requests WHERE at >= ? ORDER BY at').all(since) as Row[]).map((r) => r.at);
  }
}
