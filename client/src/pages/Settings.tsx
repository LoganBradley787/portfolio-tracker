import { PageTitle, Section, Segmented } from '../components/ui.tsx';
import { useMethod, type Method } from '../lib/method.tsx';

export default function Settings() {
  const { method, setMethod } = useMethod();
  return (
    <div>
      <PageTitle title="Settings">Saved in this browser.</PageTitle>
      <Section title="Cost basis method">
        <Segmented<Method>
          label="Cost basis method"
          value={method}
          onChange={setMethod}
          options={[
            { value: 'average', label: 'Average cost' },
            { value: 'fifo', label: 'FIFO' },
          ]}
        />
        <p className="mt-3 max-w-prose text-[13px] text-muted">
          Used for every cost, gain and realized figure. Average cost pools each ticker’s purchases, as the spreadsheet does. FIFO keeps each
          purchase as its own lot and sells the oldest first within an account, which is how brokers usually report stock and ETF sales for
          tax. The two only differ after selling part of a position bought at different prices. The sale preview, the long-term lot list and
          tax years always use FIFO lots.
        </p>
      </Section>
    </div>
  );
}
