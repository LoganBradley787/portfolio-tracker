// How the portfolio is split: by sector (funds looked through), asset type or
// position. A ring for the shape, a ruled table for the figures.
import { Link } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { Slice } from '../../../src/engine/allocation.ts';
import { useChartColors } from '../components/charts.tsx';
import { Table } from '../components/Table.tsx';
import { TickerLink } from '../components/TickerLink.tsx';
import { Empty, ErrorLine, Note, PageHeader, Section, Segmented, Skeleton } from '../components/ui.tsx';
import { PORTFOLIO_TABS } from '../lib/areas.ts';
import { money, pct } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { usePersistent } from '../lib/usePersistentRange.ts';
import type { PortfolioResponse } from './Overview.tsx';

type AllocView = 'byPosition' | 'byAssetType' | 'bySector';

/** Ring colours: the four series, then steps of ink. Unassigned is always grey. */
const RING = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'oklch(0.30 0.02 262)', 'oklch(0.50 0.03 262)', 'oklch(0.66 0.03 262)', 'oklch(0.78 0.02 262)'];

export default function Allocation() {
  const { data, error } = useApi<PortfolioResponse>('/api/portfolio');
  const [view, setView] = usePersistent<AllocView>('allocation', 'bySector');
  const [funds, setFunds] = usePersistent<'split' | 'whole'>('allocationFunds', 'split');
  const c = useChartColors();

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
  const total = slices.reduce((a, s) => a + s.value, 0);
  const unassigned = allocation.bySector.find((s) => s.label === 'Unassigned');
  const colour = (s: Slice, i: number) => (s.label === 'Unassigned' ? c.muted : RING[i % RING.length]);
  const ring = slices.map((s, i) => ({ ...s, fill: colour(s, i) }));
  const groupLabel = { bySector: 'Sector', byAssetType: 'Asset type', byPosition: 'Position' }[view];
  const countInfo =
    view === 'bySector'
      ? funds === 'split'
        ? 'Holdings with money in the sector, counting a fund once for each sector it holds. A fund that spans ten sectors counts in ten rows.'
        : 'Holdings in the group.'
      : 'Holdings in the group.';

  return (
    <div>
      {header}
      <div className="grid grid-cols-1 gap-x-14 gap-y-10 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <figure aria-label={`Allocation by ${groupLabel.toLowerCase()}`} className="relative m-0 h-[22rem]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={ring} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="96%" paddingAngle={1.5} stroke={c.surface} strokeWidth={2} isAnimationActive={false} startAngle={90} endAngle={-270}>
                {ring.map((s) => (
                  <Cell key={s.label} fill={s.fill} />
                ))}
              </Pie>
              <Tooltip
                isAnimationActive={false}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const s = payload[0].payload as Slice;
                  return (
                    <div className="rounded-md border border-rule-strong/50 bg-surface px-3.5 py-2.5 shadow-[0_6px_20px_rgb(10_20_40/0.12)]">
                      <p className="text-[13px] font-medium text-muted">{s.label}</p>
                      <p className="num text-[18px] font-semibold text-ink">{pct(s.pct, { signed: false })}</p>
                      <p className="num text-[14px] text-muted">{money(s.value)}</p>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <figcaption className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="num text-[24px] font-semibold tracking-tight text-ink">{money(total, { whole: true })}</span>
            <span className="text-[13px] font-medium text-muted">{slices.length} {view === 'byPosition' ? 'positions' : 'groups'}</span>
          </figcaption>
        </figure>

        <Section
          flush
          title={`By ${groupLabel.toLowerCase()}`}
          info={
            view === 'bySector' && funds === 'split'
              ? 'Each fund’s value is spread across the sectors, bonds and cash it holds, using its published holdings. Funds with no breakdown yet stay under ETFs.'
              : view === 'bySector'
                ? 'Stocks by their sector; every fund counted whole under ETFs.'
                : view === 'byAssetType'
                  ? 'Stocks and funds as two groups.'
                  : 'Each position’s share of the market value.'
          }
        >
          <Table
            caption={`Allocation by ${groupLabel.toLowerCase()}`}
            rows={ring}
            rowKey={(s) => s.label}
            columns={[
              {
                key: 'label',
                label: groupLabel,
                sort: (s) => s.label,
                render: (s) => (
                  <span className="inline-flex items-center gap-2.5">
                    <span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: s.fill }} />
                    {view === 'byPosition' ? <TickerLink ticker={s.label} /> : <span className={s.label === 'Unassigned' ? 'text-muted italic' : 'font-medium'}>{s.label}</span>}
                  </span>
                ),
              },
              { key: 'value', label: 'Value', numeric: true, sort: (s) => s.value, render: (s) => money(s.value) },
              {
                key: 'pct',
                label: 'Share',
                numeric: true,
                sort: (s) => s.pct,
                render: (s) => (
                  <span className="inline-flex items-center justify-end gap-3">
                    <span className="w-16 font-semibold">{pct(s.pct, { signed: false })}</span>
                    <span aria-hidden className="hidden h-3 w-32 overflow-hidden rounded-[2px] bg-rule/80 sm:block">
                      <span className="block h-full" style={{ width: `${(s.pct / Math.max(...slices.map((x) => x.pct), 1e-9)) * 100}%`, background: s.fill }} />
                    </span>
                  </span>
                ),
              },
              ...(view !== 'byPosition'
                ? [{ key: 'count', label: 'Holdings', title: countInfo, numeric: true, sort: (s: Slice) => s.count, render: (s: Slice) => <span className="text-muted" title={countInfo}>{s.count}</span> }]
                : []),
            ]}
          />
          {view === 'bySector' && unassigned && (
            <Note>
              {unassigned.count} stock{unassigned.count > 1 ? 's have' : ' has'} no sector.{' '}
              <Link to="/data/securities" className="font-semibold text-accent hover:underline">
                Set sectors
              </Link>
            </Note>
          )}
        </Section>
      </div>
    </div>
  );
}
