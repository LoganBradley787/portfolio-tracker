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
const LABEL: Record<MovePeriod, string> = { day: 'Day', week: 'Week', month: 'Month' };

/** The holdings behind the latest day's, week's or month's change, in dollars. */
export function WhatMoved() {
  const { data } = useApi<MoversResponse>('/api/movers');
  const [period, setPeriod] = usePersistent<MovePeriod>('movers', 'day');
  const [all, setAll] = useState(false);
  const m = data?.periods[period];
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
      aside={
        <Segmented<MovePeriod>
          label="Period"
          value={period}
          onChange={setPeriod}
          options={(['day', 'week', 'month'] as const).map((p) => ({ value: p, label: LABEL[p] }))}
        />
      }
    >
      <p className="tnum mb-2 text-xs text-muted">
        {span}: <span className={`font-medium ${tone(m.gain)}`}>{money(m.gain, { signed: true })}</span>
        {m.returnPct !== null && <span className={tone(m.gain)}> ({pct(m.returnPct)})</span>}
        {data.asOf !== data.today && period === 'day' && ' · the last day with new prices'}
        {m.incomplete && ' · some prices were missing, so this is understated'}
      </p>
      {shown.length ? (
        <ul className="divide-y divide-rule border-y border-rule-strong/60">
          {shown.map((r) => (
            <li key={r.ticker} className="grid grid-cols-[4.5rem_1fr_auto_auto] items-center gap-x-3 py-[7px] text-[13px]">
              <TickerLink ticker={r.ticker} />
              <GainBar value={r.gain} max={max} className="h-3 w-full" />
              <span className={`num w-20 text-right font-medium ${tone(r.gain)}`}>{money(r.gain, { signed: true })}</span>
              <span className={`num w-16 text-right ${tone(r.gain)}`}>{pct(r.returnPct)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-y border-rule py-2.5 text-[13px] text-muted">Nothing moved over this period.</p>
      )}
      <p className="mt-2 text-xs text-faint">
        Dollar gain over the period, dividends included, money added or taken out not counted.
        {ranked.length > SHOWN && (
          <>
            {' '}
            <button type="button" onClick={() => setAll(!all)} className="font-medium text-accent hover:underline">
              {all ? `Show the ${SHOWN} biggest` : `Show all ${ranked.length}`}
            </button>
          </>
        )}
      </p>
    </Section>
  );
}
