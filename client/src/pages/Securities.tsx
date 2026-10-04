import { TickerLink } from '../components/TickerLink.tsx';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Security } from '../../../src/db/queries.ts';
import { Button, Empty, ErrorLine, inputClass, PageTitle, Segmented, Skeleton } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { date } from '../lib/format.ts';
import { useRefresh } from '../lib/refresh.tsx';
import { useApi } from '../lib/useApi.ts';

type Sec = Security & { traded: boolean };

export default function Securities() {
  const { data, error, reload } = useApi<{ securities: Sec[] }>('/api/securities');
  const { bump } = useRefresh();
  const rows = useMemo(() => (data?.securities ?? []).filter((s) => s.traded), [data]);
  const sectors = useMemo(() => [...new Set(rows.map((s) => s.sector).filter((x): x is string => !!x))].sort(), [rows]);

  if (!data) return error ? <ErrorLine error={error} /> : <Skeleton rows={8} />;
  return (
    <div>
      <PageTitle title="Securities" aside={<Link to="/health" className="text-[13px] font-medium text-accent hover:underline">Data health</Link>}>
        Name, sector and asset type for each ticker you have traded. Sectors drive the allocation on Overview; ETFs are always their own group.
      </PageTitle>
      <datalist id="sectors">
        {sectors.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {rows.length ? (
        <div className="relative overflow-x-auto rounded-md border border-rule bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">Securities</caption>
            <thead>
              <tr className="border-b border-rule-strong text-left text-xs text-muted">
                {['Ticker', 'Name', 'Sector', 'Asset type', 'Provider symbol', 'Prices', ''].map((h, i) => (
                  <th key={i} scope="col" className={`px-2.5 py-2 font-medium first:pl-3.5 last:pr-3.5 ${i === 5 ? 'hidden lg:table-cell' : ''}`}>
                    {h || <span className="sr-only">Save</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((sec) => (
                <SecurityRow
                  key={sec.ticker}
                  sec={sec}
                  onSaved={async () => {
                    await reload();
                    bump();
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No securities yet">They appear here once you add or import transactions.</Empty>
      )}
    </div>
  );
}

function SecurityRow({ sec, onSaved }: { sec: Sec; onSaved: () => void }) {
  const initial = { name: sec.name ?? '', sector: sec.sector ?? '', assetType: sec.assetType, providerSymbol: sec.providerSymbol };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const save = async () => {
    if (!dirty) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/securities/${sec.ticker}`, { method: 'PUT', body: form });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void save();
  };
  const cell = 'px-2.5 py-1.5 first:pl-3.5 last:pr-3.5';
  return (
    <tr className="border-b border-rule last:border-b-0">
      <td className={cell}><TickerLink ticker={sec.ticker} /></td>
      <td className={`${cell} min-w-40`}>
        <input aria-label={`Name of ${sec.ticker}`} placeholder="Name" className={`${inputClass} h-7`} value={form.name} onKeyDown={onEnter} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </td>
      <td className={`${cell} min-w-36`}>
        <input
          aria-label={`Sector of ${sec.ticker}`}
          placeholder={form.assetType === 'ETF' ? 'ETFs (own group)' : 'Sector'}
          list="sectors"
          disabled={form.assetType === 'ETF'}
          className={`${inputClass} h-7 disabled:opacity-60`}
          value={form.sector}
          onKeyDown={onEnter}
          onChange={(e) => setForm({ ...form, sector: e.target.value })}
        />
      </td>
      <td className={cell}>
        <Segmented label={`Asset type of ${sec.ticker}`} value={form.assetType} onChange={(v) => setForm({ ...form, assetType: v })} options={[{ value: 'Stock', label: 'Stock' }, { value: 'ETF', label: 'ETF' }]} />
      </td>
      <td className={`${cell} w-28`}>
        <input aria-label={`Provider symbol for ${sec.ticker}`} className={`${inputClass} h-7 uppercase`} value={form.providerSymbol} onKeyDown={onEnter} onChange={(e) => setForm({ ...form, providerSymbol: e.target.value })} spellCheck={false} />
      </td>
      <td className={`${cell} hidden whitespace-nowrap lg:table-cell ${sec.status === 'ok' ? 'text-muted' : 'text-warn'}`}>
        {sec.status === 'ok' ? `through ${date(sec.historyThrough)}` : sec.status === 'pending' ? 'Pending' : 'Unresolved'}
      </td>
      <td className={`${cell} w-24 text-right whitespace-nowrap`}>
        {dirty ? (
          <Button size="sm" variant="primary" busy={busy} onClick={() => void save()}>
            Save
          </Button>
        ) : saved ? (
          <span className="text-xs text-muted" role="status">
            Saved
          </span>
        ) : null}
        {err && (
          <span className="block text-xs text-loss" role="alert">
            {err}
          </span>
        )}
      </td>
    </tr>
  );
}
