import type { SoonLot } from '../../../src/engine/sellPreview.ts';
import { date, money, shares, tone } from '../lib/format.ts';
import { Table } from './Table.tsx';
import { TickerLink } from './TickerLink.tsx';
import { Empty, Section } from './ui.tsx';

export function TurningLongTermSoon({ lots }: { lots: SoonLot[] }) {
  return (
    <Section title="Turning long-term soon" count={lots.length}>
      <p className="mb-3 text-xs text-muted">
        Open FIFO lots in the selected accounts, including reinvested dividends. Dates show the first day
        held more than one year, within the next 60 days. Reinvested lots are grouped by ticker and account. Gains use the latest stored prices.
      </p>
      {lots.length ? <Table caption="Lots turning long-term within 60 days" rows={lots.map((l, i) => ({ ...l, i }))} rowKey={(l) => l.i} columns={[
        { key: 'date', label: 'Long-term from', render: (l) => <span className="num whitespace-nowrap">{date(l.longTermDate)}{l.lastLongTermDate && l.lastLongTermDate !== l.longTermDate ? ` – ${date(l.lastLongTermDate)}` : ''}</span> },
        { key: 'ticker', label: 'Ticker', render: (l) => <TickerLink ticker={l.ticker} /> },
        { key: 'account', label: 'Account', render: (l) => l.account || '(no account)' },
        { key: 'acquired', label: 'Lots', render: (l) => l.reinvestedLots ? `${l.reinvestedLots} reinvested ${l.reinvestedLots === 1 ? 'lot' : 'lots'}` : <span className="num">{date(l.acquired)}</span> },
        { key: 'shares', label: 'Shares', numeric: true, render: (l) => shares(l.shares) },
        { key: 'gain', label: 'Unrealized gain', numeric: true, render: (l) => l.gain === null ? <span className="text-muted">No price</span> : <span className={tone(l.gain)}>{money(l.gain, { signed: true })}</span> },
      ]} /> : <Empty title="No lots cross into long-term in the next 60 days" />}
    </Section>
  );
}
