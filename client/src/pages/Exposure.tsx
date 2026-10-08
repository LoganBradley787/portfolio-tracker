import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ExposureRow } from '../../../src/engine/exposure.ts';
import type { exposureView } from '../../../src/server/service.ts';
import { Table, type Column, type SortState } from '../components/Table.tsx';
import { Button, Empty, ErrorLine, inputClass, Notice, PageHeader, Section, Skeleton, Stat, StatRow } from '../components/ui.tsx';
import { PORTFOLIO_TABS } from '../lib/areas.ts';
import { date, money, pct, when } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';

type ExposureData = ReturnType<typeof exposureView>;
type Fund = ExposureData['funds'][number];

function Company({ row }: { row: ExposureRow }) {
  return (
    <details className="max-w-md">
      <summary className="cursor-pointer rounded text-ink focus-visible:outline-2 focus-visible:outline-accent">
        <span className="font-medium">{row.name}</span>
        <span className="ml-2 text-[13px] text-muted">{row.tickers.join(' / ') || row.countries.join(' / ')}</span>
        {row.countries.some((c) => c !== 'US') && <span className="ml-2 text-[13px] text-muted">{row.countries.join(' / ')} · matched security</span>}
        {row.matching === 'uncertain' && <span className="ml-2 text-[13px] text-warn">Unconfirmed match</span>}
        {row.unknownThroughFunds.length > 0 && <span className="ml-2 text-[13px] text-warn">Unpublished ETF weight</span>}
      </summary>
      {row.matching === 'uncertain' && <p className="mt-1 text-[13px] text-warn">Unconfirmed match; kept separate.</p>}
      {row.matching === 'security' && <p className="mt-1 text-[13px] text-muted">Matched security; other share classes may be separate.</p>}
      <ul aria-label={`Contributions to ${row.name}`} className="mt-2 space-y-2 border-l border-rule-strong pl-3 pb-1 text-[13px]">
        {row.contributions.map((c, i) => (
          <li key={i}>
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
              <span>{c.kind === 'direct' ? `Direct · ${c.ticker}` : `Through ${c.ticker} · ${c.security?.ticker || c.security?.name}`}</span>
              <span className="num">{money(c.value)}</span>
            </div>
            {c.security && (
              <div className="mt-0.5 text-muted">
                {c.security.weight === null ? `Weight unpublished in ${c.ticker}` : `${pct(c.security.weight, { signed: false })} of ${c.ticker}`} · {c.security.country || 'Country unpublished'}
                {c.security.cusip && <span className="block break-all">CUSIP {c.security.cusip}</span>}
                {c.security.sedol && <span className="block break-all">SEDOL {c.security.sedol}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function FundStatus({ fund }: { fund: Fund }) {
  if (!fund.supported) return <span className="text-muted">Unsupported · unexpanded</span>;
  return (
    <div className="max-w-xs">
      <span className={fund.status === 'failed' ? 'text-warn' : 'text-muted'}>
        {fund.status === 'fetching' ? 'Checking holdings…' : fund.status === 'failed' ? fund.effectiveDate ? 'Showing saved holdings' : 'Holdings unavailable'
          : fund.status === 'pending' ? 'Waiting for holdings' : `Checked ${when(fund.lastCheckedAt)}`}
      </span>
      {fund.lastError && <p className="mt-0.5 text-[13px] text-warn">{fund.lastError}</p>}
      {fund.roundingExcessValue > 0 && <p className="mt-0.5 text-[13px] text-muted">{money(fund.roundingExcessValue)} rounding surplus</p>}
      {fund.missingWeights > 0 && <p className="mt-0.5 text-[13px] text-muted">{fund.missingWeights} unpublished weight{fund.missingWeights === 1 ? '' : 's'}</p>}
    </div>
  );
}

export default function Exposure() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'total', dir: 'desc' });
  const [offset, setOffset] = useState(0);
  const params = new URLSearchParams({ search: query, sort: sort.key, dir: sort.dir, offset: String(offset), limit: '20' });
  const { data, error, loading } = useApi<ExposureData>(`/api/exposure?${params}`);

  const header = (
    <PageHeader
      tabs={PORTFOLIO_TABS}
      controls={
        <input type="search" aria-label="Search companies" placeholder="Search company, ticker or identifier" value={query}
          onChange={(e) => { setQuery(e.target.value); setOffset(0); }} className={`${inputClass} h-8 sm:w-80`} />
      }
    >
      What you own directly and through ETFs, estimated using published fund weights.
    </PageHeader>
  );
  if (!data) return <>{header}{error ? <ErrorLine error={error} /> : <Skeleton rows={8} />}</>;
  const supported = data.funds.filter((f) => f.supported);
  const columns: Column<ExposureRow>[] = [
    { key: 'name', label: 'Company / security', sortable: true, render: (r) => <Company row={r} /> },
    { key: 'direct', label: 'Direct', numeric: true, sortable: true, render: (r) => money(r.direct) },
    ...supported.map((f): Column<ExposureRow> => ({
      key: `fund:${f.ticker}`, label: `Through ${f.ticker}`, numeric: true,
      sortable: true,
      render: (r) => !f.effectiveDate ? '—' : r.unknownThroughFunds.includes(f.ticker)
        ? <span className="text-warn" title="Unpublished weight excluded; only known contributions are counted">{r.throughFunds[f.ticker] ? `${money(r.throughFunds[f.ticker])} + ?` : '—'}</span>
        : money(r.throughFunds[f.ticker] ?? 0),
      className: 'hidden sm:table-cell',
    })),
    { key: 'total', label: 'Mapped total', numeric: true, sortable: true,
      render: (r) => <span className="font-medium">{money(r.total)}{r.valuationWarnings.length > 0 && <span className="ml-1 text-warn" title={r.valuationWarnings.join('; ')}>†</span>}</span> },
    { key: 'pct', label: '% of portfolio', numeric: true, sortable: true, render: (r) => pct(r.pctOfPortfolio, { signed: false }) },
  ];
  const fundColumns: Column<Fund>[] = [
    { key: 'ticker', label: 'Fund', render: (f) => <span className="font-medium">{f.ticker}</span> },
    { key: 'value', label: 'Position value', numeric: true, render: (f) => money(f.value) },
    { key: 'coverage', label: 'Equity weights covered', numeric: true,
      render: (f) => f.effectiveDate && f.value ? pct(f.allocatedValue / f.value, { signed: false }) : '—' },
    { key: 'date', label: 'Holdings as of', render: (f) => f.sourceUrl ?
      <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="whitespace-nowrap text-accent hover:underline">{f.effectiveDate ? date(f.effectiveDate) : 'Vanguard source'}</a> : '—' },
    { key: 'other', label: 'Other / unallocated', numeric: true, render: (f) => f.effectiveDate ? money(f.otherValue) : '—' },
    { key: 'status', label: 'Source status', render: (f) => <FundStatus fund={f} /> },
  ];
  return (
    <div>
      {header}
      <ErrorLine error={error} />
      {!data.rowCount && !data.funds.length ? <Empty title="No holdings in these accounts">Add or import <Link to="/data/transactions" className="text-accent hover:underline">transactions</Link> to see exposure.</Empty> : (
        <>
          <StatRow cols={4}>
            <Stat label="Portfolio value" value={money(data.totalValue)} />
            <Stat label="Mapped exposure" value={money(data.mappedValue)} sub={pct(data.coverage, { signed: false })} info="The part of the portfolio that can be traced to a company or security: direct positions plus the published holdings of each fund." />
            <Stat label="Other / unallocated" value={money(data.otherValue)} info="Fund value in bonds, cash and weights the fund does not publish." />
            <Stat label="Unexpanded funds" value={money(data.unexpandedValue)} info="Funds whose holdings are not supported or have not been fetched yet; counted as a single position." />
          </StatRow>
          <div className="mt-4 space-y-2 empty:hidden">
            {data.holdingsRefresh.state === 'running' && <Notice tone="info" title="Checking fund holdings">Saved exposure stays visible while newer holdings are checked.</Notice>}
            {data.valuationWarnings.length > 0 && <Notice title="Some position values need a look">
              {data.valuationWarnings.map((w) => w.ticker).join(', ')} use pending, missing, or unresolved prices. Exposure uses those same estimates. <Link to="/data/health" className="text-accent hover:underline">Data health</Link>
            </Notice>}
            {data.roundingExcessValue > 0 && <Notice tone="info" title="Published weights exceed 100%">
              Rounded fund weights add {money(data.roundingExcessValue)} above portfolio value. Published weights are preserved.
            </Notice>}
            {data.oversells.length > 0 && <Notice title="Sales exceed recorded shares">Exposure uses the remaining shares after clamping those sales. Check <Link to="/data/health" className="text-accent hover:underline">Data health</Link>.</Notice>}
          </div>
          <Section title="Companies and securities" count={data.rowCount} info="Confirmed Alphabet and Berkshire share classes are combined. Fund securities match by CUSIP or SEDOL; direct positions prefer US tickers, then unique tickers from other countries. Other share classes and international listings may remain separate. Expand a name for contributions. Percentages use the whole selected portfolio.">
            {data.rows.length ? (
              <Table rows={data.rows} columns={columns} rowKey={(r) => r.id} sort={sort} onSort={(next) => { setSort(next); setOffset(0); }} caption="Direct and ETF exposure" />
            ) : <Empty title={query ? 'No matching companies' : 'No underlying holdings available'}>{query ? 'Try a company name, ticker or security identifier.' : 'Supported fund holdings will appear automatically after a successful fetch.'}</Empty>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
              <span className="num text-[13px]">Showing {data.offset + (data.rows.length ? 1 : 0)}–{data.offset + data.rows.length} of {data.filteredCount.toLocaleString()}{query ? ' matching' : ''}</span>
              <div className="flex gap-2">
                <Button size="sm" disabled={loading || data.offset === 0} onClick={() => setOffset(Math.max(0, data.offset - 20))}>Previous</Button>
                <Button size="sm" disabled={loading || data.offset + data.rows.length >= data.filteredCount}
                  onClick={() => setOffset(data.offset + 20)}>Next</Button>
              </div>
            </div>
            {data.valuationWarnings.length > 0 && <p className="mt-2 text-[13px] text-warn">† Includes a position with a valuation warning.</p>}
          </Section>
          {data.funds.length > 0 && <Section title="Fund coverage" count={data.funds.length} info="Full equity holdings are used, with checks for newer snapshots once a week while the app runs. These are estimates at current position values, not live constituent weights or historical exposure. Known weights are never scaled to 100%; reserves and unpublished weights stay unallocated.">
            <Table rows={data.funds} columns={fundColumns} rowKey={(f) => f.ticker} caption="ETF holdings sources and coverage" />
          </Section>}
        </>
      )}
    </div>
  );
}
