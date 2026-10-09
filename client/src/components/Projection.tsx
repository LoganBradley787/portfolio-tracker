// Where the portfolio could go: a simulated range from today's value, with the
// assumptions as plain inputs. Any return, any horizon, any target; and for a
// target, when it is likely and what it would take to get there sooner.
import { useMemo } from 'react';
import { monthlyNeeded, project, PROJECTION_VOLATILITY, returnNeeded, TARGET_HORIZON, yearsToTarget, type Pace } from '../../../src/engine/projection.ts';
import { money, pct } from '../lib/format.ts';
import { usePersistent } from '../lib/usePersistentRange.ts';
import { axisMoney, FanChart } from './charts.tsx';
import { Table } from './Table.tsx';
import { Field, inputClass, Section, Segmented, Stat, StatRow } from './ui.tsx';

interface Saved {
  /** Null follows the recent pace. */
  monthly: number | null;
  /** Years ahead, 1 to 60. Older saves held a string. */
  years: number | string;
  /** Average yearly return as a fraction. Older saves held `realReturn` as a string. */
  returnRate?: number;
  realReturn?: string;
  /** Whether the return is quoted after inflation (today's dollars) or before it. */
  inflation: 'after' | 'before';
  target: number | null;
}

const MAX_YEARS = 60;

const amount = (text: string): number | null => {
  const n = Number(text.replace(/[$,\s]/g, ''));
  return text.trim() !== '' && Number.isFinite(n) ? n : null;
};

/** "7" or "7.5%" → 0.075; anything else is null. */
const percent = (text: string): number | null => {
  const n = Number(text.replace(/[%\s]/g, ''));
  return text.trim() !== '' && Number.isFinite(n) ? n / 100 : null;
};

const clampYears = (n: number) => Math.min(MAX_YEARS, Math.max(1, Math.round(n)));

/** 0.075 → "7.5%": a rate as typed, without trailing zeros. */
const rateText = (r: number) => `${+(r * 100).toFixed(2)}%`;

