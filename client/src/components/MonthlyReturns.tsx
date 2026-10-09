import type { MonthReturn } from '../../../src/engine/returns.ts';
import { pct, tone } from '../lib/format.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** What the cell covers, for the tooltip and screen readers. */
function describe(m: MonthReturn | undefined): string {
  if (!m) return 'Outside the selected range';
  const notes = [
    m.partial && 'partial month',
    m.incomplete ? 'missing prices' : m.return === null && 'no invested days',
  ].filter(Boolean);
  return [`${m.from} to ${m.to}`, ...notes].join(' · ');
}

function wash(r: number | null | undefined): string {
  if (r == null || r === 0) return '';
  return r > 0 ? 'bg-gain-soft' : 'bg-loss-soft';
}

/**
 * A year-by-month grid of returns. With `compare`, each cell is the month's
 * return minus the benchmark's return for that month (null where unknown).
 */
export function MonthlyReturns({ months, compare }: { months: MonthReturn[]; compare?: Map<string, number | null> }) {
  const years = [...new Set(months.map((m) => m.month.slice(0, 4)))].reverse();
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const cell = (m: MonthReturn | undefined): number | null | undefined => {
    if (!m || m.return == null) return m?.return;
    if (!compare) return m.return;
    const b = compare.get(m.month);
    return b == null ? null : m.return - b;
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <caption className="sr-only">{compare ? 'Monthly return against the benchmark' : 'Monthly time-weighted returns within the selected range'}</caption>
        <thead>
          <tr className="border-b border-rule-strong/70 text-muted">
            <th scope="col" className="px-2 pt-1 pb-2 text-left text-[13px] font-semibold">Year</th>
            {MONTHS.map((m) => (
              <th key={m} scope="col" className="px-2 pt-1 pb-2 text-right text-[13px] font-semibold">{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map((year) => (
            <tr key={year} className="border-b border-rule last:border-0">
              <th scope="row" className="num px-2 py-3 text-left font-semibold">{year}</th>
              {MONTHS.map((name, i) => {
                const m = byMonth.get(`${year}-${String(i + 1).padStart(2, '0')}`);
                const v = cell(m);
                const description = describe(m);
                const value = v == null ? 'unavailable' : pct(v);
                return (
                  <td
                    key={name}
                    title={description}
                    aria-label={`${name} ${year}: ${value}. ${description}`}
                    className={`num px-2 py-3 text-right font-medium ${tone(v)} ${wash(v)}`}
                  >
                    <span className={m?.partial ? 'underline decoration-dotted decoration-1 underline-offset-4' : ''}>{pct(v)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
