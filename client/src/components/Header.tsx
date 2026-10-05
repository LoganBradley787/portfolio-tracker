import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { when } from '../lib/format.ts';
import { useRefresh } from '../lib/refresh.tsx';
import { Button } from './ui.tsx';
import { useAccount } from '../lib/account.tsx';

const PAGES = [
  { path: '/', label: 'Overview' },
  { path: '/performance', label: 'Performance' },
  { path: '/exposure', label: 'Exposure' },
  { path: '/outlook', label: 'Outlook' },
  { path: '/realized', label: 'Realized' },
  { path: '/transactions', label: 'Transactions' },
  { path: '/health', label: 'Data health' },
];

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* private mode: theme just won't persist */
    }
  }, [theme]);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <Button variant="ghost" size="sm" onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {theme === 'dark' ? (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" strokeLinejoin="round" />
        </svg>
      )}
    </Button>
  );
}

export function RefreshStatusLine() {
  const { info } = useRefresh();
  if (!info) return null;
  const s = info.status;
  if (!info.hasKey) return <span className="text-warn">No API key</span>;
  if (s.state === 'running') {
    return (
      <span className="num inline-flex items-center gap-2 text-muted" role="status">
        <span className="relative h-1 w-16 overflow-hidden rounded-full bg-surface-2">
          <span className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-300" style={{ width: `${s.total ? (s.done / s.total) * 100 : 5}%` }} />
        </span>
        Fetching {s.done + 1 > s.total ? s.total : s.done + 1} of {s.total}
        {s.current && s.current !== 'quotes' ? ` · ${s.current}` : ''}
      </span>
    );
  }
  if (s.error) return <span className="text-loss">Refresh failed · showing saved prices</span>;
  if (s.resumesAt && s.pending.length) {
    return (
      <span className="text-warn">
        {s.pending.length} waiting · resumes {when(s.resumesAt)}
      </span>
    );
  }
  return (
    <span className="text-muted">
      {s.lastSuccessAt ? `Updated ${when(s.lastSuccessAt)}` : info.pricesThrough ? `Prices through ${when(info.pricesThrough)}` : 'No prices yet'}
    </span>
  );
}

/** One on/off button per account; any mix can be on, and the last one on stays on. */
function AccountPicker() {
  const { selected, accounts, isOn, toggle, showAll } = useAccount();
  if (accounts.length < 2) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <div role="group" aria-label="Accounts shown" className="inline-flex rounded-md border border-rule-strong bg-surface p-0.5">
        {accounts.map((a) => {
          const on = isOn(a);
          const last = on && selected?.length === 1;
          return (
            <button
              key={a}
              type="button"
              aria-pressed={on}
              title={last ? 'The only account shown; turn another on first' : on ? `Hide ${a || '(none)'}` : `Show ${a || '(none)'}`}
              onClick={() => toggle(a)}
              className={`h-7 rounded px-2.5 text-xs font-medium transition-colors duration-150 ${on ? 'bg-accent-soft text-accent' : 'text-muted line-through hover:text-ink'}`}
            >
              {a || '(none)'}
            </button>
          );
        })}
      </div>
      {selected !== null && (
        <button type="button" onClick={showAll} className="text-xs font-medium text-accent hover:underline">
          Show all
        </button>
      )}
    </span>
  );
}

export function Header() {
  const { info, refresh } = useRefresh();
  const running = info?.status.state === 'running';
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-bg/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-6 gap-y-1 px-4 sm:px-6">
        <span className="py-3 text-[15px] font-semibold tracking-tight text-ink">Portfolio</span>
        <nav aria-label="Pages" className="order-last flex w-full overflow-x-auto md:order-none md:w-auto md:gap-1">
          {PAGES.map((p) => (
            <NavLink
              key={p.path}
              to={p.path}
              end
              className={({ isActive }) =>
                `relative px-1.5 py-3 text-[13px] sm:px-2 font-medium whitespace-nowrap transition-colors duration-150 ${
                  isActive ? 'text-ink after:absolute after:inset-x-1.5 sm:after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent' : 'text-muted hover:text-ink'
                }`
              }
            >
              {p.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex max-w-full flex-wrap items-center gap-3 text-xs">
          <AccountPicker />
          <span className="hidden sm:inline">
            <RefreshStatusLine />
          </span>
          {info?.hasKey && (
            <Button size="sm" variant="secondary" onClick={() => void refresh()} busy={running}>
              {running ? 'Refreshing…' : 'Refresh'}
            </Button>
          )}
          <ThemeToggle />
          <NavLink
            to="/settings"
            aria-label="Settings"
            title="Settings"
            className={({ isActive }) => `inline-flex size-7 items-center justify-center rounded-md hover:bg-surface-2 ${isActive ? 'text-ink' : 'text-muted hover:text-ink'}`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 4.5h7M12.5 4.5H14M2 11.5h1.5M7 11.5h7" />
              <circle cx="10.75" cy="4.5" r="1.75" />
              <circle cx="5.25" cy="11.5" r="1.75" />
            </svg>
          </NavLink>
        </div>
      </div>
    </header>
  );
}
