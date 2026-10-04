import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { testApp } from '../helpers/server.ts';
import Performance from '../../client/src/pages/Performance.tsx';

const state = vi.hoisted(() => ({
  performance: null as any,
  series: null as any,
  changed: null as null | ((ticker: string | null) => void),
  setHidden: vi.fn(),
}));
vi.mock('../../client/src/lib/useApi.ts', () => ({
  useApi: (path: string) => ({
    data: path === '/api/config' ? { today: '2026-10-02', customBenchmark: 'OLD' }
      : path?.startsWith('/api/series') ? state.series : state.performance,
    loading: false, error: null,
  }),
}));
vi.mock('../../client/src/lib/usePersistentRange.ts', () => ({
  usePersistentRange: () => [{ preset: 'All' }, vi.fn()],
  usePersistent: () => [['OLD', 'NEW', 'VT'], state.setHidden],
}));
vi.mock('../../client/src/components/CustomBenchmark.tsx', () => ({
  CustomBenchmark: (props: { onChanged: (ticker: string | null) => void }) => {
    state.changed = props.onChanged;
    return null;
  },
}));
vi.mock('../../client/src/components/charts.tsx', () => ({
  axisMoney: vi.fn(), Legend: () => null, LineChartFrame: () => null, Sparkline: () => null,
  useChartColors: () => ({ s1: '', s2: '', s3: '', s4: '', muted: '' }),
}));

const render = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Performance)));
beforeAll(async () => {
  const { seed, call } = testApp();
  await seed();
  state.performance = (await call('GET', '/api/performance')).body;
  state.series = (await call('GET', '/api/series')).body;
});

describe('performance interactions', () => {
  it('shows the money-added section and distinguishes growth from cost basis', () => {
    const html = render();
    expect(html).toContain('Money added over time');
    expect(html).toContain('Net money added');
    expect(html).toContain('Growth');
    expect(html).toContain('Reinvested dividends are excluded');
    expect(html).toContain('All history through today');
  });

  it('unhides the saved benchmark rather than the stale configured ticker', () => {
    render();
    state.changed!('NEW');
    expect(state.setHidden).toHaveBeenLastCalledWith(['OLD', 'VT']);
  });

  it('keeps line visibility unchanged when removing a custom benchmark', () => {
    render();
    state.setHidden.mockClear();
    state.changed!(null);
    expect(state.setHidden).not.toHaveBeenCalled();
  });

  it('shows the available SPY subtotal and counts excluded positions', () => {
    const original = state.performance.contribution;
    state.performance.contribution = [
      { ...original[0], ticker: 'ONE', aheadOfSpy: 1234 },
      { ...original[0], ticker: 'TWO', aheadOfSpy: -34 },
      { ...original[0], ticker: 'MISSING', aheadOfSpy: null },
    ];
    try {
      const html = render();
      const start = html.indexOf('Contribution by position</caption>');
      const footer = html.slice(html.indexOf('<tfoot', start), html.indexOf('</tfoot>', start));
      expect(footer).toContain('+$1,200.00');
      expect(html).toContain('1 position excluded');
    } finally {
      state.performance.contribution = original;
    }
  });
  it.each([
    [0, '2 positions excluded'],
    [2, null],
  ])('shows an honest total with %i available positions', (available, warning) => {
    const original = state.performance.contribution;
    state.performance.contribution = original.slice(0, 2).map((r: any, i: number) => ({
      ...r, aheadOfSpy: i < available ? 100 : null,
    }));
    try {
      const html = render();
      const start = html.indexOf('Contribution by position</caption>');
      const footer = html.slice(html.indexOf('<tfoot', start), html.indexOf('</tfoot>', start));
      if (available) expect(footer).toContain('+$200.00');
      else expect(footer).not.toContain('+$0.00');
      if (warning) expect(html).toContain(warning);
      else expect(html).not.toContain('positions excluded');
    } finally {
      state.performance.contribution = original;
    }
  });

});
