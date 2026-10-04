// Opens the database and brings its schema up to date. Backs up an existing
// database before applying any migration to it.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import BetterSqlite3, { type Database } from 'better-sqlite3';
import { backupDatabase } from './backup.ts';

const MIGRATIONS: { version: number; sql: () => string }[] = [
  { version: 1, sql: () => readFileSync(join(import.meta.dirname, 'schema.sql'), 'utf8') },
  { version: 2, sql: () => `
    CREATE TABLE custom_benchmark (id INTEGER PRIMARY KEY CHECK (id = 1), ticker TEXT NOT NULL);
    ALTER TABLE securities ADD COLUMN asset_type_set INTEGER NOT NULL DEFAULT 1;
  ` },
  { version: 3, sql: () => 'ALTER TABLE securities ADD COLUMN history_requested_from TEXT' },
  { version: 4, sql: () => `
    CREATE TABLE fund_holdings_cache (
      ticker TEXT PRIMARY KEY,
      snapshot_json TEXT,
      last_checked_at TEXT,
      last_attempt_at TEXT NOT NULL,
      last_error TEXT
    );
  ` },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export interface OpenOptions {
  /** Where backups go. Defaults to `<db dir>/backups`. */
  backupDir?: string;
  now?: () => Date;
}

export function openDatabase(path: string, opts: OpenOptions = {}): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new BetterSqlite3(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const backupDir = opts.backupDir ?? (path === ':memory:' ? undefined : join(dirname(path), 'backups'));
  migrate(db, { backupDir, now: opts.now ?? (() => new Date()) });
  return db;
}

export function currentVersion(db: Database): number {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'").get();
  if (!has) return 0;
  return (db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }).v ?? 0;
}

export function migrate(db: Database, opts: { backupDir?: string; now: () => Date }): { from: number; to: number; backup?: string } {
  const from = currentVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > from);
  if (!pending.length) return { from, to: from };
  const hasTables = (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n > 0;
  const backup = hasTables && opts.backupDir ? backupDatabase(db, opts.backupDir, opts.now()) : undefined;
  db.transaction(() => {
    for (const m of pending) {
      db.exec(m.sql());
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(m.version);
    }
  })();
  return { from, to: pending[pending.length - 1].version, backup };
}
