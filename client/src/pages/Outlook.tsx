import { Link } from 'react-router-dom';
import type { Pace } from '../../../src/engine/projection.ts';
import { Projection } from '../components/Projection.tsx';
import { Empty, ErrorLine, Notice, PageHeader, Skeleton } from '../components/ui.tsx';
import { OUTLOOK_TABS } from '../lib/areas.ts';
import { useApi } from '../lib/useApi.ts';

interface OutlookResponse {
  today: string;
  value: number;
  transactionCount: number;
  pace: Pace;
  flagged: { ticker: string; flag: string }[];
}

export default function Outlook() {
  const { data, error, loading } = useApi<OutlookResponse>('/api/outlook');
  const header = <PageHeader tabs={OUTLOOK_TABS}>A range of where the portfolio could go. Not a forecast.</PageHeader>;
  if (error && !data) return <>{header}<ErrorLine error={error} /></>;
  if (!data) return <>{header}<Skeleton rows={10} /></>;
  if (data.transactionCount === 0) {
    return (
      <>
        {header}
        <Empty title="Nothing to look ahead from yet">
          Add trades under{' '}
          <Link to="/data/transactions" className="font-medium text-accent underline-offset-2 hover:underline">Activity</Link>.
        </Empty>
      </>
    );
  }
  return (
    <div className={loading ? 'opacity-90 transition-opacity' : 'transition-opacity'}>
      {header}
      {data.flagged.length > 0 && (
        <div className="mb-5">
          <Notice tone="warn" title={`${data.flagged.length} holding${data.flagged.length > 1 ? 's have' : ' has'} no live price`}>
            {data.flagged.map((f) => f.ticker).join(', ')}: valued at the last stored close, or at cost, so the figures here are approximate.
          </Notice>
        </div>
      )}
      <Projection value={data.value} pace={data.pace} today={data.today} />
    </div>
  );
}
