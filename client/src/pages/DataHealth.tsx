import { TickerLink } from '../components/TickerLink.tsx';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { PriceGap, PriceWarning, SplitCheck } from '../../../src/engine/health.ts';
import type { Oversell } from '../../../src/engine/costBasis.ts';
import type { Security, StoredSplit } from '../../../src/db/queries.ts';
import type { InboxStatus } from '../../../src/server/inbox.ts';
import { DropFolder } from '../components/DropFolder.tsx';
import { Table, type Column } from '../components/Table.tsx';
import { Button, ErrorLine, inputClass, Notice, PageTitle, Section, Segmented, Skeleton } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { date, money, pct, shares, when } from '../lib/format.ts';
import { useRefresh, type RefreshInfo } from '../lib/refresh.tsx';
import { useApi } from '../lib/useApi.ts';

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

function AllClear({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 border-y border-rule py-2.5 text-[13px] text-muted">
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </p>
  );
}

export default function DataHealth() {
  const { data, error, reload } = useApi<HealthResponse>('/api/health-report');
  const { refresh, bump, info: liveInfo } = useRefresh();

  if (!data) return error ? <ErrorLine error={error} /> : <Skeleton rows={10} />;
  const info = liveInfo ?? data.refresh;
  const s = info.status;
  const attention = data.securities.filter((x) => x.status !== 'ok');

  const changed = async () => {
    await reload();
    bump();
  };

  return (
    <div>
      <PageTitle
        title="Data health"
        aside={
          <>
            <Link to="/securities" className="text-[13px] font-medium text-accent hover:underline">
              Edit securities
            </Link>
            {info.hasKey && (
              <Button variant="primary" busy={s.state === 'running'} onClick={() => void refresh()}>
                {s.state === 'running' ? 'Refreshing…' : 'Refresh prices now'}
              </Button>
            )}
          </>
        }
      >
        Where the numbers could be wrong, and what to do about it.
      </PageTitle>

      <Section title="Price refresh">
        <dl className="grid grid-cols-2 gap-y-3 border-y border-rule-strong py-3 sm:grid-cols-4">
          {[
            ['Status', !info.hasKey ? 'No API key' : s.state === 'running' ? `Fetching ${s.done} of ${s.total}` : s.error ? 'Last refresh failed' : 'Idle'],
            ['Last complete refresh', when(s.lastSuccessAt)],
            ['Requests this hour', `${info.budget.used} of ${info.budget.limit}`],
            ['Waiting for prices', s.pending.length ? `${s.pending.length}${s.resumesAt ? ` · resumes ${when(s.resumesAt)}` : ''}` : 'None'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="tnum mt-0.5 font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {s.error && (
          <div className="mt-3">
            <Notice tone="loss" title={s.error.kind === 'auth' ? 'Tiingo rejected the API key' : s.error.kind === 'rate-limit' ? 'Tiingo’s rate limit was reached' : 'The price provider could not be reached'}>
              {s.error.message} ({when(s.error.at)}). Saved prices are still shown; nothing was deleted.
            </Notice>
          </div>
        )}
        {s.pending.length > 0 && <p className="mt-2 text-xs text-muted">Waiting: {s.pending.join(', ')}. Charts that need these are incomplete until they arrive.</p>}
      </Section>

      <SecuritiesSection securities={data.securities} attention={attention} onChanged={changed} />

      {data.inbox && <DropFolder inbox={data.inbox} onChanged={changed} />}

      <Section title="Split cross-check" count={data.splitCheck.length}>
        <p className="mb-2.5 max-w-prose text-[13px] text-muted">
          Split rows from the sheet are not applied. Each is compared with the splits reported by the provider. If the provider has nothing within 5 trading days you can apply the sheet’s split by hand.
        </p>
        {data.splitCheck.length ? <SplitTable rows={data.splitCheck} onChanged={changed} /> : <AllClear>No split rows were imported.</AllClear>}
        <p className="mt-4 mb-2 text-xs font-medium text-muted">Splits in use ({data.splits.length})</p>
        {data.splits.length ? (
          <p className="tnum text-[13px] leading-6">
            {data.splits.map((x, i) => (
              <span key={`${x.ticker}${x.exDate}`}>
                {i > 0 && <span className="text-muted"> · </span>}
                <TickerLink ticker={x.ticker} /> {x.ratio >= 1 ? `${x.ratio}-for-1` : `1-for-${Math.round(1 / x.ratio)}`} on {date(x.exDate)}
                {x.source === 'manual' && <span className="text-warn"> (manual)</span>}
              </span>
            ))}
          </p>
        ) : (
          <p className="text-[13px] text-muted">None yet.</p>
        )}
      </Section>

      <Section title="Sales of more shares than held" count={data.oversells.length}>
        {data.oversells.length ? (
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
        ) : (
          <AllClear>Every sale is covered by shares held.</AllClear>
        )}
      </Section>

      <Section title="Fund sector breakdowns" count={data.fundSectors.length}>
        {data.fundSectors.length ? (
          <Table
            caption="Held funds whose sector breakdown needs attention"
            rows={data.fundSectors}
            rowKey={(f) => f.ticker}
            columns={[
              { key: 'ticker', label: 'Fund', render: (f) => <span className="font-semibold">{f.ticker}</span> },
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
        ) : (
          <AllClear>Every held fund has a sector breakdown from the last four weeks.</AllClear>
        )}
      </Section>

      <Section title="Dividends not reinvested" count={data.cashDividends.length}>
        {data.cashDividends.length ? (
          <Table
            caption="Dividends kept as cash"
            rows={data.cashDividends.map((d, i) => ({ ...d, i }))}
            rowKey={(d) => d.i}
            columns={[
              { key: 'date', label: 'Ex-date', render: (d) => <span className="num">{date(d.date)}</span> },
              { key: 'ticker', label: 'Ticker', render: (d) => <span className="font-semibold">{d.ticker}</span> },
              { key: 'account', label: 'Account', render: (d) => <span className="text-muted">{d.account || '—'}</span> },
              { key: 'amount', label: 'Amount', numeric: true, render: (d) => money(d.amount) },
              { key: 'note', label: 'What happened', render: () => <span className="text-muted">No close within a week of the ex-date, so it is counted as cash.</span>, className: 'hidden md:table-cell' },
            ]}
          />
        ) : (
          <AllClear>Every dividend was reinvested.</AllClear>
        )}
      </Section>

      <Section title="Trades far from that day’s close" count={data.priceWarnings.length}>
        {data.priceWarnings.length ? (
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
        ) : (
          <AllClear>Every trade with a stored close is within 20% of it.</AllClear>
        )}
        <p className="mt-2 text-xs text-muted">More than 20% away usually means a typo, or a trade recorded on the wrong side of a split.</p>
      </Section>

      <Section title="Sheet-compatible benchmark (check figure)">
        <p className="mb-2.5 max-w-prose text-[13px] text-muted">
          The sheet’s “S&amp;P 500 Math”, run on SPY: every trade’s dollars go into or out of the benchmark at that day’s close, under average cost, with no clamp. It is here only so
          the sheet’s figures can be checked. Performance uses a per-ticker shadow that cannot go negative.
        </p>
        {data.sheetMirror ? (
          <>
            {data.sheetMirror.negative && (
              <div className="mb-3">
                <Notice tone="warn" title="The sheet’s method went negative">
                  A sale’s proceeds exceeded the benchmark position, so the sheet would show negative units. That is the flaw this method has; the Performance page does not use it.
                </Notice>
              </div>
            )}
            <dl className="grid grid-cols-2 gap-y-3 border-y border-rule-strong py-3 sm:grid-cols-5">
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
      </Section>

      <Section title="Gaps in price history" count={data.priceGaps.length}>
        {data.priceGaps.length ? (
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
        ) : (
          <AllClear>No gaps longer than 5 trading days. Short gaps carry the previous close forward.</AllClear>
        )}
      </Section>
    </div>
  );
}

function SecuritiesSection({ securities, attention, onChanged }: { securities: Sec[]; attention: Sec[]; onChanged: () => void }) {
  const [show, setShow] = useState<'attention' | 'all'>('attention');
  const rows = show === 'all' ? securities : attention;
  return (
    <Section
      title="Tickers"
      count={securities.length}
      aside={
        <Segmented
          label="Which tickers"
          value={show}
          onChange={setShow}
          options={[
            { value: 'attention', label: `Needs attention (${attention.length})` },
            { value: 'all', label: 'All' },
          ]}
        />
      }
    >
      {rows.length ? (
        <SecurityTable rows={rows} onChanged={onChanged} />
      ) : (
        <AllClear>Every ticker has prices from the provider.</AllClear>
      )}
      <p className="mt-2 max-w-prose text-xs text-muted">
        A renamed ticker (SQ → XYZ) needs its provider symbol set. For a merger or delisting, record a Sell at the deal price on the closing date, and a Buy of the acquirer if shares were received.
      </p>
    </Section>
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
          <span className="ml-1.5 text-[11px] text-muted">{x.benchmark ? 'benchmark' : x.held ? 'held' : 'sold'}</span>
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      sort: (x) => x.status,
      render: (x) => <span className={x.status === 'ok' ? 'text-muted' : 'font-medium text-warn'}>{x.status === 'ok' ? 'OK' : x.status === 'pending' ? 'Pending' : 'Unresolved'}</span>,
    },
    { key: 'through', label: 'Prices through', sort: (x) => x.historyThrough, render: (x) => <span className="num">{date(x.historyThrough)}</span>, className: 'hidden sm:table-cell' },
    { key: 'error', label: 'Detail', render: (x) => <span className="text-[13px] text-muted">{x.lastError ?? (x.status === 'pending' ? 'Not fetched yet' : '')}</span>, className: 'hidden md:table-cell' },
    { key: 'symbol', label: 'Provider symbol', render: (x) => (x.benchmark ? <span className="text-muted">{x.providerSymbol}</span> : <SymbolEditor sec={x} onChanged={onChanged} />) },
  ];
  return <Table caption="Tickers" rows={rows} columns={columns} rowKey={(x) => x.ticker} initialSort={{ key: 'ticker', dir: 'asc' }} />;
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
