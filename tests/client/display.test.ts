import { afterEach, describe, expect, it } from 'vitest';
import { display, HIDDEN } from '../../client/src/lib/display.ts';
import { money, pct, shares } from '../../client/src/lib/format.ts';
import { axisMoney } from '../../client/src/components/charts.tsx';
import { withMethod } from '../../client/src/lib/method.tsx';

afterEach(() => display.set({ mode: 'real' }));

describe('figures shown hidden or scaled', () => {
  it('shows amounts and share counts as they are by default', () => {
    expect(money(1234.5)).toBe('$1,234.50');
    expect(shares(10.5)).toBe('10.5');
    expect(axisMoney(12_500)).toBe('$12.5k');
  });

  it('hides amounts and share counts, keeps percentages and prices', () => {
    display.set({ mode: 'hidden' });
    expect(money(1234.5)).toBe(HIDDEN);
    expect(money(-50, { signed: true })).toBe(HIDDEN);
    expect(shares(10.5)).toBe(HIDDEN);
    expect(axisMoney(12_500)).toBe('');
    expect(pct(0.1234)).toBe('+12.34%');
    expect(money(99.5, { asIs: true })).toBe('$99.50');
  });

  it('multiplies amounts and share counts by the factor, prices untouched', () => {
    display.set({ mode: 'scaled', factor: 10 });
    expect(money(1234.5)).toBe('$12,345.00');
    expect(money(-50, { signed: true })).toBe('−$500.00');
    expect(shares(10.5)).toBe('105');
    expect(axisMoney(12_500)).toBe('$125k');
    expect(money(99.5, { asIs: true })).toBe('$99.50');
    expect(pct(0.1)).toBe('+10.00%');
  });

  it('sends drip=off alongside the cost method on calculation requests only', () => {
    expect(withMethod('/api/portfolio', 'fifo', false)).toBe('/api/portfolio?drip=off');
    expect(withMethod('/api/series?from=2026-01-01', 'average', false)).toBe('/api/series?from=2026-01-01&method=average&drip=off');
    expect(withMethod('/api/config', 'fifo', false)).toBe('/api/config');
    expect(withMethod('/api/movers', 'fifo', true)).toBe('/api/movers');
  });
});
