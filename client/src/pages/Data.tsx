// The Data area: can the numbers be trusted? Health is a checklist; each check
// is one line when it is clear and opens into its table when it is not.
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import type { PriceGap, PriceWarning, SplitCheck } from '../../../src/engine/health.ts';
import type { Oversell } from '../../../src/engine/costBasis.ts';
import type { Security, StoredSplit } from '../../../src/db/queries.ts';
import type { InboxStatus } from '../../../src/server/inbox.ts';
import { DropFolder } from '../components/DropFolder.tsx';
import { Table, type Column } from '../components/Table.tsx';
import { TickerLink } from '../components/TickerLink.tsx';
import { Button, Empty, ErrorLine, inputClass, Note, Notice, PageHeader, Segmented, Skeleton, Stat, StatRow } from '../components/ui.tsx';
import { DATA_TABS } from '../lib/areas.ts';
import { api } from '../lib/api.ts';
import { date, money, pct, shares, when } from '../lib/format.ts';
import { useRefresh, type RefreshInfo } from '../lib/refresh.tsx';
import { useApi } from '../lib/useApi.ts';

export default function DataArea() {
  return <Outlet />;
}

type Sec = Security & { held: boolean; benchmark: boolean; bars: number };

interface HealthResponse {
  refresh: RefreshInfo;
  securities: Sec[];
  splits: StoredSplit[];
  splitCheck: SplitCheck[];
  oversells: (Oversell & { seq: number | null })[];
  priceGaps: PriceGap[];
  priceWarnings: PriceWarning[];
  cashDividends: { date: string; ticker: string; account: string; amount: number }[];
  fundSectors: { ticker: string; lastCheckedAt: string | null; lastError: string | null; stale: boolean }[];
  inbox: InboxStatus | null;
  sheetMirror: { benchmark: string; units: number; cost: number; unitsSold: number; realized: number; unrealized: number; missing: number; negative: boolean } | null;
}

/** One line in the checklist: clear, or a count that opens the detail. */
function Check({ title, issues, clear, children, always }: { title: string; issues: number; clear: string; children: ReactNode; always?: boolean }) {
  const ok = issues === 0;
  const [open, setOpen] = useState(!ok);
  return (
    <li className="border-b border-rule">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="grid w-full grid-cols-[1.25rem_1fr_auto] items-center gap-x-3 py-2.5 text-left text-[13px] hover:bg-ink/[0.025]"
      >
        {ok && !always ? (
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="var(--gain)" strokeWidth="1.75" className="ml-0.5">
            <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : always ? (
          <span aria-hidden className="ml-1 inline-block size-2 rounded-full border border-rule-strong" />
        ) : (
          <span aria-hidden className="ml-1 inline-block size-2 rounded-full bg-warn" />
        )}
        <span>
          <span className="font-medium text-ink">{title}</span>
          <span className={`ml-2 ${ok ? 'text-muted' : 'text-warn'}`}>{ok ? clear : `${issues} need${issues === 1 ? 's' : ''} a look`}</span>
        </span>
        <span className="text-xs text-faint">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && <div className="pb-5 pl-8">{children}</div>}
    </li>
  );
}

