// The cost-basis method (average cost or FIFO), chosen on the Settings page and
// sent as `?method=` on every calculation request.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Method = 'average' | 'fifo';

const MethodContext = createContext<{ method: Method; setMethod: (m: Method) => void }>({ method: 'average', setMethod: () => {} });

export function MethodProvider({ children }: { children: ReactNode }) {
  const [method, setMethod] = useState<Method>(() => {
    try {
      return localStorage.getItem('costMethod') === 'fifo' ? 'fifo' : 'average';
    } catch {
      return 'average';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('costMethod', method);
    } catch {
      /* not persisted */
    }
  }, [method]);
  return <MethodContext.Provider value={{ method, setMethod }}>{children}</MethodContext.Provider>;
}

export const useMethod = () => useContext(MethodContext);

const CALCULATED = ['/api/portfolio', '/api/exposure', '/api/realized', '/api/series', '/api/performance', '/api/health-report', '/api/ticker/'];

/** Adds `method=fifo` to calculation endpoints when FIFO is selected. */
export function withMethod(path: string, method: Method): string {
  if (method !== 'fifo' || !CALCULATED.some((p) => path.startsWith(p))) return path;
  return path + (path.includes('?') ? '&' : '?') + 'method=fifo';
}
