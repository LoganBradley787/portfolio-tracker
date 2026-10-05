import { isValidElement, type ReactElement } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SellPreview } from '../../client/src/components/SellPreview.tsx';
import { Table } from '../../client/src/components/Table.tsx';
import { Stat } from '../../client/src/components/ui.tsx';

// Retain hook state across renders to exercise account and quantity handlers.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('react', async (importActual) => ({
  ...await importActual<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (value: unknown) => { hooks.values[i] = value; }];
  },
}));
beforeEach(() => { hooks.values = []; hooks.cursor = 0; });
const input = { today: '2026-10-03', averageCost: 25,
  price: { price: 30, prevClose: null, asOf: '2026-10-02', source: 'close' as const },
  lots: [{ acquired: '2024-01-01', account: 'A', shares: 7, cost: 70 },
    { acquired: '2025-01-01', account: 'B', shares: 3, cost: 60 },
    { acquired: '2026-01-01', account: 'C', shares: 2, cost: 80 }] };
function elements(node: unknown): ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const e = node as ReactElement<any>;
  return [e, ...elements(e.props.children)];
}
const render = (data = input) => {
  hooks.cursor = 0;
  return elements(SellPreview({ input: data, method: 'average' }));
};

it('resets to the chosen account’s shares, changes its lot rows, and rejects an account oversell', () => {
  let tree = render();
  expect(tree.find((e) => e.type === 'input')!.props.value).toBe('7');
  tree.find((e) => e.type === 'input')!.props.onChange({ target: { value: '1.5' } });
  tree.find((e) => e.type === 'select')!.props.onChange({ target: { value: 'B' } });
  tree = render();
  expect(tree.find((e) => e.type === 'input')!.props.value).toBe('3');
  expect(tree.find((e) => e.type === 'input')!.props.max).toBe(3);
  expect(tree.find((e) => e.type === Table)!.props.rows.map((l: any) => l.account)).toEqual(['B']);
  tree.find((e) => e.type === 'input')!.props.onChange({ target: { value: '4' } });
  tree = render();
  expect(tree.some((e) => e.props.role === 'alert')).toBe(true);
  expect(tree.some((e) => e.type === Table)).toBe(false);
});

it('keeps the typed quantity and account during a price/holdings refresh while updating totals', () => {
  let tree = render();
  tree.find((e) => e.type === 'input')!.props.onChange({ target: { value: '1.5' } });
  const refreshed = { ...input, price: { ...input.price, price: 40 },
    lots: input.lots.map((l) => l.account === 'B' ? { ...l, shares: 10 } : l) };
  tree = render(refreshed);
  expect(tree.find((e) => e.type === 'input')!.props.value).toBe('1.5');
  expect(tree.find((e) => e.type === 'select')!.props.value).toBe('A');
  expect(tree.find((e) => e.type === Table)!.props.rows.map((l: any) => l.account)).toEqual(['A']);
  expect(tree.find((e) => e.type === Stat && e.props.label === 'Proceeds')!.props.value).toBe('$60.00');
});
