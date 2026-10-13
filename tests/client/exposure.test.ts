import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Table } from '../../client/src/components/Table.tsx';
import Exposure from '../../client/src/pages/Exposure.tsx';
import { selectExposureRows } from '../../src/engine/exposureRows.ts';
import { computeExposure, type FundSnapshot } from '../../src/engine/exposure.ts';
import { withAccount } from '../../client/src/lib/account.tsx';
import { withMethod } from '../../client/src/lib/method.tsx';

const state = vi.hoisted(() => ({ data: null as any }));
vi.mock('../../client/src/lib/useApi.ts', () => ({ useApi: () => ({ data: state.data, error: null, loading: false }) }));
const render = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Exposure)));
function data() {
  const snapshot: FundSnapshot = { effectiveDate: '2026-08-31', holdings: [
    { name: 'Apple Inc', ticker: 'AAPL', weight: 0.1, country: 'US', cusip: '037833100', sedol: '2046251' },
    { name: 'Unknown weight', ticker: 'UNKNOWN', weight: null, country: 'US', cusip: 'UNKNOWN', sedol: '' },
  ] };
  const result = computeExposure({
    holdings: [{ ticker: 'VOO', assetType: 'ETF', equity: 1000, flag: null }, { ticker: 'QQQ', assetType: 'ETF', equity: 500, flag: null }],
    securities: [], snapshots: { VOO: snapshot }, supportedFunds: ['VOO', 'VT'],
  });
  return { ...result, rowCount: result.rows.length, filteredCount: result.rows.length, offset: 0, limit: 20,
    holdingsRefresh: { state: 'idle', finishedAt: null }, valuationWarnings: [], oversells: [],
    funds: result.funds.map((f) => ({ ...f, status: f.supported ? 'saved' : 'unsupported', lastCheckedAt: '2026-10-03T16:00:00Z',
      lastAttemptAt: '2026-10-03T16:00:00Z', lastError: null, sourceUrl: f.supported ? 'https://advisors.vanguard.com/source' : null })),
  };
}

describe('Exposure page', () => {
  it('sends the selected accounts and cost method to the exposure API', () => {
    expect(withAccount(withMethod('/api/exposure', 'average'), ['One', 'Two'])).toBe('/api/exposure?method=average&account=One&account=Two');
    expect(withAccount(withMethod('/api/exposure', 'fifo'), ['One'])).toBe('/api/exposure?account=One');
    expect(withAccount('/api/exposure', null)).toBe('/api/exposure');
  });
  it('shows dated estimates, coverage, unsupported funds, unknown weights, and expandable contributions', () => {
    state.data = data();
    const html = render();
    expect(html).toContain('Aug 31, 2026');
    expect(html).toContain('Apple Inc');
    expect(html).toContain('$100.00');
    expect(html).toContain('$900.00');
    expect(html).toContain('$500.00');
    expect(html).toContain('Unsupported');
    expect(html).toContain('1 unpublished weight');
    expect(html).toContain('<details');
    expect(html).toContain('037833100');
    expect(html).toContain('Search companies');
  });

  it('keeps a failed source explicit while still showing saved exposure', () => {
    state.data = data();
    Object.assign(state.data.funds[0], { status: 'failed', lastError: 'HTTP 503' });
    const html = render();
    expect(html).toContain('Showing saved holdings');
    expect(html).toContain('HTTP 503');
    expect(html).toContain('Apple Inc');
  });

  it('marks unknown fund weights instead of displaying a proven zero contribution', () => {
    state.data = data();
    const row = state.data.rows[0];
    row.unknownThroughFunds = ['VOO'];
    row.throughFunds = {};
    expect(render()).toContain('Unpublished ETF weight');
  });

  it('shows an empty portfolio without invented zero coverage', () => {
    state.data = { ...data(), rows: [], rowCount: 0, filteredCount: 0, funds: [], totalValue: 0, coverage: null };
    expect(render()).toContain('No holdings in these accounts');
  });

  it('preserves server order and exposes sort controls without a second comparator', () => {
    const html = renderToStaticMarkup(createElement(Table<{ name: string }>, {
      rows: [{ name: 'alpha' }, { name: 'Beta' }], rowKey: (r) => r.name,
      columns: [{ key: 'name', label: 'Name', sortable: true, render: (r) => r.name }],
      sort: { key: 'name', dir: 'asc' },
    }));
    expect(html.indexOf('>alpha<')).toBeLessThan(html.indexOf('>Beta<'));
    expect(html).toContain('<button');
    expect(html).toContain('aria-sort="ascending"');
  });

  it('shows a rounding surplus explicitly while preserving the published estimate', () => {
    state.data = data();
    state.data.roundingExcessValue = 5;
    state.data.funds[0].roundingExcessValue = 5;
    expect(render()).toContain('Published weights exceed 100%');
    expect(render()).toContain('$5.00 rounding surplus');
  });

  it('searches all underlying holdings and sorts before limiting the visible rows', () => {
    const first = data().rows[0];
    const rows = Array.from({ length: 40 }, (_, i) => ({ ...first, id: `row:${i}`, name: `Company ${i}`, tickers: [`T${i}`], total: i, direct: 40 - i }));
    expect(selectExposureRows(rows, { query: '', sort: { key: 'total', dir: 'desc' }, limit: 20 }).rows[0].total).toBe(39);
    expect(selectExposureRows(rows, { query: '', sort: { key: 'direct', dir: 'desc' }, limit: 20 }).rows[0].direct).toBe(40);
    const found = selectExposureRows(rows, { query: 'T39', sort: { key: 'total', dir: 'desc' }, limit: 20 });
    expect(found.count).toBe(1);
    expect(found.rows[0].id).toBe('row:39');
    expect(selectExposureRows(rows, { query: '037833100', sort: { key: 'total', dir: 'desc' }, limit: 20 }).count).toBe(40);
  });
});
