import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportPanel } from '../../client/src/pages/Transactions.tsx';
import { api } from '../../client/src/lib/api.ts';
import type { ImportResult } from '../../src/import/parse.ts';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('react', async (importActual) => ({
  ...await importActual<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }];
  },
  useEffect: vi.fn(),
}));
vi.mock('../../client/src/lib/account.tsx', () => ({ useAccount: () => ({ accounts: ['Taxable'] }) }));
vi.mock('../../client/src/lib/api.ts', () => ({ api: vi.fn(), ApiError: Error }));

const preview: ImportResult = {
  source: 'robinhood', rows: [{ row: 2, seq: 1, ticker: 'DIS', assetType: null, type: 'Buy', shares: 2.5,
    price: 90.125, date: '2026-07-08', account: 'Taxable', note: '' }],
  splits: [], errors: [], fileErrors: [], skipped: [{ row: 3, message: 'CDIV: dividends are handled by the app' }],
};
const props = () => ({ hasRows: true, onClose: vi.fn(), onImported: vi.fn() });
function setup(result: ImportResult = preview, account = 'Taxable') {
  hooks.values = ['synthetic CSV text', result, 'replace', account, false, null];
  hooks.cursor = 0;
}
function elements(node: unknown): ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const e = node as ReactElement<any>;
  return [e, ...elements(e.props.children)];
}
const markup = () => renderToStaticMarkup(createElement(ImportPanel, props()));
beforeEach(() => { setup(); vi.clearAllMocks(); });

describe('Robinhood import panel', () => {
  it('offers account selection and skipped rows with append-only broker copy', () => {
    const html = markup();
    expect(html).toContain('Robinhood account activity CSV');
    expect(html).toContain('Account for this file');
    expect(html).toContain('new trade');
    expect(html).toContain('CDIV: dividends are handled by the app');
    expect(html).toContain('Trades already in the app are skipped');
    expect(html).not.toContain('Replace all');
    expect(html).not.toContain('disabled=""');
  });

  it.each(['', '  '])('disables saving without an account (%s)', (account) => {
    setup(preview, account);
    expect(markup()).toContain('disabled=""');
  });

  it('disables saving with an invalid trade and explains how to fix broker rows', () => {
    setup({ ...preview, errors: [{ row: 4, message: 'Quantity must be positive' }] });
    const html = markup();
    expect(html).toContain('disabled=""');
    expect(html).toContain('Fix these rows in the file');
    expect(html).toContain('Quantity must be positive');
  });

  it('shows an unreadable broker file instead of labeling it as a sheet import', () => {
    setup({ ...preview, fileErrors: ['Malformed CSV quoting at line 4'] });
    const html = markup();
    expect(html).toContain('This file can’t be read');
    expect(html).not.toContain('This doesn’t look like the Transactions tab');
  });

  it('sends the chosen account with append mode and reports the saved result', async () => {
    vi.mocked(api).mockResolvedValue({ inserted: 1, splits: 0 });
    const callbacks = props();
    const tree = elements(ImportPanel(callbacks));
    const save = tree.find((e) => e.props.variant === 'primary')!;
    await save.props.onClick();
    expect(api).toHaveBeenCalledWith('/api/import/commit', {
      method: 'POST', body: { text: 'synthetic CSV text', mode: 'append', account: 'Taxable' },
    });
    expect(callbacks.onImported).toHaveBeenCalledWith('Imported 1 transactions.');
  });

  it('retains sheet replacement choices and the Schwab report date range', () => {
    setup({ ...preview, source: undefined, skipped: [] });
    expect(markup()).toContain('Replace all');
    setup({ ...preview, source: 'schwab', range: { from: '2026-01-01', to: '2026-10-03' } });
    const html = markup();
    expect(html).toContain('Schwab export covering');
    expect(html).toContain('Account for this file');
    expect(html).not.toContain('Replace all');
  });
});
