import { Link } from 'react-router-dom';
import type { FeeSummary } from '../../../src/engine/fees.ts';
import type { Pace } from '../../../src/engine/projection.ts';
import { DividendIncome, type Income } from '../components/DividendIncome.tsx';
import { FundFees } from '../components/FundFees.tsx';
import { Projection } from '../components/Projection.tsx';
import { Empty, ErrorLine, Notice, PageTitle, Skeleton } from '../components/ui.tsx';
import { useApi } from '../lib/useApi.ts';

interface OutlookResponse {
  today: string;
  value: number;
  transactionCount: number;
  pace: Pace;
  income: Income;
  fees: FeeSummary;
  flagged: { ticker: string; flag: string }[];
}

export default function Outlook() {
  const { data, error, loading } = useApi<OutlookResponse>('/api/outlook');
  if (error && !data) return <ErrorLine error={error} />;
  if (!data) return <Skeleton rows={10} />;
  const title = <PageTitle title="Outlook">Where the portfolio could go, what it pays, and what it costs to hold.</PageTitle>;
  if (data.transactionCount === 0) {
    return (
      <>
        {title}
        <Empty title="Nothing to look ahead from yet">
          Add trades on the{' '}
          <Link to="/transactions" className="font-medium text-accent underline-offset-2 hover:underline">Transactions</Link> page.
        </Empty>
      </>
    );
  }
  return (
    <div className={loading ? 'opacity-90 transition-opacity' : 'transition-opacity'}>
      {title}
      {data.flagged.length > 0 && (
        <div className="mb-5">
          <Notice tone="warn" title={`${data.flagged.length} holding${data.flagged.length > 1 ? 's have' : ' has'} no live price`}>
            {data.flagged.map((f) => f.ticker).join(', ')}: valued at the last stored close, or at cost, so the figures here are approximate.
          </Notice>
        </div>
      )}
      <Projection value={data.value} pace={data.pace} today={data.today} />
      <DividendIncome income={data.income} today={data.today} />
      <FundFees fees={data.fees} />
    </div>
  );
}
