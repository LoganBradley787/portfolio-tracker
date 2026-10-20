// How personal figures are shown: as they are, hidden, or multiplied by a
// factor the owner chose. For showing the app to someone else. The choice is
// kept in the browser; the settings page never says what it is set to.
// Dollar amounts and share counts follow it; prices, percentages and dates are
// public and never change.

export type Display = { mode: 'real' } | { mode: 'hidden' } | { mode: 'scaled'; factor: number };

const KEY = 'display';
/** What a hidden figure shows. */
export const HIDDEN = '•••••';

function read(): Display {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { mode: 'real' };
    const d = JSON.parse(raw) as Display;
    if (d.mode === 'hidden') return d;
    if (d.mode === 'scaled' && Number.isFinite(d.factor) && d.factor > 0) return d;
  } catch {
    /* no storage */
  }
  return { mode: 'real' };
}

let current: Display = read();

export const display = {
  get: (): Display => current,
  set(d: Display) {
    current = d;
    try {
      if (d.mode === 'real') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      /* not persisted */
    }
  },
  hidden: () => current.mode === 'hidden',
  /** What a dollar amount or share count is multiplied by before it is shown. */
  factor: () => (current.mode === 'scaled' ? current.factor : 1),
};