export function Health() {
  const { data, error, reload } = useApi<HealthResponse>('/api/health-report');
  const { refresh, bump, info: liveInfo } = useRefresh();
  const header = (
    <PageHeader
      tabs={DATA_TABS}
      controls={
        (liveInfo ?? data?.refresh)?.hasKey ? (
          <Button size="sm" busy={(liveInfo ?? data?.refresh)?.status.state === 'running'} onClick={() => void refresh()}>
            {(liveInfo ?? data?.refresh)?.status.state === 'running' ? 'Refreshing…' : 'Refresh prices now'}
          </Button>
        ) : undefined
      }
    >
      Where the numbers could be wrong, and what to do about it.
    </PageHeader>
  );
  if (!data) return <>{header}{error ? <ErrorLine error={error} /> : <Skeleton rows={10} />}</>;
  const info = liveInfo ?? data.refresh;
  const s = info.status;
  const attention = data.securities.filter((x) => x.status !== 'ok');
  const changed = async () => {
    await reload();
    bump();
  };
  const checks = [attention.length, data.splitCheck.filter((x) => x.result !== 'match' && x.result !== 'applied').length, data.oversells.length, data.fundSectors.length, data.cashDividends.length, data.priceWarnings.length, data.priceGaps.length];
  const clear = checks.filter((n) => n === 0).length;

  return (
    <div>
      {header}
      <StatRow cols={4}>
        <Stat label="Price refresh" value={!info.hasKey ? 'No API key' : s.state === 'running' ? `Fetching ${s.done} of ${s.total}` : s.error ? 'Last refresh failed' : 'Idle'} tone={s.error ? 'text-loss' : ''} />
        <Stat label="Last complete refresh" value={when(s.lastSuccessAt)} />
        <Stat label="Requests this hour" value={`${info.budget.used} of ${info.budget.limit}`} sub="Tiingo’s free tier allows 50" />
        <Stat label="Waiting for prices" value={s.pending.length ? String(s.pending.length) : 'None'} sub={s.pending.length ? (s.resumesAt ? `resumes ${when(s.resumesAt)}` : s.pending.join(', ')) : undefined} />
      </StatRow>
      {s.error && (
        <div className="mt-4">
          <Notice tone="loss" title={s.error.kind === 'auth' ? 'Tiingo rejected the API key' : s.error.kind === 'rate-limit' ? 'Tiingo’s rate limit was reached' : 'The price provider could not be reached'}>
            {s.error.message} ({when(s.error.at)}). Saved prices are still shown; nothing was deleted.
          </Notice>
        </div>
      )}

      <div className="mt-9 mb-2 flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold text-ink">Checks</h2>
        <span className="num text-xs text-muted">{clear} of {checks.length} clear</span>
      </div>
      <ul className="border-t border-rule-strong/60">
        <Check title="Tickers with prices" issues={attention.length} clear={`every ticker has prices from the provider`}>
          <SecuritiesCheck securities={data.securities} attention={attention} onChanged={changed} />
        </Check>
        <Check title="Split cross-check" issues={checks[1]} clear={data.splitCheck.length ? 'every imported split matches the provider' : 'no split rows were imported'}>
          <p className="mb-2.5 max-w-prose text-[13px] text-muted">
            Split rows from the sheet are not applied. Each is compared with the splits reported by the provider. If the provider has nothing within 5 trading days you can apply the sheet’s split by hand.
          </p>
          {data.splitCheck.length ? <SplitTable rows={data.splitCheck} onChanged={changed} /> : null}
          <p className="mt-4 mb-1 text-xs font-medium text-muted">Splits in use ({data.splits.length})</p>
          {data.splits.length ? (
            <p className="tnum text-[13px] leading-6">
              {data.splits.map((x, i) => (
                <span key={`${x.ticker}${x.exDate}`}>
                  {i > 0 && <span className="text-faint"> · </span>}
                  <TickerLink ticker={x.ticker} /> {x.ratio >= 1 ? `${x.ratio}-for-1` : `1-for-${Math.round(1 / x.ratio)}`} on {date(x.exDate)}
                  {x.source === 'manual' && <span className="text-warn"> (manual)</span>}
                </span>
              ))}
            </p>
          ) : (
            <p className="text-[13px] text-muted">None yet.</p>
          )}
        </Check>
        <Check title="Sales covered by shares held" issues={data.oversells.length} clear="every sale is covered">
          <Table
            caption="Oversells"
            rows={data.oversells}
            rowKey={(o) => o.txId}
            columns={[
              { key: 'date', label: 'Date', render: (o) => <span className="num">{date(o.date)}</span> },
              { key: 'ticker', label: 'Ticker', render: (o) => <TickerLink ticker={o.ticker} /> },
              { key: 'account', label: 'Account', render: (o) => <span className="text-muted">{o.account || '—'}</span> },
              { key: 'req', label: 'Sold', numeric: true, render: (o) => shares(o.requested) },
              { key: 'held', label: 'Held', numeric: true, render: (o) => shares(o.held) },
              { key: 'note', label: 'What happened', render: () => <span className="text-muted">Clamped to the shares held. Check for a missing buy or split.</span>, className: 'hidden md:table-cell' },
            ]}
          />
        </Check>
        <Check title="Fund sector breakdowns" issues={data.fundSectors.length} clear="every held fund has a breakdown from the last four weeks">
          <Table
            caption="Held funds whose sector breakdown needs attention"
            rows={data.fundSectors}
            rowKey={(f) => f.ticker}
            columns={[
              { key: 'ticker', label: 'Fund', render: (f) => <span className="font-medium">{f.ticker}</span> },
              { key: 'checked', label: 'Last refreshed', render: (f) => <span className="num">{f.lastCheckedAt ? date(f.lastCheckedAt.slice(0, 10)) : 'Never'}</span> },
              {
                key: 'note',
                label: 'What happened',
                render: (f) => (
                  <span className="text-muted">
                    {!f.lastCheckedAt
                      ? 'No breakdown yet, so the fund shows under ETFs in the sector allocation.'
                      : f.stale
                        ? 'Not refreshed in over four weeks. The allocation uses the old breakdown.'
                        : 'The latest refresh failed. The allocation uses the last good breakdown.'}
                    {f.lastError && ` ${f.lastError}.`}
                  </span>
                ),
              },
            ]}
          />
        </Check>
        <Check title="Dividends reinvested" issues={data.cashDividends.length} clear="every dividend was reinvested">
          <Table
            caption="Dividends kept as cash"
            rows={data.cashDividends.map((d, i) => ({ ...d, i }))}
            rowKey={(d) => d.i}
            columns={[
              { key: 'date', label: 'Ex-date', render: (d) => <span className="num">{date(d.date)}</span> },
              { key: 'ticker', label: 'Ticker', render: (d) => <span className="font-medium">{d.ticker}</span> },
              { key: 'account', label: 'Account', render: (d) => <span className="text-muted">{d.account || '—'}</span> },
              { key: 'amount', label: 'Amount', numeric: true, render: (d) => money(d.amount) },
              { key: 'note', label: 'What happened', render: () => <span className="text-muted">No close within a week of the ex-date, so it is counted as cash.</span>, className: 'hidden md:table-cell' },
            ]}
          />
        </Check>
        <Check title="Trades near that day’s close" issues={data.priceWarnings.length} clear="every trade with a stored close is within 20% of it">
          <Table
            caption="Price warnings"
            rows={data.priceWarnings}
            rowKey={(w) => w.txId}
            columns={[
              { key: 'date', label: 'Date', render: (w) => <span className="num">{date(w.date)}</span> },
              { key: 'ticker', label: 'Ticker', render: (w) => <TickerLink ticker={w.ticker} /> },
              { key: 'price', label: 'Recorded price', numeric: true, render: (w) => money(w.price, { precise: true }) },
              { key: 'close', label: 'Close that day', numeric: true, render: (w) => money(w.close, { precise: true }) },
              { key: 'diff', label: 'Difference', numeric: true, render: (w) => <span className="text-warn">{pct(w.diffPct)}</span> },
            ]}
          />
          <Note>More than 20% away usually means a typo, or a trade recorded on the wrong side of a split.</Note>
        </Check>
        <Check title="Gaps in price history" issues={data.priceGaps.length} clear="no gaps longer than 5 trading days">
          <Table
            caption="Price gaps"
            rows={data.priceGaps}
            rowKey={(g) => `${g.ticker}${g.from}`}
            columns={[
              { key: 'ticker', label: 'Ticker', render: (g) => <TickerLink ticker={g.ticker} /> },
              { key: 'from', label: 'From', render: (g) => <span className="num">{date(g.from)}</span> },
              { key: 'to', label: 'To', render: (g) => <span className="num">{date(g.to)}</span> },
              { key: 'days', label: 'Trading days', numeric: true, render: (g) => g.tradingDays },
            ]}
          />
          <Note>Short gaps carry the previous close forward.</Note>
        </Check>
        <Check title="Sheet-compatible benchmark" issues={data.sheetMirror?.negative ? 1 : 0} clear="a check figure for the spreadsheet’s own method" always>
          <p className="mb-2.5 max-w-prose text-[13px] text-muted">
            The sheet’s “S&amp;P 500 Math”, run on SPY: every trade’s dollars go into or out of the benchmark at that day’s close, under average cost, with no clamp. It is here only so
            the sheet’s figures can be checked. Performance uses a per-ticker shadow that cannot go negative.
          </p>
          {data.sheetMirror ? (
            <>
              {data.sheetMirror.negative && (
                <div className="mb-3">
                  <Notice tone="warn" title="The sheet’s method went negative">
                    A sale’s proceeds exceeded the benchmark position, so the sheet would show negative units. That is the flaw this method has; Performance does not use it.
                  </Notice>
                </div>
              )}
              <dl className="grid grid-cols-2 gap-y-3 border-y border-rule py-3 sm:grid-cols-5">
                {[
                  ['Units held', shares(data.sheetMirror.units), data.sheetMirror.units < 0 ? 'text-warn' : ''],
                  ['Units sold', shares(data.sheetMirror.unitsSold), ''],
                  ['Unrealized', money(data.sheetMirror.unrealized, { signed: true }), ''],
                  ['Realized', money(data.sheetMirror.realized, { signed: true }), ''],
                  ['Trades without a close', String(data.sheetMirror.missing), data.sheetMirror.missing ? 'text-warn' : ''],
                ].map(([k, v, cls]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted">{k}</dt>
                    <dd className={`tnum mt-0.5 font-medium ${cls}`}>{v}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="text-[13px] text-muted">Needs SPY prices and at least one transaction.</p>
          )}
        </Check>
      </ul>
    </div>
  );
}

function SecuritiesCheck({ securities, attention, onChanged }: { securities: Sec[]; attention: Sec[]; onChanged: () => void }) {
  const [show, setShow] = useState<'attention' | 'all'>(attention.length ? 'attention' : 'all');
  const rows = show === 'all' ? securities : attention;
  return (
    <div>
      <div className="mb-2.5">
        <Segmented
          label="Which tickers"
          value={show}
          onChange={setShow}
          options={[
            { value: 'attention', label: `Needs attention (${attention.length})` },
            { value: 'all', label: `All (${securities.length})` },
          ]}
        />
      </div>
      {rows.length ? <SecurityTable rows={rows} onChanged={onChanged} /> : <p className="text-[13px] text-muted">Nothing needs attention.</p>}
      <Note>
        A renamed ticker (SQ → XYZ) needs its provider symbol set. For a merger or delisting, record a Sell at the deal price on the closing date, and a Buy of the acquirer if shares were received.
      </Note>
    </div>
  );
}

function SecurityTable({ rows, onChanged }: { rows: Sec[]; onChanged: () => void }) {
  const columns: Column<Sec>[] = [
    {
      key: 'ticker',
      label: 'Ticker',
      sort: (x) => x.ticker,
      render: (x) => (
        <span className="whitespace-nowrap">
          <TickerLink ticker={x.ticker} />
          <span className="ml-1.5 text-[11px] text-faint">{x.benchmark ? 'benchmark' : x.held ? 'held' : 'sold'}</span>
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      sort: (x) => x.status,
      render: (x) => <span className={x.status === 'ok' ? 'text-muted' : 'font-medium text-warn'}>{x.status === 'ok' ? 'OK' : x.status === 'pending' ? 'Pending' : 'Unresolved'}</span>,
    },
    { key: 'through', label: 'Prices through', sort: (x) => x.historyThrough, render: (x) => <span className="num text-muted">{date(x.historyThrough)}</span>, className: 'hidden sm:table-cell' },
    { key: 'error', label: 'Detail', render: (x) => <span className="text-[13px] text-muted">{x.lastError ?? (x.status === 'pending' ? 'Not fetched yet' : '')}</span>, className: 'hidden md:table-cell' },
    { key: 'symbol', label: 'Provider symbol', render: (x) => (x.benchmark ? <span className="text-muted">{x.providerSymbol}</span> : <SymbolEditor sec={x} onChanged={onChanged} />) },
  ];
  return <Table caption="Tickers" rows={rows} columns={columns} rowKey={(x) => x.ticker} initialSort={{ key: 'ticker', dir: 'asc' }} dense />;
}

function SymbolEditor({ sec, onChanged }: { sec: Sec; onChanged: () => void }) {
  const [value, setValue] = useState(sec.providerSymbol);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = value.trim().toUpperCase() !== sec.providerSymbol;
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/securities/${sec.ticker}`, { method: 'PUT', body: { providerSymbol: value } });
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) void save();
      }}
    >
      <input
        aria-label={`Provider symbol for ${sec.ticker}`}
        aria-invalid={!!err || undefined}
        className={`${inputClass} h-7 w-24 uppercase`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
      />
      {dirty && (
        <Button size="sm" type="submit" variant="primary" busy={busy}>
          Save
        </Button>
      )}
      {err && <span className="text-xs text-loss">{err}</span>}
    </form>
  );
}

function SplitTable({ rows, onChanged }: { rows: SplitCheck[]; onChanged: () => void }) {
  const apply = async (id: number) => {
    await api('/api/splits/apply', { method: 'POST', body: { importedSplitId: id } });
    onChanged();
  };
  const label: Record<string, ReactNode> = {
    match: <span className="text-muted">Matches provider</span>,
    'ratio-differs': <span className="font-medium text-warn">Ratio differs</span>,
    missing: <span className="font-medium text-warn">Provider has no split</span>,
    applied: <span className="text-muted">Applied by hand</span>,
  };
  return (
    <Table
      caption="Imported splits"
      rows={rows}
      rowKey={(s) => s.id}
      columns={[
        { key: 'ticker', label: 'Ticker', render: (s) => <TickerLink ticker={s.ticker} /> },
        { key: 'date', label: 'Sheet date', render: (s) => <span className="num">{date(s.exDate)}</span> },
        { key: 'ratio', label: 'Sheet ratio', numeric: true, render: (s) => `${s.ratio}:1` },
        { key: 'pdate', label: 'Provider date', render: (s) => <span className="num">{s.providerExDate ? date(s.providerExDate) : '—'}</span>, className: 'hidden sm:table-cell' },
        { key: 'pratio', label: 'Provider ratio', numeric: true, render: (s) => (s.providerRatio ? `${s.providerRatio}:1` : '—'), className: 'hidden sm:table-cell' },
        { key: 'result', label: 'Result', render: (s) => label[s.result] },
        {
          key: 'action',
          label: <span className="sr-only">Action</span>,
          render: (s) =>
            s.result === 'missing' ? (
              <Button size="sm" onClick={() => void apply(s.id)}>
                Apply this split
              </Button>
            ) : null,
        },
      ]}
    />
  );
}

export function Inbox() {
  const { data, error, reload } = useApi<HealthResponse>('/api/health-report');
  const { bump } = useRefresh();
  const header = <PageHeader tabs={DATA_TABS}>Broker files saved into the drop folder are imported on their own.</PageHeader>;
  if (!data) return <>{header}{error ? <ErrorLine error={error} /> : <Skeleton rows={6} />}</>;
  return (
    <div>
      {header}
      {data.inbox ? (
        <DropFolder
          inbox={data.inbox}
          onChanged={async () => {
            await reload();
            bump();
          }}
        />
      ) : (
        <Empty title="The drop folder is off">The server did not open one.</Empty>
      )}
    </div>
  );
}

type TradedSec = Security & { traded: boolean };

export function Securities() {
  const { data, error, reload } = useApi<{ securities: TradedSec[] }>('/api/securities');
  const { bump } = useRefresh();
  const rows = useMemo(() => (data?.securities ?? []).filter((s) => s.traded), [data]);
  const sectors = useMemo(() => [...new Set(rows.map((s) => s.sector).filter((x): x is string => !!x))].sort(), [rows]);
  const header = (
    <PageHeader tabs={DATA_TABS}>
      Name, sector and asset type for each ticker you have traded. Sectors drive the allocation; ETFs are always their own group. Blank sectors and names are looked up automatically; what you type here is kept.
    </PageHeader>
  );
  if (!data) return <>{header}{error ? <ErrorLine error={error} /> : <Skeleton rows={8} />}</>;
  return (
    <div>
      {header}
      <datalist id="sectors">
        {sectors.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {rows.length ? (
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">Securities</caption>
            <thead>
              <tr className="border-b border-rule-strong/70 text-left text-xs text-muted">
                {['Ticker', 'Name', 'Sector', 'Asset type', 'Provider symbol', 'Prices', ''].map((h, i) => (
                  <th key={i} scope="col" className={`px-2.5 pt-1 pb-1.5 font-medium first:pl-0 last:pr-0 ${i === 5 ? 'hidden lg:table-cell' : ''}`}>
                    {h || <span className="sr-only">Save</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((sec) => (
                <SecurityRow
                  key={sec.ticker}
                  sec={sec}
                  onSaved={async () => {
                    await reload();
                    bump();
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No securities yet">They appear here once you add or import transactions.</Empty>
      )}
    </div>
  );
}

function SecurityRow({ sec, onSaved }: { sec: TradedSec; onSaved: () => void }) {
  const initial = { name: sec.name ?? '', sector: sec.sector ?? '', assetType: sec.assetType, providerSymbol: sec.providerSymbol };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const save = async () => {
    if (!dirty) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/securities/${sec.ticker}`, { method: 'PUT', body: form });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void save();
  };
  const cell = 'px-2.5 py-1.5 first:pl-0 last:pr-0';
  return (
    <tr className="border-b border-rule last:border-b-0">
      <td className={cell}><TickerLink ticker={sec.ticker} /></td>
      <td className={`${cell} min-w-40`}>
        <input aria-label={`Name of ${sec.ticker}`} placeholder="Name" className={`${inputClass} h-7`} value={form.name} onKeyDown={onEnter} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </td>
      <td className={`${cell} min-w-36`}>
        <input
          aria-label={`Sector of ${sec.ticker}`}
          placeholder={form.assetType === 'ETF' ? 'ETFs (own group)' : 'Sector'}
          list="sectors"
          disabled={form.assetType === 'ETF'}
          className={`${inputClass} h-7 disabled:opacity-60`}
          value={form.sector}
          onKeyDown={onEnter}
          onChange={(e) => setForm({ ...form, sector: e.target.value })}
        />
      </td>
      <td className={cell}>
        <Segmented label={`Asset type of ${sec.ticker}`} value={form.assetType} onChange={(v) => setForm({ ...form, assetType: v })} options={[{ value: 'Stock', label: 'Stock' }, { value: 'ETF', label: 'ETF' }]} />
      </td>
      <td className={`${cell} w-28`}>
        <input aria-label={`Provider symbol for ${sec.ticker}`} className={`${inputClass} h-7 uppercase`} value={form.providerSymbol} onKeyDown={onEnter} onChange={(e) => setForm({ ...form, providerSymbol: e.target.value })} spellCheck={false} />
      </td>
      <td className={`${cell} hidden whitespace-nowrap lg:table-cell ${sec.status === 'ok' ? 'text-muted' : 'text-warn'}`}>
        {sec.status === 'ok' ? `through ${date(sec.historyThrough)}` : sec.status === 'pending' ? 'Pending' : 'Unresolved'}
      </td>
      <td className={`${cell} w-24 text-right whitespace-nowrap`}>
        {dirty ? (
          <Button size="sm" variant="primary" busy={busy} onClick={() => void save()}>
            Save
          </Button>
        ) : saved ? (
          <span className="text-xs text-muted" role="status">
            Saved
          </span>
        ) : null}
        {err && (
          <span className="block text-xs text-loss" role="alert">
            {err}
          </span>
        )}
      </td>
    </tr>
  );
}
