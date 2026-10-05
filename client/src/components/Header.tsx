// The top bar: wordmark, the five areas, then the two global lenses (accounts
// and cost method), the price status and Refresh. One hairline under it.
import { NavLink } from 'react-router-dom';
import { when } from '../lib/format.ts';
import { useRefresh } from '../lib/refresh.tsx';
import { useMethod, type Method } from '../lib/method.tsx';
import { Button } from './ui.tsx';
import { useAccount } from '../lib/account.tsx';

export const AREAS = [
  { path: '/', label: 'Holdings', match: ['/', '/allocation', '/exposure', '/fees'] },
  { path: '/performance', label: 'Performance', match: ['/performance'] },
  { path: '/activity', label: 'Activity', match: ['/activity'] },
  { path: '/outlook', label: 'Outlook', match: ['/outlook'] },
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
    <span className="inline-flex items-center gap-1.5">
      <div role="group" aria-label="Accounts shown" className="inline-flex items-center gap-px">
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
              className={`h-6 rounded-sm px-2 text-xs font-medium transition-colors duration-150 ${on ? 'bg-ink/[0.07] text-ink' : 'text-faint line-through decoration-faint/70 hover:text-muted'}`}
            >
              {a || '(none)'}
            </button>
          );
        })}
      </div>
      {selected !== null && (
        <button type="button" onClick={showAll} className="text-xs font-medium text-accent hover:underline">
          All
        </button>
      )}
    </span>
  );
}

/** Average cost or FIFO: it changes every cost and gain figure, so it lives beside the accounts. */
function MethodPicker() {
  const { method, setMethod } = useMethod();
  const options: { value: Method; label: string; title: string }[] = [
    { value: 'average', label: 'Avg cost', title: 'Average cost: each ticker’s purchases pooled, as the spreadsheet does' },
    { value: 'fifo', label: 'FIFO', title: 'FIFO: each purchase is its own lot; the oldest in an account sells first' },
  ];
  return (
    <div role="radiogroup" aria-label="Cost basis method" className="inline-flex items-center gap-px">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={method === o.value}
          title={o.title}
          onClick={() => setMethod(o.value)}
          className={`h-6 rounded-sm px-2 text-xs font-medium transition-colors duration-150 ${method === o.value ? 'bg-ink/[0.07] text-ink' : 'text-faint hover:text-muted'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Header() {
  const { info, refresh } = useRefresh();
  const running = info?.status.state === 'running';
  return (
    <header className="border-b border-rule-strong/50 bg-bg">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-7 gap-y-1 px-5 sm:px-8">
        <NavLink to="/" className="py-3.5 text-[15px] font-semibold tracking-tight text-ink">
          Portfolio
        </NavLink>
        <nav aria-label="Areas" className="order-last flex w-full gap-5 overflow-x-auto md:order-none md:w-auto">
          {AREAS.map((a) => (
            <NavLink
              key={a.path}
              to={a.path}
              end={a.path === '/'}
              className={({ isActive }) =>
                `relative py-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 ${
                  isActive ? 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-ink' : 'text-muted hover:text-ink'
                }`
              }
            >
              {a.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex max-w-full flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <AccountPicker />
          <MethodPicker />
          <span className="hidden sm:inline">
            <RefreshStatusLine />
          </span>
          {info?.hasKey && (
            <Button size="sm" variant="ghost" onClick={() => void refresh()} busy={running} className="-mr-2">
              {running ? 'Refreshing…' : 'Refresh'}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
