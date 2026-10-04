// Small shared pieces. One button shape, one control vocabulary.
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface text-ink border border-rule-strong hover:bg-surface-2',
  ghost: 'text-muted hover:text-ink hover:bg-surface-2',
  danger: 'bg-surface text-loss border border-rule-strong hover:bg-loss-soft',
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
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-[background-color,filter,color] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-rule-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-7 rounded px-2.5 text-xs font-medium transition-colors duration-150 ${
            value === o.value ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ tone = 'warn', title, children, action }: { tone?: 'warn' | 'loss' | 'info'; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const tones = {
    warn: 'bg-warn-soft border-warn/40',
    loss: 'bg-loss-soft border-loss/40',
    info: 'bg-accent-soft border-accent/30',
  };
  const dot = { warn: 'bg-warn', loss: 'bg-loss', info: 'bg-accent' };
  return (
    <div role={tone === 'info' ? 'status' : 'alert'} className={`flex items-start gap-3 rounded-md border px-3.5 py-2.5 ${tones[tone]}`}>
      <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${dot[tone]}`} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{title}</p>
        {children && <div className="mt-0.5 text-[13px] text-ink/80">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function PageTitle({ title, children, aside }: { title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {children && <p className="mt-0.5 text-[13px] text-muted">{children}</p>}
      </div>
      {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
    </div>
  );
}

export function Section({ title, count, children, aside }: { title: string; count?: number; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mt-9 first:mt-0">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">
          {title}
          {count !== undefined && <span className="num ml-2 font-normal text-muted">{count}</span>}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-rule-strong px-5 py-8 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-prose text-[13px] text-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-7 animate-pulse rounded bg-surface-2" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

export function ErrorLine({ error }: { error: Error | null }) {
  if (!error) return null;
  return <Notice tone="loss" title="Could not load this page">{error.message}. Is the server still running?</Notice>;
}

export const inputClass =
  'h-8 w-full rounded-md border border-rule-strong bg-surface px-2.5 text-[13px] text-ink placeholder:text-muted/80 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 aria-[invalid=true]:border-loss';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
