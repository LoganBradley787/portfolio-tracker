// Shared refresh status. Polls while a refresh runs and bumps a data version
// when one finishes, so pages re-fetch without the user doing anything.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api.ts';

export interface RefreshInfo {
  hasKey: boolean;
  status: {
    state: 'idle' | 'running' | 'no-key';
    startedAt: string | null;
    finishedAt: string | null;
    done: number;
    total: number;
    current: string | null;
    pending: string[];
    resumesAt: string | null;
    error: { kind: string; message: string; at: string } | null;
    lastSuccessAt: string | null;
  };
  budget: { used: number; remaining: number; limit: number };
  pricesThrough: string | null;
  holdingsRefresh: { state: 'idle' | 'running'; finishedAt: string | null };
}

interface Ctx {
  info: RefreshInfo | null;
  version: number;
  refresh: () => Promise<void>;
  bump: () => void;
  /** Tell the poller a refresh may have started server-side. */
  poke: () => void;
}

const RefreshContext = createContext<Ctx>({ info: null, version: 0, refresh: async () => {}, bump: () => {}, poke: () => {} });

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<RefreshInfo | null>(null);
  const [version, setVersion] = useState(0);
  // The first poll establishes the baseline; only later changes trigger a re-fetch.
  const seen = useRef<string | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const poll = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      const next = await api<RefreshInfo>('/api/refresh/status');
      setInfo(next);
      const finished = JSON.stringify([next.status.finishedAt, next.holdingsRefresh?.finishedAt ?? null]);
      if (seen.current !== undefined && finished !== seen.current) setVersion((v) => v + 1);
      seen.current = finished;
      timer.current = setTimeout(poll, next.status.state === 'running' || next.holdingsRefresh?.state === 'running' ? 1500 : 30_000);
    } catch {
      timer.current = setTimeout(poll, 10_000);
    }
  }, []);

  useEffect(() => {
    void poll();
    return () => clearTimeout(timer.current);
  }, [poll]);

  const refresh = useCallback(async () => {
    try {
      await api('/api/refresh', { method: 'POST' });
    } finally {
      void poll();
    }
  }, [poll]);

  const poke = useCallback(() => {
    setTimeout(poll, 400);
  }, [poll]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  return <RefreshContext.Provider value={{ info, version, refresh, bump, poke }}>{children}</RefreshContext.Provider>;
}

export const useRefresh = () => useContext(RefreshContext);
export const useDataVersion = () => useContext(RefreshContext).version;
