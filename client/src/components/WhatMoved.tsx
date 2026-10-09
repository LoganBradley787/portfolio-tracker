import { useState } from 'react';
import type { MovePeriod, Movement } from '../../../src/engine/movers.ts';
import { date, money, pct, tone } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { usePersistent } from '../lib/usePersistentRange.ts';
import { GainBar } from './charts.tsx';
import { TickerLink } from './TickerLink.tsx';
import { Section, Segmented } from './ui.tsx';

interface MoversResponse {
  today: string;
  asOf: string | null;
  periods: Record<MovePeriod, Movement | null>;
}

const SHOWN = 8;
const PERIODS: MovePeriod[] = ['day', 'week', 'month', 'year', 'all'];
const LABEL: Record<MovePeriod, string> = { day: 'Day', week: 'Week', month: 'Month', year: 'Year', all: 'All' };

/** The holdings behind the latest day's, week's, month's, year's or all-time change, in dollars. */
export function WhatMoved() {
  const { data } = useApi<MoversResponse>('/api/movers');
  const [period, setPeriod] = usePersistent<MovePeriod>('movers', 'day');
  const [all, setAll] = useState(false);
  // An older server may not know every period; fall back rather than vanish.
  const known = PERIODS.filter((p) => data?.periods[p]);
  const shown_ = known.includes(period) ? period : known[0];
  const m = shown_ ? data?.periods[shown_] : null;
  if (!data || !m) return null;

  // The biggest moves either way; the rest are a click away.
  const ranked = [...m.movers].sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain));
  const shown = (all ? ranked : ranked.slice(0, SHOWN)).sort((a, b) => b.gain - a.gain);
  const max = Math.max(...ranked.map((r) => Math.abs(r.gain)), 1e-9);
  const span = m.from === m.to ? date(m.to) : `${date(m.from)} – ${date(m.to)}`;
  return (
    <Section
      flush
      title="What moved"
      info={
        <>
          Each holding’s dollar gain over the period, dividends included. Money added or taken out is not counted as movement.
          {data.asOf !== data.today && ' The day is the last one with new prices.'}
          {m.incomplete && ' Some prices were missing in this period, so the figures are understated.'}
        </>
      }
      aside={<Segmented<MovePeriod> label="Period" value={shown_} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: LABEL[p] }))} />}
    >
      <p className="tnum mb-3 flex flex-wrap items-baseline gap-x-3 text-[14px]" data-testid="movers-headline">
        <span className={`text-[20px] font-semibold ${tone(m.gain)}`}>
          {money(m.gain, { signed: true })}
          {m.returnPct !== null && <span className="ml-2 font-medium">({pct(m.returnPct)})</span>}
        </span>
        <span className="text-muted">{span}</span>
      </p>
      {shown.length ? (
        <ul className="divide-y divide-rule border-y border-rule-strong/60">
          {shown.map((r) => (
            <li key={r.ticker} className="grid grid-cols-[4.5rem_1fr_auto_auto] items-center gap-x-3 py-2 text-[14px]">
              <TickerLink ticker={r.ticker} />
              <GainBar value={r.gain} max={max} className="h-3.5 w-full" />
              <span className={`num w-24 text-right font-semibold ${tone(r.gain)}`}>{money(r.gain, { signed: true })}</span>
              <span className={`num w-20 text-right ${tone(r.gain)}`}>{pct(r.returnPct)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-y border-rule py-3 text-[14px] text-muted">Nothing moved over this period.</p>
      )}
      {ranked.length > SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2.5 text-[13px] font-semibold text-accent hover:underline">
          {all ? `Show the ${SHOWN} biggest` : `Show all ${ranked.length}`}
        </button>
      )}
    </Section>
  );
}
