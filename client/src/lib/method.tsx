// The calculation settings chosen on the Settings page: the cost-basis method
// (average cost or FIFO) and whether dividends are reinvested. Both are sent
// on every calculation request, as `?method=` and `?drip=`.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Method = 'average' | 'fifo';

interface Settings {
  method: Method;
  setMethod: (m: Method) => void;
  /** True: every dividend buys more of the same ticker. False: dividends are cash. */
  reinvest: boolean;
  setReinvest: (on: boolean) => void;
}

const MethodContext = createContext<Settings>({ method: 'fifo', setMethod: () => {}, reinvest: true, setReinvest: () => {} });

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not persisted */
  }
};

export function MethodProvider({ children }: { children: ReactNode }) {
  // FIFO unless average cost was chosen. The key changed when the default did, so a browser that
  // only ever held the old default starts on FIFO like a new one.
  const [method, setMethod] = useState<Method>(() => (read('costBasis') === 'average' ? 'average' : 'fifo'));
  const [reinvest, setReinvest] = useState<boolean>(() => read('reinvestDividends') !== 'off');
  useEffect(() => write('costBasis', method), [method]);
  useEffect(() => write('reinvestDividends', reinvest ? 'on' : 'off'), [reinvest]);
  return <MethodContext.Provider value={{ method, setMethod, reinvest, setReinvest }}>{children}</MethodContext.Provider>;
}

export const useMethod = () => useContext(MethodContext);

const CALCULATED = ['/api/portfolio', '/api/exposure', '/api/realized', '/api/series', '/api/performance', '/api/health-report', '/api/ticker/', '/api/movers', '/api/outlook'];

/** Adds `method=average` and `drip=off` to calculation endpoints when chosen; FIFO and reinvesting are the defaults. */
export function withMethod(path: string, method: Method, reinvest = true): string {
  if (!CALCULATED.some((p) => path.startsWith(p))) return path;
  const params = [...(method === 'average' ? ['method=average'] : []), ...(reinvest ? [] : ['drip=off'])];
  if (!params.length) return path;
  return path + (path.includes('?') ? '&' : '?') + params.join('&');
}
