import { describe, expect, it } from 'vitest';
import { monthlyNeeded, project, returnNeeded, steadyValue, yearsToTarget } from '../../src/engine/projection.ts';

describe('what it takes to reach a target', () => {
  it('steady growth matches the simulation with no volatility', () => {
    const p = project({ value: 50_000, monthly: 500, years: 3, realReturn: 0.06, volatility: 0 });
    expect(steadyValue(50_000, 500, 3, 0.06)).toBeCloseTo(p.years[2].p50, 4);
    expect(steadyValue(1_000, 100, 1, 0)).toBe(2_200);
  });

  it('finds the monthly amount that reaches the target, and zero when growth alone does', () => {
    const m = monthlyNeeded(50_000, 200_000, 20, 0.05);
    expect(steadyValue(50_000, m, 20, 0.05)).toBeCloseTo(200_000, 4);
    expect(monthlyNeeded(100_000, 120_000, 10, 0.05)).toBe(0);
    expect(monthlyNeeded(0, 12_000, 1, 0)).toBeCloseTo(1_000, 6);
  });

  it('finds the return that reaches the target, and gives up past 100% a year', () => {
    const r = returnNeeded(50_000, 500, 300_000, 15);
    expect(r).not.toBeNull();
    expect(steadyValue(50_000, 500, 15, r!)).toBeCloseTo(300_000, 2);
    expect(returnNeeded(100_000, 0, 100_000, 10)!).toBeLessThanOrEqual(0);
    expect(returnNeeded(100, 0, 1_000_000, 1)).toBeNull();
    expect(returnNeeded(0, 0, 1_000, 10)).toBeNull();
  });

  it('looks far enough ahead to say when a target is likely', () => {
    const base = { value: 100_000, monthly: 500, realReturn: 0.05, volatility: 0.16 };
    expect(yearsToTarget({ ...base, target: 1_000_000 })).toBeGreaterThan(30);
    expect(yearsToTarget({ ...base, target: 1e9 })).toBeNull();
    expect(yearsToTarget({ ...base, target: 90_000 })).toBe(1);
  });
});
