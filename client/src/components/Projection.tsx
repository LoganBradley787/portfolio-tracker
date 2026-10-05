import { useMemo } from 'react';
import { project, PROJECTION_VOLATILITY, type Pace } from '../../../src/engine/projection.ts';
import { money, pct } from '../lib/format.ts';
import { usePersistent } from '../lib/usePersistentRange.ts';
import { axisMoney, FanChart } from './charts.tsx';
import { Table } from './Table.tsx';
import { Field, inputClass, Section, Segmented } from './ui.tsx';

interface Saved {
  /** Null follows the recent pace. */
  monthly: number | null;
  years: '10' | '20' | '30';
  realReturn: '0.03' | '0.05' | '0.07';
  target: number | null;
}

const amount = (text: string): number | null => {
  const n = Number(text.replace(/[$,\s]/g, ''));
  return text.trim() !== '' && Number.isFinite(n) ? n : null;
};

/** The range of values the portfolio could reach, from today's value and a monthly amount. */
export function Projection({ value, pace, today }: { value: number; pace: Pace; today: string }) {
  const [saved, setSaved] = usePersistent<Saved>('outlookProjection', { monthly: null, years: '20', realReturn: '0.05', target: null });
  const fromPace = Math.max(0, Math.round(pace.monthly));
  const monthly = saved.monthly ?? fromPace;
  const years = Number(saved.years);
  const realReturn = Number(saved.realReturn);
  const result = useMemo(
    () => project({ value, monthly, years, realReturn, volatility: PROJECTION_VOLATILITY, target: saved.target }),
    [value, monthly, years, realReturn, saved.target],
  );
  const year = (n: number) => Number(today.slice(0, 4)) + n;
  const end = result.years[result.years.length - 1];
  const whole = (v: number) => money(v, { whole: true });
  const checkpoints = result.years.filter((y) => y.year % 5 === 0);

  return (
    <Section
      title="Where this could go"
      aside={
        <Segmented<Saved['years']>
          label="Years ahead"
          value={saved.years}
          onChange={(v) => setSaved({ ...saved, years: v })}
          options={[{ value: '10', label: '10 years' }, { value: '20', label: '20 years' }, { value: '30', label: '30 years' }]}
        />
      }
    >
      <div className="mb-4 grid max-w-3xl grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Field
          label="Added each month"
          hint={saved.monthly === null
            ? pace.months
              ? `Your pace: net money added over the last ${pace.months} complete month${pace.months > 1 ? 's' : ''}${pace.monthly < 0 ? ' (more was sold than bought, so 0 is used)' : ''}.`
              : 'No complete month of history yet.'
            : undefined}
        >
          <input
            className={`${inputClass} num`}
            inputMode="decimal"
            aria-label="Amount added each month"
            value={saved.monthly ?? fromPace}
            onChange={(e) => setSaved({ ...saved, monthly: amount(e.target.value) })}
          />
          {saved.monthly !== null && (
            <button type="button" onClick={() => setSaved({ ...saved, monthly: null })} className="mt-1 block text-xs font-medium text-accent hover:underline">
              Use my pace ({whole(fromPace)} a month)
            </button>
          )}
        </Field>
        <Field label="Target (optional)" hint="A value to reach, in today’s dollars.">
          <input
            className={`${inputClass} num`}
            inputMode="decimal"
            aria-label="Target value"
            placeholder="1,000,000"
            value={saved.target ?? ''}
            onChange={(e) => setSaved({ ...saved, target: amount(e.target.value) })}
          />
        </Field>
        <div>
          <span className="mb-1 block text-xs font-medium text-muted">Average yearly return, after inflation</span>
          <Segmented<Saved['realReturn']>
            label="Average yearly return after inflation"
            value={saved.realReturn}
            onChange={(v) => setSaved({ ...saved, realReturn: v })}
            options={[{ value: '0.03', label: '3%' }, { value: '0.05', label: '5%' }, { value: '0.07', label: '7%' }]}
          />
        </div>
      </div>

      <dl className="mb-4 grid grid-cols-2 gap-x-6 border-y border-rule-strong sm:grid-cols-4">
        {[
          [`Middle outcome in ${year(years)}`, whole(end.p50), 'half of outcomes are higher'],
          ['8 in 10 outcomes', `${whole(end.p10)} – ${whole(end.p90)}`, 'one in ten falls below, one in ten above'],
          ['Money put in by then', whole(end.contributed), `today’s ${whole(value)} plus ${whole(monthly)} a month`],
          saved.target
            ? [
                `Reaching ${whole(saved.target)}`,
                result.targetYear ? `Around ${year(result.targetYear)}` : `Not by ${year(years)}`,
                `${pct(end.reached, { signed: false })} of outcomes get there by ${year(years)}`,
              ]
            : ['Today', whole(value), 'the starting value'],
        ].map(([k, v, sub]) => (
          <div key={k} className="min-w-0 py-3">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="num mt-0.5 text-lg leading-7 font-semibold tracking-tight">{v}</dd>
            <dd className="text-xs text-muted">{sub}</dd>
          </div>
        ))}
      </dl>

      <FanChart
        label={`Range of projected values over ${years} years`}
        rows={[
          { label: String(year(0)), low: value, midLow: value, mid: value, midHigh: value, high: value, base: value },
          ...result.years.map((y) => ({ label: String(year(y.year)), low: y.p10, midLow: y.p25, mid: y.p50, midHigh: y.p75, high: y.p90, base: y.contributed })),
        ]}
        yFormat={axisMoney}
        format={whole}
        target={saved.target}
        names={{ mid: 'Middle outcome', inner: 'Half of outcomes', outer: '8 in 10 outcomes', base: 'Money put in', target: 'Target' }}
      />

      <div className="mt-4">
        <Table
          caption="Projected values every five years"
          rows={checkpoints}
          rowKey={(y) => y.year}
          columns={[
            { key: 'year', label: 'Year', render: (y) => <span className="num">{year(y.year)}</span> },
            { key: 'low', label: 'Low (1 in 10 below)', numeric: true, render: (y) => whole(y.p10) },
            { key: 'mid', label: 'Middle', numeric: true, render: (y) => <span className="font-semibold">{whole(y.p50)}</span> },
            { key: 'high', label: 'High (1 in 10 above)', numeric: true, render: (y) => whole(y.p90) },
            { key: 'in', label: 'Money put in', numeric: true, render: (y) => whole(y.contributed), className: 'hidden sm:table-cell' },
            ...(saved.target ? [{ key: 'reach', label: 'Reaches target', numeric: true, render: (y: (typeof checkpoints)[number]) => pct(y.reached, { signed: false }) }] : []),
          ]}
        />
      </div>
      <p className="mt-2 max-w-prose text-xs text-muted">
        A range, not a forecast. Everything is in today’s dollars. It assumes returns average {Math.round(realReturn * 100)}% a year
        after inflation and swing by about {Math.round(PROJECTION_VOLATILITY * 100)}% a year, roughly how a stock-heavy
        portfolio has behaved over long periods, and that the monthly amount never changes. It is 2,000 simulated paths from
        the selected accounts’ value today; your own holdings, taxes and fees are not modelled.
      </p>
    </Section>
  );
}
