// The accounts shown (any of them, or all), toggled in the header and sent as
// `?account=` (once per account) on every calculation request except Data health.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api.ts';
import { useDataVersion } from './refresh.tsx';

/** null = every account; otherwise the accounts turned on (never empty). */
export type Selection = string[] | null;

const AccountContext = createContext<{ selected: Selection; accounts: string[]; isOn: (a: string) => boolean; toggle: (a: string) => void; showAll: () => void }>({
  selected: null,
  accounts: [],
  isOn: () => true,
  toggle: () => {},
  showAll: () => {},
});

function saved(): Selection {
  try {
    const v = JSON.parse(localStorage.getItem('account') ?? 'null') as unknown;
    // Before several accounts could be on, this held one account name.
    if (typeof v === 'string') return [v];
    return Array.isArray(v) && v.length ? (v as string[]) : null;
  } catch {
    return null;
  }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const version = useDataVersion();
  const [selected, setSelected] = useState<Selection>(saved);
  const [accounts, setAccounts] = useState<string[] | null>(null);

  useEffect(() => {
    api<{ accounts: string[] }>('/api/config')
      .then((c) => setAccounts(c.accounts))
      .catch(() => {});
  }, [version]);

  // Accounts that no longer have transactions (renamed, or a Replace all) drop out; none left falls back to all.
  useEffect(() => {
    if (!accounts || selected === null) return;
    const kept = selected.filter((a) => accounts.includes(a));
    if (kept.length !== selected.length) setSelected(kept.length ? kept : null);
  }, [accounts, selected]);

  useEffect(() => {
    try {
      localStorage.setItem('account', JSON.stringify(selected));
    } catch {
      /* not persisted */
    }
  }, [selected]);

  const all = accounts ?? [];
  const isOn = (a: string) => selected === null || selected.includes(a);
  /** Turns one account on or off. The last one on stays on; all on is stored as null. */
  const toggle = (a: string) => {
    const next = all.filter((x) => (x === a ? !isOn(x) : isOn(x)));
    if (next.length) setSelected(next.length === all.length ? null : next);
  };

  return <AccountContext.Provider value={{ selected, accounts: all, isOn, toggle, showAll: () => setSelected(null) }}>{children}</AccountContext.Provider>;
}

export const useAccount = () => useContext(AccountContext);

const PER_ACCOUNT = ['/api/portfolio', '/api/exposure', '/api/realized', '/api/series', '/api/performance', '/api/ticker/'];

/** Adds `account=` per selected account to calculation endpoints, unless every account is on. */
export function withAccount(path: string, selected: Selection): string {
  if (selected === null || !PER_ACCOUNT.some((p) => path.startsWith(p))) return path;
  return path + (path.includes('?') ? '&' : '?') + selected.map((a) => 'account=' + encodeURIComponent(a)).join('&');
}
