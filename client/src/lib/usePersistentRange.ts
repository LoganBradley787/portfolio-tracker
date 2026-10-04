import { useEffect, useState } from 'react';
import type { RangeValue } from './range.ts';

/** State remembered in localStorage under `key` (falls back to `initial`). */
export function usePersistent<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* not persisted */
    }
  }, [key, value]);
  return [value, setValue];
}

/** The selected date range, remembered per page. */
export function usePersistentRange(page: string, initial: RangeValue): [RangeValue, (v: RangeValue) => void] {
  return usePersistent(`range:${page}`, initial);
}
