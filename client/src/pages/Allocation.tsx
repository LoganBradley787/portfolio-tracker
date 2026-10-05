// How the portfolio is split: by sector (funds looked through), asset type or position.
import { Link } from 'react-router-dom';
import type { Slice } from '../../../src/engine/allocation.ts';
import { Empty, ErrorLine, Note, PageHeader, Segmented, Skeleton } from '../components/ui.tsx';
import { PORTFOLIO_TABS } from '../lib/areas.ts';
import { money, pct } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { usePersistent } from '../lib/usePersistentRange.ts';
import type { PortfolioResponse } from './Overview.tsx';

type AllocView = 'byPosition' | 'byAssetType' | 'bySector';

export default function Allocation() {
  const { data, error } = useApi<PortfolioResponse>('/api/portfolio');
  const [view, setView] = usePersistent<AllocView>('allocation', 'bySector');
  const [funds, setFunds] = usePersistent<'split' | 'whole'>('allocationFunds', 'split');

  const header = (
    <PageHeader
      tabs={PORTFOLIO_TABS}
      controls={
        <>
          {view === 'bySector' && data?.allocation.bySector.some((s) => s.label === 'ETFs') && (
            <Segmented<'split' | 'whole'>
              label="Funds"
              value={funds}
              onChange={setFunds}
              options={[
                { value: 'split', label: 'Funds split into sectors' },
                { value: 'whole', label: 'Funds as one group' },
              ]}
            />
          )}
          <Segmented<AllocView>
            label="Group by"
            value={view}
            onChange={setView}
            options={[
              { value: 'bySector', label: 'Sector' },
              { value: 'byAssetType', label: 'Asset type' },
              { value: 'byPosition', label: 'Position' },
            ]}
          />
        </>
      }
    />
  );
  if (error && !data) return <>{header}<ErrorLine error={error} /></>;
  if (!data) return <>{header}<Skeleton rows={10} /></>;
  if (!data.holdings.length) return <>{header}<Empty title="Nothing held">Allocation appears once there are holdings.</Empty></>;

  const allocation = data.allocation;
  const slices: Slice[] = view === 'bySector' && funds === 'split' ? allocation.bySectorSplit : allocation[view] ?? allocation.bySector;
  const max = Math.max(...slices.map((s) => s.pct), 1e-9);
  const unassigned = allocation.bySector.find((s) => s.label === 'Unassigned');
  return (
    <div>
      {header}
      <ul className="divide-y divide-rule border-y border-rule-strong/60">
        {slices.map((s) => (
          <li key={s.label} className="grid grid-cols-[minmax(8rem,15rem)_1fr_auto_auto] items-center gap-x-5 py-2.5 text-[13px]">
            <span className={`truncate ${s.label === 'Unassigned' ? 'text-muted italic' : 'font-medium'}`}>
              {s.label}
              {view !== 'byPosition' && <span className="ml-1.5 text-xs font-normal text-faint not-italic">{s.count}</span>}
            </span>
            <span aria-hidden className="h-2.5">
              <span className={`block h-full ${s.label === 'Unassigned' ? 'bg-[var(--series-muted)]' : 'bg-ink/70'}`} style={{ width: `${(s.pct / max) * 100}%`, minWidth: 2 }} />
            </span>
            <span className="num w-28 text-right text-muted">{money(s.value)}</span>
            <span className="num w-16 text-right font-medium">{pct(s.pct, { signed: false })}</span>
          </li>
        ))}
      </ul>
      {view === 'bySector' && funds === 'split' && (
        <Note>
          Each fund’s value is spread across the sectors, bonds and cash it holds. Counts are holdings with money in the sector.
          {allocation.bySectorSplit.some((x) => x.label === 'ETFs') && ' Funds with no breakdown yet stay under ETFs.'}
        </Note>
      )}
      {view === 'bySector' && unassigned && (
        <Note>
          {unassigned.count} stock{unassigned.count > 1 ? 's have' : ' has'} no sector.{' '}
          <Link to="/data/securities" className="font-medium text-accent hover:underline">
            Set sectors
          </Link>
        </Note>
      )}
    </div>
  );
}
