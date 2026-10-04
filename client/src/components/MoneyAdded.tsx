import { useState } from 'react';
import type { MoneyAdded as Breakdown } from '../../../src/engine/moneyAdded.ts';
import { money, tone } from '../lib/format.ts';
import { Table } from './Table.tsx';
import { Empty, Section, Segmented } from './ui.tsx';

export function MoneyAdded({ data }: { data: Breakdown }) {
  const [period, setPeriod] = useState<'years' | 'months'>('years');
  return (
    <Section title="Money added over time" aside={(
      <Segmented label="Money added period" value={period} onChange={setPeriod} options={[
        { value: 'years', label: 'Yearly' }, { value: 'months', label: 'Monthly' },
      ]} />
    )}>
      <p className="mb-3 text-xs text-muted">
        All history through today, for the selected accounts. Buys minus sells measures money invested
        in securities. Reinvested dividends are excluded from buys; sale proceeds include reinvested shares.
        Growth is today’s value minus net money added, including reinvested dividends. This is not remaining cost basis.
      </p>
      <dl className="mb-3 grid grid-cols-3 gap-x-6 border-y border-rule-strong">
        {[
          ['Today’s value', data.value, false], ['Net money added', data.added, false], ['Growth', data.growth, true],
        ].map(([label, value, signed]) => (
          <div key={label as string} className="py-3">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className={`num mt-1 text-lg font-semibold ${signed ? tone(value as number) : ''}`}>
              {money(value as number, { signed: signed as boolean })}
            </dd>
          </div>
        ))}
      </dl>
      {data[period].length ? <Table caption={`${period === 'years' ? 'Yearly' : 'Monthly'} money added`} rows={[...data[period]].reverse()} rowKey={(r) => r.period} showTotals columns={[
        { key: 'period', label: period === 'years' ? 'Year' : 'Month', render: (r) => <span className="num">{r.period}</span>, total: 'Total' },
        { key: 'buys', label: 'Buys', numeric: true, render: (r) => money(r.buys), total: money(data.years.reduce((a, r) => a + r.buys, 0)) },
        { key: 'sells', label: 'Sells', numeric: true, render: (r) => money(r.sells), total: money(data.years.reduce((a, r) => a + r.sells, 0)) },
        { key: 'net', label: 'Money added', numeric: true, render: (r) => money(r.net, { signed: true }), total: money(data.added, { signed: true }) },
      ]} /> : <Empty title="No money added yet" />}
    </Section>
  );
}
