import { TickerLink } from '../components/TickerLink.tsx';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Transaction } from '../../../src/engine/types.ts';
import type { ImportResult } from '../../../src/import/parse.ts';
import { Table, type Column } from '../components/Table.tsx';
import { Button, Empty, ErrorLine, Field, inputClass, Notice, PageHeader, Segmented, Skeleton } from '../components/ui.tsx';
import { DATA_TABS } from '../lib/areas.ts';
import { api, ApiError } from '../lib/api.ts';
import { date, money, shares } from '../lib/format.ts';
import { useRefresh } from '../lib/refresh.tsx';
import { useApi } from '../lib/useApi.ts';
import { useAccount } from '../lib/account.tsx';

type Row = Transaction & { assetType: 'Stock' | 'ETF' };
interface ListResponse {
  transactions: Row[];
  accounts: string[];
}

type Panel = { kind: 'none' } | { kind: 'form'; editing: Row | null } | { kind: 'import' };

export default function Transactions() {
  const { data, error, reload } = useApi<ListResponse>('/api/transactions');
  const { bump, poke } = useRefresh();
  const { selected } = useAccount();
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });
  const [flash, setFlash] = useState<string | null>(null);

  const changed = async (message?: string) => {
    await reload();
    bump();
    poke();
    if (message) setFlash(message);
  };

  // Newest date first; within a date, ledger order (seq) so "up" means earlier.
  const ordered = useMemo(
    () => [...(data?.transactions ?? [])].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.seq - b.seq)),
    [data],
  );
  const neighbours = useMemo(() => {
    const m = new Map<number, { up: boolean; down: boolean }>();
    ordered.forEach((t, i) => m.set(t.id, { up: ordered[i - 1]?.date === t.date, down: ordered[i + 1]?.date === t.date }));
    return m;
  }, [ordered]);
  const rows = selected !== null ? ordered.filter((t) => selected.includes(t.account)) : ordered;

  const move = async (t: Row, direction: 'up' | 'down') => {
    await api('/api/transactions/reorder', { method: 'POST', body: { id: t.id, direction } });
    await changed();
  };

  return (
    <div>
      <PageHeader
        tabs={DATA_TABS}
        controls={
          <>
            <a
              href="/api/export.csv"
              download
              className="inline-flex h-7 items-center rounded border border-rule-strong/70 bg-surface px-2 text-[13px] font-medium text-ink hover:bg-surface-2/60"
            >
              Export CSV
            </a>
            <Button size="sm" onClick={() => setPanel(panel.kind === 'import' ? { kind: 'none' } : { kind: 'import' })} aria-expanded={panel.kind === 'import'}>
              Import
            </Button>
            <Button size="sm" variant="primary" onClick={() => setPanel({ kind: 'form', editing: null })}>
              Add transaction
            </Button>
          </>
        }
      >
        Buys and sells as traded, before any later split. Same-day order matters for average cost; use the arrows to fix it.
      </PageHeader>

      {flash && (
        <div className="mb-4">
          <Notice tone="info" title={flash} action={<Button size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</Button>} />
        </div>
      )}

      {panel.kind === 'form' && (
        <TransactionForm
          key={panel.editing?.id ?? 'new'}
          editing={panel.editing}
          accounts={data?.accounts ?? []}
          onClose={() => setPanel({ kind: 'none' })}
          onSaved={async (msg) => {
            setPanel({ kind: 'none' });
            await changed(msg);
          }}
        />
      )}
      {panel.kind === 'import' && (
        <ImportPanel
          hasRows={(data?.transactions.length ?? 0) > 0}
          onClose={() => setPanel({ kind: 'none' })}
          onImported={async (msg) => {
            setPanel({ kind: 'none' });
            await changed(msg);
          }}
        />
      )}

      <ErrorLine error={error && !data ? error : null} />
      {!data ? (
        !error && <Skeleton rows={10} />
      ) : data.transactions.length === 0 ? (
        panel.kind === 'none' && (
          <Empty title="No transactions yet">
            Select the Transactions tab in the Google Sheet (header row included), copy, and paste it into Import. Or add trades one at a time.
          </Empty>
        )
      ) : (
        <>
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <p className="tnum text-[13px] text-muted">
              {rows.length === data.transactions.length ? `${rows.length} transactions` : `${rows.length} of ${data.transactions.length} transactions`}
            </p>
          </div>
          <TransactionTable
            rows={rows}
            neighbours={neighbours}
            editingId={panel.kind === 'form' ? panel.editing?.id : undefined}
            onEdit={(t) => {
              setPanel({ kind: 'form', editing: t });
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onMove={move}
            onDelete={async (t) => {
              await api(`/api/transactions/${t.id}`, { method: 'DELETE' });
              await changed(`Deleted ${t.type.toLowerCase()} of ${shares(t.shares)} ${t.ticker} on ${date(t.date)}.`);
            }}
          />
        </>
      )}
    </div>
  );
}

function TransactionTable({
  rows,
  neighbours,
  editingId,
  onEdit,
  onMove,
  onDelete,
}: {
  rows: Row[];
  neighbours: Map<number, { up: boolean; down: boolean }>;
  editingId?: number;
  onEdit: (t: Row) => void;
  onMove: (t: Row, d: 'up' | 'down') => void;
  onDelete: (t: Row) => void;
}) {
  const [confirming, setConfirming] = useState<number | null>(null);
  useEffect(() => {
    if (confirming === null) return;
    const id = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(id);
  }, [confirming]);

  const columns: Column<Row>[] = [
    { key: 'date', label: 'Date', render: (t) => <span className="num whitespace-nowrap">{date(t.date)}</span> },
    {
      key: 'ticker',
      label: 'Ticker',
      render: (t) => (
        <span className="whitespace-nowrap">
          <TickerLink ticker={t.ticker} />
          {t.assetType === 'ETF' && <span className="ml-1.5 text-[12px] font-medium text-muted">ETF</span>}
        </span>
      ),
    },
    { key: 'type', label: 'Type', render: (t) => <span className={t.type === 'Sell' ? 'font-medium' : 'text-muted'}>{t.type}</span> },
    { key: 'shares', label: 'Shares', numeric: true, render: (t) => shares(t.shares) },
    { key: 'price', label: 'Price', numeric: true, render: (t) => money(t.price, { precise: true, asIs: true }) },
    { key: 'amount', label: 'Amount', numeric: true, render: (t) => money(t.shares * t.price), className: 'hidden md:table-cell' },
    { key: 'account', label: 'Account', render: (t) => <span className="text-muted">{t.account || '—'}</span>, className: 'hidden sm:table-cell' },
    { key: 'note', label: 'Note', render: (t) => <span className="block max-w-[16rem] truncate text-muted" title={t.note}>{t.note}</span>, className: 'hidden xl:table-cell' },
    {
      key: 'actions',
      label: <span className="sr-only">Actions</span>,
      render: (t) => {
        const n = neighbours.get(t.id) ?? { up: false, down: false };
        return (
          <span className="flex items-center justify-end gap-0.5 whitespace-nowrap">
            {(n.up || n.down) && (
              <>
                <Button size="sm" variant="ghost" disabled={!n.up} onClick={() => onMove(t, 'up')} aria-label={`Move ${t.ticker} ${t.type} earlier in the day`} title="Earlier in the day">
                  ↑
                </Button>
                <Button size="sm" variant="ghost" disabled={!n.down} onClick={() => onMove(t, 'down')} aria-label={`Move ${t.ticker} ${t.type} later in the day`} title="Later in the day">
                  ↓
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => onEdit(t)}>
              Edit
            </Button>
            {confirming === t.id ? (
              <Button size="sm" variant="danger" onClick={() => onDelete(t)}>
                Confirm
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(t.id)} aria-label={`Delete ${t.ticker} ${t.type} on ${t.date}`}>
                Delete
              </Button>
            )}
          </span>
        );
      },
    },
  ];
  return <Table caption="Transactions" rows={rows} columns={columns} rowKey={(t) => t.id} rowClassName={(t) => (t.id === editingId ? 'bg-accent-soft/50' : '')} />;
}

function TransactionForm({
  editing,
  accounts,
  onClose,
  onSaved,
}: {
  editing: Row | null;
  accounts: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { selected } = useAccount();
  const [form, setForm] = useState({
    ticker: editing?.ticker ?? '',
    type: editing?.type ?? 'Buy',
    shares: editing ? String(editing.shares) : '',
    price: editing ? String(editing.price) : '',
    date: editing?.date ?? new Date().toLocaleDateString('en-CA'),
    account: editing?.account ?? selected?.[0] ?? accounts[0] ?? '',
    assetType: editing?.assetType ?? 'Stock',
    note: editing?.note ?? '',
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      const body = { ...form };
      if (editing) await api(`/api/transactions/${editing.id}`, { method: 'PUT', body });
      else await api('/api/transactions', { method: 'POST', body });
      onSaved(`${editing ? 'Saved' : 'Added'} ${form.type.toLowerCase()} of ${form.shares} ${form.ticker.toUpperCase()} on ${date(form.date)}.`);
    } catch (err) {
      setErrors(err instanceof ApiError && err.body?.errors ? err.body.errors : [(err as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  const amount = Number(form.shares.replace(/[$,]/g, '')) * Number(form.price.replace(/[$,]/g, ''));
  return (
    <form onSubmit={submit} className="mb-8 border-y border-rule-strong/60 bg-surface px-4 py-4" aria-label={editing ? 'Edit transaction' : 'Add transaction'}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold">{editing ? `Edit ${editing.ticker} ${editing.type.toLowerCase()}` : 'Add transaction'}</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Field label="Ticker">
          <input ref={first} className={`${inputClass} uppercase`} value={form.ticker} onChange={set('ticker')} required autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Type">
          <Segmented label="Type" value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={[{ value: 'Buy', label: 'Buy' }, { value: 'Sell', label: 'Sell' }]} />
        </Field>
        <Field label="Shares">
          <input className={`${inputClass} num text-right`} value={form.shares} onChange={set('shares')} inputMode="decimal" required />
        </Field>
        <Field label="Price per share">
          <input className={`${inputClass} num text-right`} value={form.price} onChange={set('price')} inputMode="decimal" required />
        </Field>
        <Field label="Trade date">
          <input type="date" className={`${inputClass} num`} value={form.date} onChange={set('date')} required />
        </Field>
        <Field label="Account">
          <input className={inputClass} value={form.account} onChange={set('account')} list="accounts" autoComplete="off" />
          <datalist id="accounts">
            {accounts.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </Field>
        <Field label="Asset type">
          <Segmented label="Asset type" value={form.assetType} onChange={(v) => setForm({ ...form, assetType: v })} options={[{ value: 'Stock', label: 'Stock' }, { value: 'ETF', label: 'ETF' }]} />
        </Field>
        <Field label="Note">
          <input className={inputClass} value={form.note} onChange={set('note')} />
        </Field>
      </div>
      {errors.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-[13px] text-loss" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="tnum text-[13px] text-muted">{Number.isFinite(amount) && amount > 0 ? `Amount ${money(amount)}` : 'Enter shares and price as traded on that date.'}</p>
        <Button type="submit" variant="primary" busy={busy}>
          {editing ? 'Save changes' : 'Add transaction'}
        </Button>
      </div>
    </form>
  );
}

export function ImportPanel({ hasRows, onClose, onImported }: { hasRows: boolean; onClose: () => void; onImported: (message: string) => void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  // A broker file names no account, so it is typed here.
  const [account, setAccount] = useState('');
  const { accounts } = useAccount();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!text.trim()) {
      setPreview(null);
      return;
    }
    const id = setTimeout(async () => {
      try {
        setPreview(await api<ImportResult>('/api/import/preview', { method: 'POST', body: { text, account } }));
        setFailure(null);
      } catch (e) {
        setFailure((e as Error).message);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [text, account]);

  const loadFile = async (f: File | undefined) => {
    if (f) setText(await f.text());
  };

  const commit = async () => {
    setBusy(true);
    try {
      const r = await api<{ inserted: number; splits: number; backupPath?: string }>('/api/import/commit', {
        method: 'POST', body: { text, mode: preview?.source ? 'append' : mode, account },
      });
      onImported(
        `Imported ${r.inserted} transactions${r.splits ? ` and ${r.splits} split row${r.splits > 1 ? 's' : ''} (kept for the cross-check, not applied)` : ''}.` +
          (r.backupPath ? ` Previous data backed up to ${r.backupPath}.` : ''),
      );
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const errorRows = new Map(preview?.errors.map((e) => [e.row, e.message]) ?? []);
  const broker = !!preview?.source;
  const ok = preview && !preview.fileErrors.length && !preview.errors.length && preview.rows.length > 0 && (!broker || account.trim() !== '');

  return (
    <section className="mb-8 border-y border-rule-strong/60 bg-surface px-4 py-4" aria-label="Import transactions">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold">Import</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <p className="mb-3 text-[13px] text-muted">
        Paste the Transactions tab copied from Google Sheets (header row included), or choose a CSV file. Columns are matched by name: Ticker, Asset Type, Type,
        Shares, Split (n to 1), Avg Price, Date, Account. Split rows are not applied; splits come from market data. Or choose a Schwab transaction export saved as
        JSON or a Robinhood account activity CSV: buys and sells are added to one account. Dividend reinvestments are skipped because the app reinvests dividends itself.
        Broker files can also be saved into the drop folder and are imported without coming here; Data → Drop folder shows where it is.
      </p>
      <textarea
        className={`${inputClass} h-36 resize-y py-2 font-mono text-[13px] leading-5`}
        placeholder={'Ticker\tAsset Type\tType\tShares\tSplit (n to 1)\tAvg Price\tDate\tAccount\nDIS\tStock\tBuy\t30\t\t111.46\t3/10/2020\tMain'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Pasted rows"
        spellCheck={false}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-rule-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
          Choose file…
          <input type="file" accept=".csv,.tsv,.txt,.json,text/csv,application/json" className="sr-only" onChange={(e) => void loadFile(e.target.files?.[0])} />
        </label>
        {text && (
          <Button size="sm" variant="ghost" onClick={() => setText('')}>
            Clear
          </Button>
        )}
      </div>

      {failure && <p className="mt-3 text-[13px] text-loss" role="alert">{failure}</p>}

      {preview && (
        <div className="mt-4">
          {preview.fileErrors.length > 0 ? (
            <Notice tone="loss" title={broker ? 'This file can’t be read' : 'This doesn’t look like the Transactions tab'}>
              {preview.fileErrors.join('. ')}.
            </Notice>
          ) : (
            <>
              {broker && (
                <div className="mb-3 flex flex-wrap items-end gap-3">
                  <Field label="Account for this file">
                    <input className={inputClass} value={account} onChange={(e) => setAccount(e.target.value)} list="import-accounts" autoComplete="off" placeholder="e.g. Retirement" />
                    <datalist id="import-accounts">
                      {accounts.map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                  </Field>
                  {preview.range && (
                    <p className="pb-2 text-[13px] text-muted">
                      Schwab export covering {date(preview.range.from)} to {date(preview.range.to)}.
                    </p>
                  )}
                </div>
              )}
              <p className="tnum mb-2 text-[13px]">
                <span className="font-semibold">{preview.rows.length}</span> {broker ? (preview.rows.length === 1 ? 'new trade' : 'new trades') : 'transactions'}
                {(preview.skipped?.length ?? 0) > 0 && <> · {preview.skipped!.length} rows skipped</>}
                {preview.splits.length > 0 && <> · {preview.splits.length} split rows to keep aside</>}
                {preview.errors.length > 0 && <span className="text-loss"> · {preview.errors.length} rows with errors</span>}
              </p>
              {preview.errors.length > 0 && (
                <Notice tone="loss" title={`Fix these rows in the ${broker ? 'file' : 'sheet'} and paste again. Nothing is saved until every row reads cleanly.`}>
                  <ul className="mt-1 space-y-0.5">
                    {preview.errors.slice(0, 12).map((e) => (
                      <li key={e.row} className="num">
                        Row {e.row}: {e.message}
                      </li>
                    ))}
                    {preview.errors.length > 12 && <li>…and {preview.errors.length - 12} more</li>}
                  </ul>
                </Notice>
              )}
              <div className="mt-3 max-h-72 overflow-auto border-y border-rule">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-surface text-muted">
                    <tr>
                      {['Row', 'Date', 'Ticker', 'Type', 'Shares', 'Price', 'Account'].map((h, i) => (
                        <th key={h} className={`px-2 py-1.5 font-medium ${i >= 4 && i <= 5 ? 'text-right' : 'text-left'}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 200).map((r) => (
                      <tr key={r.row} className="border-t border-rule">
                        <td className="num px-2 py-1 text-muted">{r.row}</td>
                        <td className="num px-2 py-1">{r.date}</td>
                        <td className="px-2 py-1 font-semibold">{r.ticker}</td>
                        <td className="px-2 py-1">{r.type}</td>
                        <td className="num px-2 py-1 text-right">{shares(r.shares)}</td>
                        <td className="num px-2 py-1 text-right">{money(r.price, { precise: true })}</td>
                        <td className="px-2 py-1 text-muted">{r.account}</td>
                      </tr>
                    ))}
                    {preview.splits.map((s) => (
                      <tr key={`s${s.row}`} className="border-t border-rule text-muted italic">
                        <td className="num px-2 py-1">{s.row}</td>
                        <td className="num px-2 py-1">{s.exDate}</td>
                        <td className="px-2 py-1 font-semibold">{s.ticker}</td>
                        <td className="px-2 py-1" colSpan={4}>
                          Split {s.ratio}-for-1: kept aside, not applied
                        </td>
                      </tr>
                    ))}
                    {[...errorRows].map(([row, msg]) => (
                      <tr key={`e${row}`} className="border-t border-rule bg-loss-soft text-loss">
                        <td className="num px-2 py-1">{row}</td>
                        <td className="px-2 py-1" colSpan={6}>
                          {msg}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.rows.length > 200 && <p className="px-2 py-1.5 text-[13px] text-muted">Showing the first 200 rows.</p>}
              </div>
            </>
          )}
          {(preview.skipped?.length ?? 0) > 0 && (
            <details className="mt-2 text-[13px] text-muted">
              <summary className="cursor-pointer hover:text-ink">Skipped rows</summary>
              <ul className="mt-1 space-y-0.5">
                {preview.skipped!.map((s) => (
                  <li key={s.row} className="num">
                    Row {s.row}: {s.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {broker ? (
                <span className="text-[13px] text-muted">Adds these to your transactions. Trades already in the app are skipped, so a file can be imported again.</span>
              ) : (
                <>
                  <Segmented
                    label="Import mode"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'replace', label: 'Replace all' },
                      { value: 'append', label: 'Append' },
                    ]}
                  />
                  <span className="text-[13px] text-muted">
                    {mode === 'replace'
                      ? hasRows
                        ? 'Deletes current transactions first. A backup of the database is saved.'
                        : 'Saves these as your transactions.'
                      : 'Adds these after the current ones. Duplicates are not removed.'}
                  </span>
                </>
              )}
            </div>
            <Button variant="primary" disabled={!ok} busy={busy} onClick={() => void commit()}>
              {broker ? 'Add' : mode === 'replace' ? 'Replace all' : 'Append'} {ok ? `${preview!.rows.length} ${broker ? (preview!.rows.length === 1 ? 'trade' : 'trades') : 'rows'}` : ''}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
