import { describe, expect, it } from 'vitest';
import { contributionPace, project } from '../../src/engine/projection.ts';

const base = { value: 100_000, monthly: 1_000, years: 30, realReturn: 0.05, volatility: 0.16 };

describe('projection', () => {
  it('compounds exactly when there is no volatility', () => {
    const p = project({ ...base, years: 2, volatility: 0 });
    const g = 1.05 ** (1 / 12);
    let v = 100_000;
    for (let m = 0; m < 24; m++) v = v * g + 1_000;
    expect(p.years).toHaveLength(2);
    expect(p.years[1].p10).toBeCloseTo(v, 4);
    expect(p.years[1].p90).toBeCloseTo(v, 4);
    expect(p.years[1].contributed).toBe(124_000);
    expect(project({ ...base, years: 1, monthly: 0, volatility: 0 }).years[0].p50).toBeCloseTo(105_000, 4);
  });

  it('gives the same range every time, in order, widening with the years', () => {
    const a = project(base);
    expect(project(base)).toEqual(a);
    expect(project({ ...base, seed: 2 })).not.toEqual(a);
    for (const y of a.years) {
      expect(y.p10).toBeLessThan(y.p25);
      expect(y.p25).toBeLessThan(y.p50);
      expect(y.p50).toBeLessThan(y.p75);
      expect(y.p75).toBeLessThan(y.p90);
    }
    expect(a.years[29].p90 / a.years[29].p10).toBeGreaterThan(a.years[4].p90 / a.years[4].p10);
  });

  it('matches the assumed average return and sits below it at the median', () => {
    const p = project({ value: 100_000, monthly: 0, years: 10, realReturn: 0.05, volatility: 0.16, paths: 20_000 });
    // The median of a lognormal: exp(10 × mu), under the 1.05^10 mean.
    const mu = Math.log(1.05) - Math.log(1 + (0.16 / 1.05) ** 2) / 2;
    expect(p.years[9].p50 / (100_000 * Math.exp(10 * mu))).toBeCloseTo(1, 1);
    expect(p.years[9].p50).toBeLessThan(100_000 * 1.05 ** 10);
  });

  it('reports when a target is likely reached', () => {
    const p = project({ ...base, target: 500_000 });
    expect(p.targetYear).not.toBeNull();
    const at = p.years[p.targetYear! - 1];
    expect(at.reached).toBeGreaterThanOrEqual(0.5);
    expect(at.p50).toBeGreaterThanOrEqual(500_000);
    if (p.targetYear! > 1) expect(p.years[p.targetYear! - 2].reached).toBeLessThan(0.5);
    expect(p.years[0].reached).toBe(0);
    expect(project({ ...base, target: 1e12 }).targetYear).toBeNull();
    expect(project({ ...base, target: 50_000 }).targetYear).toBe(1);
    expect(project({ ...base, target: null }).years[0].reached).toBeNull();
    expect(project({ ...base, target: 0 })).toMatchObject({ targetYear: null });
  });

  it('never goes below zero when money is taken out', () => {
    const p = project({ ...base, value: 10_000, monthly: -1_000, years: 5 });
    expect(p.years[4].p10).toBe(0);
    expect(project({ ...base, years: 0 }).years).toEqual([]);
  });
});

describe('contribution pace', () => {
  const month = (period: string, net: number) => ({ period, buys: Math.max(net, 0), sells: Math.max(-net, 0), net });

  it('averages the last twelve complete months, leaving out the current one', () => {
    const months = [month('2024-08', 99_999), ...Array.from({ length: 12 }, (_, i) => month(`${i < 4 ? 2024 : 2025}-${String(((i + 8) % 12) + 1).padStart(2, '0')}`, i === 0 ? 2_400 : 0)), month('2025-09', 50_000)];
    expect(months[1].period).toBe('2024-09');
    expect(months[12].period).toBe('2025-08');
    expect(contributionPace(months, '2025-09-15')).toEqual({ monthly: 200, months: 12 });
  });

  it('uses what history there is, sales included', () => {
    expect(contributionPace([month('2025-07', 900), month('2025-08', -300), month('2025-09', 10)], '2025-09-02')).toEqual({ monthly: 300, months: 2 });
    expect(contributionPace([month('2025-09', 10)], '2025-09-02')).toEqual({ monthly: 0, months: 0 });
    expect(contributionPace([], '2025-09-02')).toEqual({ monthly: 0, months: 0 });
  });
});
