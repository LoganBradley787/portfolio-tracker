// The unlock for this tab. The server hands out a token for the right
// password; it lives in sessionStorage, so closing the tab forgets it, and
// every request carries it. When the server says "locked", the app shows the
// password screen again.

const KEY = 'unlock';

const listeners = new Set<() => void>();
let holding = false;

export const unlock = {
  token(): string | null {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      sessionStorage.setItem(KEY, token);
    } catch {
      /* not kept: the next page load asks again */
    }
  },
  /** While a password is being set, a "locked" reply to a request already in flight is stale and must not lock the tab. */
  async hold<T>(fn: () => Promise<T>): Promise<T> {
    holding = true;
    try {
      return await fn();
    } finally {
      holding = false;
    }
  },
  forget() {
    if (holding) return;
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* nothing kept */
    }
    for (const l of listeners) l();
  },
  /** Called when the server refuses a request because the tab is locked. */
  onLocked(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** `?unlock=` for a plain link that cannot carry a header, such as the CSV export. */
  link(path: string): string {
    const t = this.token();
    return t ? path + (path.includes('?') ? '&' : '?') + 'unlock=' + encodeURIComponent(t) : path;
  },
};
