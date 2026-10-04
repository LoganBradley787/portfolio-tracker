import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';

/** Copies the database to `<dir>/<timestamp>.db` and returns the path. */
export function backupDatabase(db: Database, dir: string, now: Date): string {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  let path = join(dir, `${stamp}.db`);
  for (let n = 1; existsSync(path); n++) path = join(dir, `${stamp}-${n}.db`);
  db.prepare('VACUUM INTO ?').run(path);
  return path;
}