/** The range of values the portfolio could reach, from today's value and a monthly amount. */
export function Projection({ value, pace, today }: { value: number; pace: Pace; today: string }) {
  const [saved, setSaved] = usePersistent<Saved>('outlookProjection', { monthly: null, years: 20, returnRate: 0.05, inflation: 'after', target: null });
  const fromPace = Math.max(0, Math.round(pace.monthly));
  const monthly = saved.monthly ?? fromPace;
  const years = clampYears(Number(saved.years) || 20);
  const rate = saved.returnRate ?? Number(saved.realReturn ?? 0.05);
  const after = saved.inflation !== 'before';
  const target = saved.target && saved.target > 0 ? saved.target : null;

  const result = useMemo(
    () => project({ value, monthly, years, realReturn: rate, volatility: PROJECTION_VOLATILITY, target }),
    [value, monthly, years, rate, target],
  );
  // For a target: the likely year looking far ahead, and what reaching it by the chosen year would take.
  const reach = useMemo(() => {
    if (!target) return null;
    return {
      likelyYear: yearsToTarget({ value, monthly, realReturn: rate, volatility: PROJECTION_VOLATILITY, target }),
      monthly: monthlyNeeded(value, target, years, rate),
      rate: returnNeeded(value, monthly, target, years),
    };
  }, [value, monthly, years, rate, target]);

  const year = (n: number) => Number(today.slice(0, 4)) + n;
  const end = result.years[result.years.length - 1];
  const whole = (v: number) => money(v, { whole: true });
  const checkpoints = result.years.filter((y) => y.year % 5 === 0 || y.year === years);
  const dollars = after ? 'today’s dollars' : 'future dollars';

  return (
    <Section
      title="Where this could go"
      info={`A range, not a forecast. It assumes returns average ${rateText(rate)} a year ${after ? 'after inflation, so every figure is in today’s dollars' : 'before inflation, so the figures are in the dollars of each future year'}, swing by about ${Math.round(PROJECTION_VOLATILITY * 100)}% a year, roughly how a stock-heavy portfolio has behaved over long periods, and that the monthly amount never changes. It is 2,000 simulated paths from the selected accounts’ value today; your own holdings, taxes and fees are not modelled. Reaching a target: the likely year is when half the paths are past it, looking up to ${TARGET_HORIZON} years out; the amount and return needed assume the average return arrives every year, with no swings.`}
    >
      <div className="mb-6 grid max-w-5xl grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,1fr)_minmax(0,1fr)]">
        <Field
          label="Added each month"
          hint={saved.monthly === null
            ? pace.months
              ? `Your pace over the last ${pace.months} complete month${pace.months > 1 ? 's' : ''}${pace.monthly < 0 ? ' (more was sold than bought, so 0 is used)' : ''}.`
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
            <button type="button" onClick={() => setSaved({ ...saved, monthly: null })} className="mt-1 block text-[13px] font-medium text-accent hover:underline">
              Use my pace ({whole(fromPace)} a month)
            </button>
          )}
        </Field>
        <Field label="Average yearly return" hint="Any number. Long-run stock markets have averaged about 7% before inflation, 5% after.">
          <input
            className={`${inputClass} num`}
            inputMode="decimal"
            aria-label="Average yearly return, percent"
            defaultValue={(rate * 100).toString()}
            onBlur={(e) => {
              const r = percent(e.target.value);
              if (r !== null) setSaved({ ...saved, returnRate: Math.min(1, Math.max(-0.5, r)) });
              else e.target.value = (rate * 100).toString();
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
        </Field>
        <div>
          <span className="mb-1 block text-[13px] font-semibold text-muted">That return is</span>
          <Segmented<Saved['inflation']>
            label="Inflation"
            size="md"
            value={after ? 'after' : 'before'}
            onChange={(v) => setSaved({ ...saved, inflation: v })}
            options={[{ value: 'after', label: 'After inflation' }, { value: 'before', label: 'Before inflation' }]}
          />
          <span className="mt-1 block text-[13px] text-muted">{after ? 'Figures are in today’s dollars.' : 'Figures are in future dollars.'}</span>
        </div>
        <Field label="Years ahead" hint={`1 to ${MAX_YEARS}.`}>
          <input
            className={`${inputClass} num`}
            type="number"
            min={1}
            max={MAX_YEARS}
            aria-label="Years ahead"
            value={years}
            onChange={(e) => setSaved({ ...saved, years: clampYears(Number(e.target.value) || 1) })}
          />
        </Field>
        <Field label="Target (optional)" hint={`A value to reach, in ${dollars}.`}>
          <input
            className={`${inputClass} num`}
            inputMode="decimal"
            aria-label="Target value"
            placeholder="1,000,000"
            value={saved.target ?? ''}
            onChange={(e) => setSaved({ ...saved, target: amount(e.target.value) })}
          />
        </Field>
      </div>

      <StatRow cols={4} className="mb-6">
        <Stat label={`Middle outcome in ${year(years)}`} value={whole(end.p50)} info="Half of the simulated outcomes end higher than this, half lower." />
        <Stat label="8 in 10 outcomes" value={`${whole(end.p10)} – ${whole(end.p90)}`} info="One outcome in ten falls below this range and one in ten rises above it." />
        <Stat label="Money put in by then" value={whole(end.contributed)} info={`Today’s ${whole(value)} plus ${whole(monthly)} a month, in ${dollars}.`} />
        <Stat label="Today" value={whole(value)} />
      </StatRow>

      {target && reach && (
        <StatRow cols={4} className="mb-6">
          <Stat
            label={`Reaching ${whole(target)}`}
            value={reach.likelyYear ? `Around ${year(reach.likelyYear)}` : `Not within ${TARGET_HORIZON} years`}
            sub={reach.likelyYear ? `${reach.likelyYear} year${reach.likelyYear > 1 ? 's' : ''}` : undefined}
            info={`The first year in which half of the simulated outcomes are past the target, looking up to ${TARGET_HORIZON} years ahead at ${whole(monthly)} a month.`}
          />
          <Stat label={`Odds by ${year(years)}`} value={pct(end.reached, { signed: false })} info={`The share of simulated outcomes at or above the target in ${year(years)}.`} />
          <Stat
            label={`Needed each month to get there by ${year(years)}`}
            value={reach.monthly <= 0 ? 'None needed' : whole(reach.monthly)}
            sub={reach.monthly > monthly ? `${whole(reach.monthly - monthly)} more` : reach.monthly > 0 ? 'on track' : undefined}
            info={`The monthly amount that reaches the target by ${year(years)} if returns average ${rateText(rate)} every year with no swings. Compare with the ${whole(monthly)} a month above.`}
          />
          <Stat
            label={`Return needed at ${whole(monthly)} a month`}
            value={reach.rate === null ? 'More than 100% a year' : reach.rate <= 0 ? 'None needed' : `${rateText(reach.rate)} a year`}
            info={`The average yearly return at which ${whole(monthly)} a month reaches the target by ${year(years)}, with no swings.`}
          />
        </StatRow>
      )}

      <FanChart
        label={`Range of projected values over ${years} years`}
        rows={[
          { label: String(year(0)), low: value, midLow: value, mid: value, midHigh: value, high: value, base: value },
          ...result.years.map((y) => ({ label: String(year(y.year)), low: y.p10, midLow: y.p25, mid: y.p50, midHigh: y.p75, high: y.p90, base: y.contributed })),
        ]}
        yFormat={axisMoney}
        format={whole}
        target={target}
        names={{ mid: 'Middle outcome', inner: 'Half of outcomes', outer: '8 in 10 outcomes', base: 'Money put in', target: 'Target' }}
      />

      <div className="mt-6 max-w-2xl">
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
            ...(target ? [{ key: 'reach', label: 'Reaches target', numeric: true, render: (y: (typeof checkpoints)[number]) => pct(y.reached, { signed: false }) }] : []),
          ]}
        />
      </div>
    </Section>
  );
}
