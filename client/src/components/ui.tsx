// Small shared pieces. One button shape, one control vocabulary, one way to
// head a page and one way to lay out a row of figures.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface text-ink border border-rule-strong/70 hover:border-rule-strong hover:bg-surface-2/60',
  ghost: 'text-muted hover:text-ink hover:bg-surface-2',
  danger: 'bg-surface text-loss border border-rule-strong/70 hover:bg-loss-soft',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; busy?: boolean }) {
  const sizing = size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-[13px]';
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-1.5 rounded font-medium transition-[background-color,filter,color,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** A row of exclusive choices: text buttons on a hairline, the chosen one in ink with an underline. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'sm',
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center rounded border border-rule-strong/60 bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-[3px] font-medium whitespace-nowrap transition-colors duration-150 ${size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]'} ${
            value === o.value ? 'bg-ink text-bg' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ tone = 'warn', title, children, action }: { tone?: 'warn' | 'loss' | 'info'; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const bar = { warn: 'border-warn', loss: 'border-loss', info: 'border-accent' };
  return (
    <div role={tone === 'info' ? 'status' : 'alert'} className={`flex items-start gap-3 border-l-2 bg-surface py-2.5 pr-3 pl-3.5 ${bar[tone]}`}>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{title}</p>
        {children && <div className="mt-0.5 text-[13px] text-muted">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export interface SubTab {
  to: string;
  label: string;
  /** Match only this exact path. */
  end?: boolean;
}

/**
 * The head of every page: the area's sub-tabs on the left, the page's own
 * controls on the right, on one rule. Below it, an optional line of context.
 */
export function PageHeader({ tabs, controls, children }: { tabs?: SubTab[]; controls?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-rule-strong/60">
        {tabs ? (
          <nav aria-label="Sections" className="-mb-px flex gap-5 overflow-x-auto">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `border-b-2 pt-1 pb-2 text-[15px] font-medium whitespace-nowrap transition-colors duration-150 ${isActive ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        ) : (
          <span />
        )}
        {controls && <div className="flex flex-wrap items-center gap-2 pb-2">{controls}</div>}
      </div>
      {children && <div className="mt-3 text-[13px] text-muted">{children}</div>}
    </div>
  );
}

/** A plain title for pages outside an area (the ticker detail). */
export function PageTitle({ title, children, aside, above }: { title: ReactNode; children?: ReactNode; aside?: ReactNode; above?: ReactNode }) {
  return (
    <div className="mb-5">
      {above}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-medium tracking-tight text-ink">{title}</h1>
          {children && <p className="mt-0.5 text-[13px] text-muted">{children}</p>}
        </div>
        {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
      </div>
    </div>
  );
}

/** A titled block within a page. Sections sit on the page ground; the title is a quiet line. */
export function Section({ title, count, children, aside, className = '', flush }: { title?: ReactNode; count?: number; children: ReactNode; aside?: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`${flush ? '' : 'mt-8 first:mt-0'} ${className}`}>
      {(title || aside) && (
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-ink">
            {title}
            {count !== undefined && <span className="num ml-1.5 font-normal text-faint">{count}</span>}
          </h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** A row of figures between two rules, divided by hairlines. */
export function StatRow({ children, cols = 4, className = '' }: { children: ReactNode; cols?: 3 | 4 | 5 | 6; className?: string }) {
  const grid = { 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5', 6: 'sm:grid-cols-3 lg:grid-cols-6' }[cols];
  return <dl className={`grid grid-cols-2 border-y border-rule-strong/60 sm:divide-x sm:divide-rule ${grid} ${className}`}>{children}</dl>;
}

export function Stat({ label, value, sub, tone = '', size = 'md' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: string; size?: 'md' | 'lg' }) {
  return (
    <div className="min-w-0 py-3 pr-4 sm:px-4 sm:first:pl-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`num mt-1 font-medium tracking-tight ${size === 'lg' ? 'text-[22px] leading-7' : 'text-[17px] leading-6'} ${tone}`}>{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-muted">{sub}</dd>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border-y border-rule px-5 py-7 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-prose text-[13px] text-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-7 animate-pulse rounded-sm bg-surface-2" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

export function ErrorLine({ error }: { error: Error | null }) {
  if (!error) return null;
  return <Notice tone="loss" title="Could not load this page">{error.message}. Is the server still running?</Notice>;
}

export const inputClass =
  'h-8 w-full rounded border border-rule-strong/70 bg-surface px-2.5 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-loss';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** A small explanatory line under a table or chart. */
export function Note({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`mt-2 max-w-prose text-xs leading-relaxed text-muted ${className}`}>{children}</p>;
}

/** Two columns on wide screens, stacked below. `split` is the width ratio. */
export function Columns({ children, split = 'even', className = '' }: { children: ReactNode; split?: 'even' | 'wide-left' | 'wide-right'; className?: string }) {
  const cols = { even: 'lg:grid-cols-2', 'wide-left': 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]', 'wide-right': 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' }[split];
  return <div className={`grid grid-cols-1 gap-x-10 gap-y-8 ${cols} ${className}`}>{children}</div>;
}
