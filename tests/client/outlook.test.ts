import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { testApp } from '../helpers/server.ts';
import Outlook from '../../client/src/pages/Outlook.tsx';
import { WhatMoved } from '../../client/src/components/WhatMoved.tsx';
import { DropFolder } from '../../client/src/components/DropFolder.tsx';

const state = vi.hoisted(() => ({ outlook: null as any, movers: null as any, saved: {} as Record<string, unknown> }));
vi.mock('../../client/src/lib/useApi.ts', () => ({
  useApi: (path: string) => ({ data: path === '/api/movers' ? state.movers : state.outlook, loading: false, error: null }),
}));
vi.mock('../../client/src/lib/usePersistentRange.ts', () => ({
  usePersistent: (key: string, initial: unknown) => [state.saved[key] ?? initial, vi.fn()],
}));
vi.mock('../../client/src/components/charts.tsx', () => ({ axisMoney: vi.fn(), FanChart: () => null }));

const render = (el: any) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(el)));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

beforeAll(async () => {
  const { seed, call, ctx } = testApp();
  await seed(['QQQM\tETF\tBuy\t1\t\t200\t3/2/2026\tMain']);
  ctx.q.saveFundSectors('QQQM', { stock: 1, bond: 0, sectors: { Technology: 1 }, expenseRatio: 0.0015 }, '2026-10-01T00:00:00.000Z');
  state.outlook = (await call('GET', '/api/outlook')).body;
  state.movers = (await call('GET', '/api/movers')).body;
});

describe('Outlook page', () => {
  it('projects from the recent pace and says what the range assumes', () => {
    const html = text(render(Outlook));
    expect(html).toContain('Where this could go');
    expect(html).toContain('Your pace: net money added over the last 12 complete months');
    expect(html).toContain('Middle outcome in 2046');
    expect(html).toContain('8 in 10 outcomes');
    expect(html).toContain('A range, not a forecast');
    expect(html).toContain('average 5% a year after inflation');
    expect(html).not.toContain('Reaches target');
    expect(html).toMatch(/2031 .*2036 .*2041 .*2046/);
  });

  it('shows a target, a typed monthly amount and the chosen horizon', () => {
    state.saved.outlookProjection = { monthly: 2500, years: '10', realReturn: '0.07', target: 250000 };
    try {
      const html = text(render(Outlook));
      expect(html).toContain('Middle outcome in 2036');
      expect(html).toContain('Reaching $250,000');
      expect(html).toContain('Reaches target');
      expect(html).toContain('plus $2,500 a month');
      expect(html).toContain('Use my pace ($17 a month)');
      expect(html).toContain('average 7% a year');
    } finally {
      delete state.saved.outlookProjection;
    }
  });

  it('lists expected dividend income and fund fees', () => {
    const html = text(render(Outlook));
    expect(html).toContain('Next 12 months (estimate)');
    expect(html).toContain('Every dividend is reinvested');
    expect(html).toContain('Dividends received by year');
    expect(html).toContain('2026 so far');
    expect(html).toContain('Fees a year');
    expect(html).toContain('0.15%');
    expect(html).toContain('Cost over 30 years');
    expect(html).not.toContain('No fee is known yet');
  });

  it('says so when a fund has no published fee or nothing is held', () => {
    const original = state.outlook;
    state.outlook = { ...original, fees: { ...original.fees, rows: [{ ticker: 'QQQM', value: 100, expenseRatio: null, annualCost: null }], annualCost: 0, missing: ['QQQM'] } };
    expect(text(render(Outlook))).toContain('No fee is known yet for QQQM, so it is left out of the totals');
    state.outlook = { ...original, fees: { ...original.fees, rows: [] }, income: { rows: [], annual: 0, value: 0, yield: null, received: [] } };
    const none = text(render(Outlook));
    expect(none).toContain('No funds held');
    expect(none).toContain('No dividends yet');
    state.outlook = { ...original, transactionCount: 0 };
    expect(text(render(Outlook))).toContain('Nothing to look ahead from yet');
    state.outlook = original;
  });
});

describe('What moved', () => {
  it('ranks the day’s movers and offers the rest', () => {
    const html = text(render(WhatMoved));
    const day = state.movers.periods.day;
    expect(html).toContain('What moved');
    expect(html).toContain('Oct 2, 2026:');
    expect(html.indexOf(day.movers[0].ticker)).toBeLessThan(html.indexOf(day.movers.at(-1).ticker));
    expect(html).not.toContain('Show all');
    state.saved.movers = 'month';
    try {
      const month = text(render(WhatMoved));
      expect(month).toContain(`Show all ${state.movers.periods.month.movers.length}`);
      expect(month).toContain('Sep 3, 2026 – Oct 2, 2026');
    } finally {
      delete state.saved.movers;
    }
  });

  it('renders nothing without holdings', () => {
    const original = state.movers;
    state.movers = { today: '2026-10-02', asOf: null, periods: { day: null, week: null, month: null } };
    expect(render(WhatMoved)).toBe('');
    state.movers = original;
  });
});

describe('Drop folder section', () => {
  const entry = { at: '2026-10-02T16:30:00.000Z', file: 'Taxable/activity.csv', account: 'Taxable', ok: true, inserted: 3, skipped: 2, message: 'Added 3 trades' };
  const html = (inbox: any) => text(renderToStaticMarkup(createElement(DropFolder, { inbox, onChanged: () => {} })));

  it('shows where the folder is, what was imported and what could not be', () => {
    const page = html({ dir: 'data/inbox', recent: [entry], waiting: [{ ...entry, file: 'loose.csv', account: '', ok: false, inserted: 0, skipped: 0, message: 'Move this file into a folder named after its account' }] });
    expect(page).toContain('data/inbox');
    expect(page).toContain('1 file could not be imported');
    expect(page).toContain('loose.csv : Move this file into a folder named after its account.');
    expect(page).toContain('Added 3 trades');
    expect(page).toContain('2 rows left out');
    expect(html({ dir: 'data/inbox', recent: [], waiting: [] })).toContain('No files have been dropped yet');
  });
});
