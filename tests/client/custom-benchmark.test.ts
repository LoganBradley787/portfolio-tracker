import { expect, it, vi } from 'vitest';
import { CustomBenchmark } from '../../client/src/components/CustomBenchmark.tsx';
import { api } from '../../client/src/lib/api.ts';

// Exercise the form handlers without mounting a browser or making a request.
vi.mock('react', async (importActual) => ({
  ...await importActual<typeof import('react')>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
}));
vi.mock('../../client/src/lib/api.ts', () => ({ api: vi.fn() }));

it('passes the saved, normalized ticker from the API to its change callback', async () => {
  vi.mocked(api).mockResolvedValue({ customBenchmark: 'VOO' });
  const onChanged = vi.fn();
  const tree = CustomBenchmark({ ticker: 'voo', onChanged });
  const form = tree.props.children[0];
  form.props.onSubmit({ preventDefault: vi.fn() });
  await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith('VOO'));
});
