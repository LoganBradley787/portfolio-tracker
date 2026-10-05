import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, expect, it, vi } from 'vitest';
import { testApp } from '../helpers/server.ts';
import Ticker from '../../client/src/pages/Ticker.tsx';

const state = vi.hoisted(() => ({ detail: null as any, loading: false }));
vi.mock('react-router-dom', async (importActual) => ({
  ...await importActual<typeof import('react-router-dom')>(), useParams: () => ({ ticker: 'SHOP' }),
}));
vi.mock('../../client/src/lib/useApi.ts', () => ({
  useApi: (path: string) => ({ data: path === '/api/config' ? { today: '2026-10-02' } : state.detail,
    loading: state.loading, error: null }),
}));
vi.mock('../../client/src/lib/usePersistentRange.ts', () => ({
  usePersistentRange: () => [{ preset: 'All' }, vi.fn()],
  usePersistent: (key: string, initial: unknown) => [key === 'ticker:tab' ? 'sell' : initial, vi.fn()],
}));
vi.mock('../../client/src/components/charts.tsx', () => ({
  axisMoney: vi.fn(), LineChartFrame: () => null, useChartColors: () => ({ s1: '' }),
}));
beforeAll(async () => {
  const { seed, call } = testApp();
  await seed();
  state.detail = (await call('GET', '/api/ticker/SHOP')).body;
});

it('keeps the sale form present while ticker data refetches in the background', () => {
  const render = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Ticker)));
  expect(render()).toContain('Shares to sell');
  state.loading = true;
  try {
    expect(render()).toContain('Shares to sell');
    expect(render()).toContain('If sold today');
  } finally {
    state.loading = false;
  }
});
