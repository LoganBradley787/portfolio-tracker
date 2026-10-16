// The top bar: the five areas, then the accounts lens, the price status,
// Refresh, Lock (red, only while a password is set) and Settings, in words. No wordmark: the first area is the home page.
import { Link, NavLink, useLocation } from 'react-router-dom';
import { when } from '../lib/format.ts';
import { useRefresh } from '../lib/refresh.tsx';
import { useLock } from '../lib/lockContext.tsx';
import { Button } from './ui.tsx';
import { useAccount } from '../lib/account.tsx';

export const AREAS = [
  { path: '/', label: 'Holdings', match: ['/', '/chart', '/allocation', '/exposure'] },
  { path: '/performance', label: 'Performance', match: ['/performance'] },
  { path: '/outlook', label: 'Outlook', match: ['/outlook'] },
  { path: '/activity', label: 'Activity', match: ['/activity'] },
  { path: '/data', label: 'Data', match: ['/data'] },
];

export function RefreshStatusLine() {
  const { info } = useRefresh();
  if (!info) return null;
  const s = info.status;
  if (!info.hasKey) return <span className="text-warn">No API key</span>;
  if (s.state === 'running') {
    return (
      <span className="num inline-flex items-center gap-2 text-muted" role="status">
        <span className="relative h-0.5 w-14 overflow-hidden rounded-full bg-rule">
          <span className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-300" style={{ width: `${s.total ? (s.done / s.total) * 100 : 5}%` }} />
        </span>
        Fetching {s.done + 1 > s.total ? s.total : s.done + 1} of {s.total}
        {s.current && s.current !== 'quotes' ? ` · ${s.current}` : ''}
      </span>
    );
  }
  if (s.error) return <span className="text-loss">Refresh failed · saved prices</span>;
  if (s.resumesAt && s.pending.length) {
    return (
      <span className="text-warn">
        {s.pending.length} waiting · resumes {when(s.resumesAt)}
      </span>
    );
  }
  return (
    <span className="text-muted">
      {s.lastSuccessAt ? `Prices ${when(s.lastSuccessAt)}` : info.pricesThrough ? `Prices through ${when(info.pricesThrough)}` : 'No prices yet'}
    </span>
  );
}

/** One on/off chip per account; any mix can be on, and the last one on stays on. */
function AccountPicker() {
  const { selected, accounts, isOn, toggle, showAll } = useAccount();
  if (accounts.length < 2) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <div role="group" aria-label="Accounts shown" className="inline-flex items-center gap-0.5">
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
              className={`h-7 rounded px-2.5 text-[13px] font-semibold transition-colors duration-150 ${on ? 'bg-ink/[0.08] text-ink' : 'text-faint line-through decoration-faint/70 hover:text-muted'}`}
            >
              {a || '(none)'}
            </button>
          );
        })}
      </div>
      {selected !== null && (
        <button type="button" onClick={showAll} className="text-[13px] font-semibold text-accent hover:underline">
          All
        </button>
      )}
    </span>
  );
}

export function Header() {
  const { info, refresh } = useRefresh();
  const lock = useLock();
  const { pathname } = useLocation();
  const current = (a: (typeof AREAS)[number]) => a.match.some((m) => (m === '/' ? pathname === '/' : pathname === m || pathname.startsWith(m + '/')));
  const running = info?.status.state === 'running';
  return (
    <header className="border-b border-rule-strong/50 bg-bg">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-1 px-6 sm:px-10">
        <nav aria-label="Areas" className="order-last flex w-full gap-7 overflow-x-auto overflow-y-hidden md:order-none md:w-auto md:overflow-visible">
          {AREAS.map((a) => (
            <Link
              key={a.path}
              to={a.path}
              aria-current={current(a) ? 'page' : undefined}
              className={`relative py-4 text-[15px] font-semibold whitespace-nowrap transition-colors duration-150 ${
                current(a) ? 'text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-ink' : 'text-muted hover:text-ink'
              }`}
            >
              {a.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex max-w-full flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <AccountPicker />
          <span className="hidden sm:inline">
            <RefreshStatusLine />
          </span>
          {info?.hasKey && (
            <Button size="sm" variant="ghost" onClick={() => void refresh()} busy={running}>
              {running ? 'Refreshing…' : 'Refresh'}
            </Button>
          )}
          {lock.on && (
            <button
              type="button"
              onClick={() => void lock.lock()}
              className="inline-flex h-7 items-center rounded px-2.5 text-[13px] font-semibold text-loss transition-colors duration-150 hover:bg-loss-soft"
            >
              Lock
            </button>
          )}
          <NavLink
            to="/settings"
            className={({ isActive }) => `-mr-2 inline-flex h-7 items-center rounded px-2.5 text-[13px] font-semibold transition-colors duration-150 ${isActive ? 'bg-ink text-bg' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}
          >
            Settings
          </NavLink>
        </div>
      </div>
    </header>
  );
}
