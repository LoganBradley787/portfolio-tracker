import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/migrate.ts';
import { Queries } from '../../src/db/queries.ts';
import { RequestBudget } from '../../src/market/budget.ts';

describe('RequestBudget', () => {
  it('stops at 45 in a trailing hour and says when it resumes', () => {
    const q = new Queries(openDatabase(':memory:'));
    let now = new Date('2026-10-02T12:00:00.000Z');
    const b = new RequestBudget(q, () => now);
    for (let i = 0; i < 45; i++) {
      expect(b.remaining()).toBe(45 - i);
      b.record('history', 'X', 200, true);
      now = new Date(now.getTime() + 60_000); // one a minute
    }
    // Now 12:45; requests at 12:00 … 12:44.
    expect(b.remaining()).toBe(0);
    expect(b.resumesAt()).toBe('2026-10-02T13:00:00.000Z');
    now = new Date('2026-10-02T13:00:00.001Z');
    expect(b.remaining()).toBe(1);
    expect(b.resumesAt()).toBeNull();
  });

  it('counts failed requests too', () => {
    const q = new Queries(openDatabase(':memory:'));
    const now = new Date('2026-10-02T12:00:00.000Z');
    const b = new RequestBudget(q, () => now, 2);
    b.record('history', 'X', 429, false);
    b.record('history', 'Y', null, false);
    expect(b.remaining()).toBe(0);
  });
});
