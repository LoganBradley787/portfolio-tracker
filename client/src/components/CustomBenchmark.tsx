import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { Button, inputClass } from './ui.tsx';

export function CustomBenchmark({ ticker, onChanged }: { ticker: string | null; onChanged: (ticker: string | null) => void }) {
  const [value, setValue] = useState(ticker ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(ticker ?? ''), [ticker]);
  const save = async (next: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await api<{ customBenchmark: string | null }>('/api/benchmark', { method: 'PUT', body: { ticker: next } });
      onChanged(saved.customBenchmark);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3">
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void save(value.trim().toUpperCase()); }}>
        <label htmlFor="custom-benchmark" className="text-[13px] font-semibold text-muted">Your benchmark</label>
        <input
          id="custom-benchmark"
          className={`${inputClass} h-8 uppercase`}
          style={{ width: '7rem' }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={15}
          placeholder="e.g. VOO"
          spellCheck={false}
          aria-invalid={!!error || undefined}
        />
        <Button size="sm" type="submit" busy={busy} disabled={!value.trim() || value.trim().toUpperCase() === ticker}>Use ticker</Button>
        {ticker && <Button size="sm" disabled={busy} onClick={() => void save(null)}>Remove</Button>}
        <span className="text-[13px] text-muted">One more line on the chart and row in the table.</span>
      </form>
      {error && <p role="alert" className="mt-2 text-[13px] text-loss">{error}</p>}
    </div>
  );
}
