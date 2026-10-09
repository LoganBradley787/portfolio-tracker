import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { useDataVersion } from './refresh.tsx';
import { useMethod, withMethod } from './method.tsx';
import { useAccount, withAccount } from './account.tsx';

/** GETs a path, re-fetching when the path or the app's data version changes. */
export function useApi<T>(rawPath: string | null) {
  const version = useDataVersion();
  const { method, reinvest } = useMethod();
  const { selected } = useAccount();
  const path = rawPath === null ? null : withAccount(withMethod(rawPath, method, reinvest), selected);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (mine === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(e as Error);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load, version]);

  return { data, error, loading, reload: load };
}
