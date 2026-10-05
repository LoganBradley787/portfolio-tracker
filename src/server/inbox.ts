// The drop folder: a broker export saved into `<inbox>/<account name>/` is
// imported without opening the Import page. Only broker exports are taken,
// because they are matched against the ledger and can only add missing trades;
// a sheet export has no such check. An imported file moves to the account's
// `imported/` folder; a file that cannot be read stays where it is and is
// reported until it is fixed or removed.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { basename, join } from 'node:path';
import { backupDatabase } from '../db/backup.ts';
import type { Queries } from '../db/queries.ts';
import { parseForImport } from './importer.ts';

export interface InboxEntry {
  at: string;
  /** Path under the inbox, e.g. `Taxable/activity.csv`. */
  file: string;
  account: string;
  ok: boolean;
  /** Trades added (0 when the ledger already had them all). */
  inserted: number;
  /** Rows left out: already in the app, or not a stock or ETF trade. */
  skipped: number;
  message: string;
}

export interface InboxStatus {
  dir: string;
  /** Files still in the folder because they could not be imported. */
  waiting: InboxEntry[];
  /** Newest first. */
  recent: InboxEntry[];
}

const LOG = 'import-log.json';
const README = 'README.txt';
const DONE = 'imported';
const KEEP = 50;
const SCAN_MS = 10_000;

const README_TEXT = `Drop folder
===========

Make a folder here named after an account (for example "Taxable"), and save
that account's broker export into it: a Schwab JSON transaction export or a
Robinhood account activity CSV. The app adds the trades it does not already
have and moves the file into that folder's "imported" folder.

A file it cannot read stays where it is and is listed on the Data health page.
`;

export class Inbox {
  readonly dir: string;
  private readonly q: Queries;
  private readonly now: () => Date;
  private readonly backupDir?: string;
  private readonly settleMs: number;
  private readonly onImported: () => void;
  /** Failed files by path, with the size and time they failed at, so an unchanged file is not read again. */
  private readonly failed = new Map<string, { stamp: string; entry: InboxEntry }>();
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private nextScanAt = 0;

  constructor(deps: { dir: string; q: Queries; now: () => Date; backupDir?: string; onImported?: () => void; settleMs?: number }) {
    this.dir = deps.dir;
    this.q = deps.q;
    this.now = deps.now;
    this.backupDir = deps.backupDir;
    this.onImported = deps.onImported ?? (() => {});
    // A file still being written is left for the next pass.
    this.settleMs = deps.settleMs ?? 2_000;
  }

  status(): InboxStatus {
    return { dir: this.dir, waiting: [...this.failed.values()].map((f) => f.entry), recent: this.log() };
  }

  /** Creates the folder, imports what is already in it, and imports new files as they arrive. */
  start(): void {
    mkdirSync(this.dir, { recursive: true });
    if (!existsSync(join(this.dir, README))) writeFileSync(join(this.dir, README), README_TEXT);
    this.safeScan();
    try {
      this.watcher = watch(this.dir, { recursive: true }, () => this.schedule());
      this.watcher.on('error', (error) => console.error('Drop folder watch failed', error));
    } catch (error) {
      // No recursive watch on this platform: page loads still scan.
      console.error('Drop folder watch unavailable', error);
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** A scan from a page load, at most every ten seconds. */
  maybeScan(): void {
    if (Date.now() < this.nextScanAt) return;
    this.safeScan();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.safeScan(), this.settleMs + 250);
  }

  private safeScan(): void {
    try {
      this.scan();
    } catch (error) {
      console.error('Drop folder scan failed', error);
    }
  }

  /** Imports every readable file now. Returns what happened to each file handled in this pass. */
  scan(): InboxEntry[] {
    this.nextScanAt = Date.now() + SCAN_MS;
    if (!existsSync(this.dir)) return [];
    const out: InboxEntry[] = [];
    const seen = new Set<string>();
    let unsettled = false;
    const visit = (file: string, account: string | null) => {
      const path = join(this.dir, file);
      const stat = statSync(path);
      const stamp = `${stat.size}|${stat.mtimeMs}`;
      seen.add(file);
      if (this.failed.get(file)?.stamp === stamp) return;
      if (this.settleMs > 0 && Date.now() - stat.mtimeMs < this.settleMs) {
        unsettled = true;
        return;
      }
      const entry = account === null
        ? this.entry(file, '', false, 'Move this file into a folder named after its account')
        : this.importFile(file, account);
      if (entry.ok) this.failed.delete(file);
      else this.failed.set(file, { stamp, entry });
      out.push(entry);
    };
    for (const item of readdirSync(this.dir, { withFileTypes: true })) {
      if (item.name.startsWith('.') || item.name === LOG || item.name === README) continue;
      if (item.isFile()) visit(item.name, null);
      if (!item.isDirectory()) continue;
      for (const inner of readdirSync(join(this.dir, item.name), { withFileTypes: true })) {
        if (inner.isFile() && !inner.name.startsWith('.')) visit(join(item.name, inner.name), item.name.trim());
      }
    }
    for (const file of [...this.failed.keys()]) if (!seen.has(file)) this.failed.delete(file);
    if (out.length) this.writeLog([...out].reverse().concat(this.log()).slice(0, KEEP));
    if (out.some((e) => e.inserted > 0)) this.onImported();
    if (unsettled) this.schedule();
    return out;
  }

  private entry(file: string, account: string, ok: boolean, message: string, inserted = 0, skipped = 0): InboxEntry {
    return { at: this.now().toISOString(), file, account, ok, inserted, skipped, message };
  }

  private importFile(file: string, account: string): InboxEntry {
    const fail = (message: string) => this.entry(file, account, false, message);
    let text: string;
    try {
      text = readFileSync(join(this.dir, file), 'utf8');
    } catch (error) {
      return fail(`Could not read the file: ${(error as Error).message}`);
    }
    const parsed = parseForImport(this.q, text, account);
    if (!parsed.source) return fail('Not a Schwab JSON or Robinhood activity export. Use Transactions → Import for the sheet format');
    if (parsed.fileErrors.length) return fail(parsed.fileErrors.join('; '));
    if (parsed.errors.length) {
      const first = parsed.errors[0];
      return fail(`Row ${first.row}: ${first.message}${parsed.errors.length > 1 ? ` (and ${parsed.errors.length - 1} more)` : ''}. Nothing was imported`);
    }
    const skipped = parsed.skipped?.length ?? 0;
    if (parsed.rows.length) {
      if (this.backupDir) backupDatabase(this.q.db, this.backupDir, this.now());
      this.q.importTransactions(parsed, 'append');
    }
    const done = join(this.dir, account, DONE);
    mkdirSync(done, { recursive: true });
    const stamp = this.now().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    const name = basename(file);
    let target = join(done, `${stamp}-${name}`);
    for (let n = 1; existsSync(target); n++) target = join(done, `${stamp}-${n}-${name}`);
    renameSync(join(this.dir, file), target);
    const n = parsed.rows.length;
    return this.entry(file, account, true, n ? `Added ${n} ${n === 1 ? 'trade' : 'trades'}` : 'Nothing new: every trade was already in the app', n, skipped);
  }

  private log(): InboxEntry[] {
    try {
      const saved = JSON.parse(readFileSync(join(this.dir, LOG), 'utf8'));
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  private writeLog(entries: InboxEntry[]): void {
    writeFileSync(join(this.dir, LOG), JSON.stringify(entries, null, 2));
  }
}
