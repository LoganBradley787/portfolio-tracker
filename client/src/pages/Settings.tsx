// Settings: the few choices that change how every number is computed or
// shown. Rarely touched, so they live behind the gear, not in the top bar.
import { PageTitle, Segmented } from '../components/ui.tsx';
import { useMethod, type Method } from '../lib/method.tsx';

export default function Settings() {
  const { method, setMethod } = useMethod();
  return (
    <div className="max-w-3xl">
      <PageTitle title="Settings" />
      <Setting
        title="Cost basis"
        control={
          <Segmented<Method>
            label="Cost basis method"
            size="md"
            value={method}
            onChange={setMethod}
            options={[
              { value: 'average', label: 'Average cost' },
              { value: 'fifo', label: 'FIFO' },
            ]}
          />
        }
      >
        <p>
          <strong className="font-semibold text-ink">Average cost</strong> pools every purchase of a ticker, the way the spreadsheet does. A sale removes the average.
        </p>
        <p className="mt-2">
          <strong className="font-semibold text-ink">FIFO</strong> keeps each purchase as its own lot and sells the oldest lot in the account first, which is how most brokers report taxes. Lots and holding periods appear under Activity → Taxes.
        </p>
        <p className="mt-2">Every cost, gain and realized figure follows this choice. Market value does not change.</p>
      </Setting>
    </div>
  );
}

function Setting({ title, control, children }: { title: string; control: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-x-10 gap-y-3 border-t border-rule-strong/60 py-6 md:grid-cols-[14rem_1fr]">
      <div>
        <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
        <div className="mt-3">{control}</div>
      </div>
      <div className="text-[14px] leading-relaxed text-muted">{children}</div>
    </section>
  );
}
