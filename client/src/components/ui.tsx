// Small shared pieces. One button shape, one control vocabulary, one way to
// head a page and one way to lay out a row of figures. Explanations live
// behind an (i), never in a paragraph under the thing they explain.
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
  const sizing = size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3.5 text-[14px]';
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-1.5 rounded font-semibold transition-[background-color,filter,color,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** A row of exclusive choices; the chosen one is set in ink. `null` means none is chosen. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'sm',
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center rounded-md border border-rule-strong/60 bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded font-semibold whitespace-nowrap transition-colors duration-150 ${size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-8 px-3 text-[14px]'} ${
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
    <div role={tone === 'info' ? 'status' : 'alert'} className={`flex items-start gap-3 border-l-[3px] bg-surface-2/60 py-2.5 pr-3 pl-3.5 ${bar[tone]}`}>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{title}</p>
        {children && <div className="mt-0.5 text-[14px] text-muted">{children}</div>}
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
    <div className="mb-7">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-rule-strong/60">
        {tabs ? (
          <nav aria-label="Sections" className="-mb-px flex gap-6 overflow-x-auto overflow-y-hidden">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `border-b-2 pt-1 pb-2.5 text-[16px] font-semibold whitespace-nowrap transition-colors duration-150 ${isActive ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        ) : (
          <span />
        )}
        {controls && <div className="flex flex-wrap items-center gap-2 pb-2.5">{controls}</div>}
      </div>
      {children && <div className="mt-3 text-[14px] text-muted">{children}</div>}
    </div>
  );
}

/** A plain title for pages outside an area (the ticker detail, settings). */
export function PageTitle({ title, children, aside, above }: { title: ReactNode; children?: ReactNode; aside?: ReactNode; above?: ReactNode }) {
  return (
    <div className="mb-6">
      {above}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
          {children && <p className="mt-0.5 text-[14px] text-muted">{children}</p>}
        </div>
        {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
      </div>
    </div>
  );
}

/**
 * A titled block within a page. `info` is the explanation of what the block
 * shows, behind an (i) beside the title.
 */
export function Section({ title, count, countLabel, children, aside, className = '', flush, info }: { title?: ReactNode; count?: number; /** What the count counts, e.g. "holdings". */ countLabel?: string; children: ReactNode; aside?: ReactNode; className?: string; flush?: boolean; info?: ReactNode }) {
  return (
    <section className={`${flush ? '' : 'mt-10 first:mt-0'} ${className}`}>
      {(title || aside) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[16px] font-semibold text-ink">
              {title}
              {count !== undefined && <span className="num ml-2 font-medium text-faint">{count}{countLabel ? ` ${countLabel}` : ''}</span>}
            </h2>
            {info && <Info>{info}</Info>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** A circled i. Click it for the explanation; click anywhere else, or press Escape, to close. */
export function Info({ children, label = 'About this' }: { children: ReactNode; label?: string }) {
  return (
    <details className="relative inline-block align-middle" onKeyDown={(e) => { if (e.key === 'Escape') (e.currentTarget as HTMLDetailsElement).open = false; }}>
      <summary
        aria-label={label}
        className="inline-flex size-[18px] cursor-pointer items-center justify-center rounded-full border border-rule-strong/80 text-[11px] leading-none font-semibold text-muted transition-colors hover:border-ink hover:text-ink [details[open]>&]:border-ink [details[open]>&]:bg-ink [details[open]>&]:text-bg"
      >
        i
      </summary>
      <div
        role="note"
        className="absolute left-0 z-20 mt-2 w-80 max-w-[80vw] rounded-md border border-rule-strong/60 bg-surface p-4 text-left text-[14px] leading-relaxed font-normal tracking-normal whitespace-normal text-ink shadow-[0_8px_28px_rgb(10_20_40/0.14)]"
      >
        {children}
      </div>
    </details>
  );
}

/** A row of figures between two rules, divided by hairlines. */
export function StatRow({ children, cols = 4, className = '' }: { children: ReactNode; cols?: 3 | 4 | 5 | 6; className?: string }) {
  const grid = { 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5', 6: 'sm:grid-cols-3 lg:grid-cols-6' }[cols];
  return <dl className={`grid grid-cols-2 border-y border-rule-strong/60 sm:divide-x sm:divide-rule ${grid} ${className}`}>{children}</dl>;
}

/**
 * One figure. `sub` is the same figure another way (the percentage next to
 * its dollars), set in parentheses at the same size and tone.
 */
export function Stat({ label, value, sub, tone = '', size = 'md', info }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: string; size?: 'md' | 'lg'; info?: ReactNode }) {
  const figure = size === 'lg' ? 'text-[28px] leading-8' : 'text-[22px] leading-7';
  return (
    <div className="min-w-0 py-4 pr-4 sm:px-5 sm:first:pl-0">
      <dt className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
        {label}
        {info && <Info>{info}</Info>}
      </dt>
      <dd className={`num mt-1.5 flex flex-wrap items-baseline gap-x-2.5 font-semibold tracking-tight ${figure} ${tone}`}>
        <span>{value}</span>
        {sub && <span className="font-medium">({sub})</span>}
      </dd>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border-y border-rule px-5 py-8 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-prose text-[14px] text-muted">{children}</div>}
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
  'h-9 w-full rounded border border-rule-strong/70 bg-surface px-2.5 text-[14px] text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-loss';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[13px] text-muted">{hint}</span>}
    </label>
  );
}

/**
 * A short line of status under a table or chart: a warning, a link, a count.
 * Not for explanations; those go in `Info`.
 */
export function Note({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`mt-2.5 max-w-prose text-[13px] leading-relaxed text-muted ${className}`}>{children}</p>;
}

/** Two columns on wide screens, stacked below. `split` is the width ratio. */
export function Columns({ children, split = 'even', className = '' }: { children: ReactNode; split?: 'even' | 'wide-left' | 'wide-right'; className?: string }) {
  const cols = { even: 'lg:grid-cols-2', 'wide-left': 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]', 'wide-right': 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' }[split];
  return <div className={`grid grid-cols-1 gap-x-12 gap-y-10 ${cols} ${className}`}>{children}</div>;
}
