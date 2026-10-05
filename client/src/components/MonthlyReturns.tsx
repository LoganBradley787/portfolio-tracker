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

export function MonthlyReturns({ months }: { months: MonthReturn[] }) {
  const years = [...new Set(months.map((m) => m.month.slice(0, 4)))].reverse();
  const byMonth = new Map(months.map((m) => [m.month, m]));
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <caption className="sr-only">Monthly time-weighted returns within the selected range</caption>
          <thead>
            <tr className="border-b border-rule-strong/70 text-muted">
              <th scope="col" className="px-2 pt-1 pb-1.5 text-left text-xs font-medium">Year</th>
              {MONTHS.map((m) => (
                <th key={m} scope="col" className="px-2 pt-1 pb-1.5 text-right text-xs font-medium">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((year) => (
              <tr key={year} className="border-b border-rule last:border-0">
                <th scope="row" className="num px-2 py-2.5 text-left font-medium">{year}</th>
                {MONTHS.map((name, i) => {
                  const m = byMonth.get(`${year}-${String(i + 1).padStart(2, '0')}`);
                  const description = describe(m);
                  const value = m?.return == null ? 'unavailable' : pct(m.return);
                  return (
                    <td
                      key={name}
                      title={description}
                      aria-label={`${name} ${year}: ${value}. ${description}`}
                      className={`num px-2 py-2.5 text-right ${tone(m?.return)} ${wash(m?.return)}`}
                    >
                      {pct(m?.return)}
                      {m?.partial && <span className="text-muted">*</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted">
        Compounded daily time-weighted returns, including dividends. * Partial month within the selected range or since the first trade.
        Missing prices and months without invested days show a dash.
      </p>
    </>
  );
}
