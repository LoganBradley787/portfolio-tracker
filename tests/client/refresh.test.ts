import { afterEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ effects: [] as (() => unknown)[], version: vi.fn(), api: vi.fn() }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [initial, initial === 0 ? hooks.version : vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => unknown) => { hooks.effects.push(fn); },
}));
vi.mock('../../client/src/lib/api.ts', () => ({ api: hooks.api }));
import { RefreshProvider } from '../../client/src/lib/refresh.tsx';

const status = (finishedAt: string | null, state = 'idle') => ({
  status: { state, finishedAt: null }, holdingsRefresh: { state, finishedAt },
});

afterEach(() => { vi.useRealTimers(); hooks.effects.length = 0; vi.clearAllMocks(); });

it('establishes a baseline on first poll and bumps only for a later completion', async () => {
  vi.useFakeTimers();
  hooks.api.mockResolvedValue(status('2026-10-03T16:00:00Z'));
  RefreshProvider({ children: null });
  hooks.effects[0]();
  await vi.advanceTimersByTimeAsync(0);
  expect(hooks.version).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(hooks.version).not.toHaveBeenCalled();
  hooks.api.mockResolvedValue(status('2026-10-03T17:00:00Z'));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(hooks.version).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(hooks.version).toHaveBeenCalledTimes(1);
});
