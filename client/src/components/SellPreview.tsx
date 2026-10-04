import { useState } from 'react';
import { previewAccounts, previewSale, type OpenLot, type SalePreview } from '../../../src/engine/sellPreview.ts';
import type { PricePoint } from '../../../src/engine/holdings.ts';
import { ZERO_SHARES, type CostMethod } from '../../../src/engine/types.ts';
import { date, money, shares, tone, when } from '../lib/format.ts';
import { Table } from './Table.tsx';
import { Button, Empty, Section } from './ui.tsx';

interface Input {
  today: string;
  lots: OpenLot[];
  price: PricePoint | null;
  averageCost?: number;
}

export function SellPreview({ input, method }: { input: Input; method: CostMethod }) {
  // null keeps "all" tied to the latest available share count after a refresh.
  const [quantity, setQuantity] = useState<string | null>(null);
  const accounts = previewAccounts(input.lots);
  const [chosenAccount, setChosenAccount] = useState<string | null>(accounts[0]?.account ?? null);
  const account = accounts.find((a) => a.account === chosenAccount) ?? accounts[0];
  const held = account?.shares ?? 0;
  let preview: SalePreview | null = null;
  let error: string | null = null;
  if (held > ZERO_SHARES && input.price) {
    try {
      preview = previewSale({ ...input, account: account?.account, price: input.price.price, shares: quantity === null ? undefined : Number(quantity) });
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const gain = method === 'average' ? preview?.averageGain : preview?.gain;
  return (
    <Section title="If I sold this today">
      <p className="mb-3 text-xs text-muted">Preview only · saves nothing and creates no transactions. Uses today’s lots in the selected accounts.</p>
      {held <= ZERO_SHARES ? <Empty title="No shares held today" /> : !input.price ? (
        <Empty title="No market price available">Load prices to estimate sale proceeds.</Empty>
      ) : (
        <>
          <form className="mb-3 flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
            {accounts.length > 1 && (
              <label className="text-xs text-muted">
                Account to sell from
                <select
                  value={account.account} onChange={(e) => { setChosenAccount(e.target.value); setQuantity(null); }}
                  className="mt-1 block rounded border border-rule-strong bg-surface px-3 py-2 text-sm text-ink"
                >
                  {accounts.map((a) => <option key={a.account} value={a.account}>{a.account || '(no account)'} · {shares(a.shares)} shares</option>)}
                </select>
              </label>
            )}
            <label className="text-xs text-muted">
              Shares to sell
              <input
                type="number" min="0" max={held} step="any" required
                value={quantity ?? String(held)} onChange={(e) => setQuantity(e.target.value)}
                aria-invalid={!!error} aria-describedby="sell-preview-quantity"
                className="num mt-1 block w-44 rounded border border-rule-strong bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
            <Button type="button" size="sm" onClick={() => setQuantity(null)}>All shares</Button>
            <p id="sell-preview-quantity" className={`text-xs ${error ? 'text-loss' : 'text-muted'}`} role={error ? 'alert' : undefined}>
              {error ?? `${shares(held)} held · ${money(input.price.price, { precise: true })} per share · price as of ${when(input.price.asOf)}`}
            </p>
          </form>
          {preview && (
            <>
              <dl className="grid grid-cols-2 gap-x-6 border-y border-rule-strong sm:grid-cols-4">
                {[
                  ['Proceeds', preview.proceeds, false],
                  [method === 'average' ? 'Gain at average cost' : 'Gain (FIFO)', gain, true],
                  ['Short-term gain (FIFO)', preview.shortTerm.gain, true],
                  ['Long-term gain (FIFO)', preview.longTerm.gain, true],
                ].map(([label, value, signed]) => (
                  <div key={label as string} className="py-3">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className={`num mt-1 text-lg font-semibold ${signed ? tone(value as number) : ''}`}>
                      {money(value as number, { signed: signed as boolean })}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="my-2 text-xs text-muted">
                {method === 'average' && `Average cost stays pooled across the selected accounts. Short/long split uses FIFO lots; FIFO gain is ${money(preview.gain, { signed: true })}. `}
                Lots are consumed oldest first within the account being sold. Long-term means held more than one year.
              </p>
              <Table caption="Lots used in sale preview" rows={preview.lots.map((l, i) => ({ ...l, i }))} rowKey={(l) => l.i} columns={[
                { key: 'acquired', label: 'Acquired', render: (l) => <span className="num whitespace-nowrap">{date(l.acquired)}</span> },
                { key: 'account', label: 'Account', render: (l) => l.account || '(no account)' },
                { key: 'shares', label: 'Shares', numeric: true, render: (l) => shares(l.shares) },
                { key: 'cost', label: 'Cost', numeric: true, render: (l) => money(l.cost), className: 'hidden sm:table-cell' },
                { key: 'term', label: 'Term', render: (l) => l.term === 'long' ? 'Long' : 'Short' },
                { key: 'gain', label: 'Gain', numeric: true, render: (l) => <span className={tone(l.gain)}>{money(l.gain, { signed: true })}</span> },
              ]} />
            </>
          )}
        </>
      )}
    </Section>
  );
}
