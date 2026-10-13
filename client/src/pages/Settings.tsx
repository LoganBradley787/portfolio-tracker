// Settings: the few choices that change how every number is computed or
// shown. Rarely touched, so they live on their own page, not in the top bar.
import { useState, type ReactNode } from 'react';
import { Button, inputClass, PageTitle, Segmented } from '../components/ui.tsx';
import type { Display } from '../lib/display.ts';
import { useDisplay } from '../lib/displayContext.tsx';
import { useMethod, type Method } from '../lib/method.tsx';

export default function Settings() {
  const { method, setMethod, reinvest, setReinvest } = useMethod();
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
              { value: 'fifo', label: 'FIFO' },
              { value: 'average', label: 'Average cost' },
            ]}
          />
        }
      >
        <p>
          <strong className="font-semibold text-ink">FIFO</strong>, the default, keeps each purchase as its own lot and sells the oldest lot in the account first, which is how most brokers report taxes. Lots and holding periods appear under Activity → Taxes.
        </p>
        <p className="mt-2">
          <strong className="font-semibold text-ink">Average cost</strong> pools every purchase of a ticker, the way the spreadsheet does. A sale removes the average.
        </p>
        <p className="mt-2">Every cost, gain and realized figure follows this choice. Market value does not change.</p>
      </Setting>

      <Setting
        title="Dividends"
        control={
          <Segmented<'on' | 'off'>
            label="Dividend reinvestment"
            size="md"
            value={reinvest ? 'on' : 'off'}
            onChange={(v) => setReinvest(v === 'on')}
            options={[
              { value: 'on', label: 'Reinvested' },
              { value: 'off', label: 'Paid as cash' },
            ]}
          />
        }
      >
        <p>
          <strong className="font-semibold text-ink">Reinvested</strong> treats every dividend as buying more of the same ticker, in the account that received it, at the close on the ex-date. Those shares are not in your entered transactions; they are derived here, and they earn later dividends and go when the position is sold.
        </p>
        <p className="mt-2">
          <strong className="font-semibold text-ink">Paid as cash</strong> adds no shares. Dividends still count as income and in the total return, but the share counts, values and cost basis are only what you entered.
        </p>
        <p className="mt-2">Pick whichever matches what your broker actually does.</p>
      </Setting>

      <FiguresSetting />
    </div>
  );
}

/**
 * Real, hidden or scaled figures. Once hidden or scaled, this page says only
 * that they are adjusted, never how, so the setting cannot be read off the
 * screen by someone being shown the app.
 */
function FiguresSetting() {
  const { display, setDisplay } = useDisplay();
  const adjusted = display.mode !== 'real';
  const [choice, setChoice] = useState<Display['mode'] | null>(adjusted ? null : 'real');
  const [factorText, setFactorText] = useState('');
  const factor = Number(factorText.replace(/[x×,\s]/g, ''));
  const factorOk = factorText.trim() !== '' && Number.isFinite(factor) && factor > 0;
  const choose = (mode: Display['mode']) => {
    setChoice(mode);
    if (mode === 'real') setDisplay({ mode: 'real' });
    if (mode === 'hidden') setDisplay({ mode: 'hidden' });
  };
  const apply = () => {
    if (!factorOk) return;
    setDisplay({ mode: 'scaled', factor });
    setFactorText('');
    // Nothing stays selected: the page must not say which adjustment is on.
    setChoice(null);
  };
  return (
    <Setting
      title="Figures"
      control={
        <div className="space-y-3">
          <Segmented<Display['mode']>
            label="How figures are shown"
            size="md"
            value={choice}
            onChange={choose}
            options={[
              { value: 'real', label: 'As they are' },
              { value: 'hidden', label: 'Hidden' },
              { value: 'scaled', label: 'Scaled' },
            ]}
          />
          {choice === 'scaled' && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                apply();
              }}
            >
              <input
                className={`${inputClass} num w-28`}
                inputMode="decimal"
                aria-label="Multiply every figure by"
                placeholder="e.g. 10"
                value={factorText}
                onChange={(e) => setFactorText(e.target.value)}
              />
              <Button type="submit" variant="primary" disabled={!factorOk}>
                Apply
              </Button>
            </form>
          )}
          {adjusted && <p className="text-[13px] font-semibold text-warn">Figures are adjusted.</p>}
        </div>
      }
    >
      <p>For showing the app to someone else. Dollar amounts and share counts follow this choice everywhere; prices, percentages and dates are public and never change.</p>
      <p className="mt-2">
        <strong className="font-semibold text-ink">Hidden</strong> replaces every amount with dots and leaves the percentages. <strong className="font-semibold text-ink">Scaled</strong> multiplies every amount by a number you type here, so the shapes are real and the sizes are not.
      </p>
      <p className="mt-2">Once set, this page says only that figures are adjusted, not how. Choose “As they are” to show them again. The choice stays in this browser.</p>
    </Setting>
  );
}

function Setting({ title, control, children }: { title: string; control: ReactNode; children: ReactNode }) {
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
