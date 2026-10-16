// The optional password. It keeps someone at the owner's computer from opening
// the app and reading everything in two seconds; it is not security. The
// password sits as plain text in a file beside the database, so the owner can
// read it or delete it to get back in. Unlocks live in memory and end when the
// server stops.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export class Lock {
  private tokens = new Set<string>();

  /** `file` is where the password is kept; no file (or an empty one) means no password. */
  constructor(private readonly file: string | null) {}

  password(): string | null {
    if (!this.file || !existsSync(this.file)) return null;
    const text = readFileSync(this.file, 'utf8').trim();
    return text || null;
  }

  on(): boolean {
    return this.password() !== null;
  }

  set(password: string): void {
    if (!this.file) throw new Error('No password file configured');
    writeFileSync(this.file, password.trim() + '\n', { mode: 0o600 });
  }

  clear(): void {
    if (this.file && existsSync(this.file)) rmSync(this.file);
    this.tokens.clear();
  }

  /** A token for the browser tab when the password matches; null otherwise. */
  unlock(password: string): string | null {
    const want = this.password();
    if (want === null || password !== want) return null;
    const token = randomBytes(24).toString('base64url');
    this.tokens.add(token);
    return token;
  }

  forget(token: string): void {
    this.tokens.delete(token);
  }

  /** Whether a request may pass: always when there is no password. */
  allows(token: string | undefined): boolean {
    return !this.on() || (token !== undefined && this.tokens.has(token));
  }
}
