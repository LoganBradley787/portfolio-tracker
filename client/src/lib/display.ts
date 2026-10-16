// How personal figures are shown: as they are, or hidden. For showing the app
// to someone else. The choice is kept in the browser. Dollar amounts and share
// counts follow it; prices, percentages and dates are public and never change.

export type Display = { mode: 'real' } | { mode: 'hidden' };

const KEY = 'display';
/** What a hidden figure shows. */
export const HIDDEN = '•••••';

function read(): Display {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw && (JSON.parse(raw) as Display).mode === 'hidden') return { mode: 'hidden' };
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
};
