// Settings: the few choices that change how every number is computed or
// shown. Rarely touched, so they live on their own page, not in the top bar.
import { useState, type ReactNode } from 'react';
import { Button, inputClass, PageTitle, Segmented } from '../components/ui.tsx';
import type { Display } from '../lib/display.ts';
import { useDisplay } from '../lib/displayContext.tsx';
import { useMethod, type Method } from '../lib/method.tsx';
import { useLock } from '../lib/lockContext.tsx';

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
      <PasswordSetting />
    </div>
  );
}

/** Real or hidden figures. */
function FiguresSetting() {
  const { display, setDisplay } = useDisplay();
  return (
    <Setting
      title="Figures"
      control={
        <Segmented<Display['mode']>
          label="How figures are shown"
          size="md"
          value={display.mode}
          onChange={(mode) => setDisplay({ mode })}
          options={[
            { value: 'real', label: 'As they are' },
            { value: 'hidden', label: 'Hidden' },
          ]}
        />
      }
    >
      <p>For showing the app to someone else. <strong className="font-semibold text-ink">Hidden</strong> replaces every dollar amount and share count with dots; prices, percentages and dates are public and stay. The Outlook is not shown while figures are hidden. The choice stays in this browser.</p>
    </Setting>
  );
}

/**
 * The optional password. Off unless the owner sets one; then the app asks for
 * it in every new tab. Plain text in data/password, so it is easy to read or
 * delete when forgotten. It is a courtesy against a glance, not security.
 */
function PasswordSetting() {
  const { on, setPassword, turnOff } = useLock();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Setting
      title="Password"
      control={
        on ? (
          <div className="space-y-2">
            <p className="text-[13px] font-semibold text-loss">A password is set.</p>
            <Button onClick={() => void run(turnOff)} busy={busy}>
              Turn off
            </Button>
          </div>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) void run(() => setPassword(text.trim()));
            }}
          >
            <input className={`${inputClass} w-44`} type="password" autoComplete="new-password" aria-label="New password" placeholder="Password" value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="submit" variant="primary" disabled={!text.trim()} busy={busy}>
              Set
            </Button>
          </form>
        )
      }
    >
      <p>Off unless you set one. With a password, every new tab shows a blank page with one box; the right password opens the app, and closing the tab locks it again. <strong className="font-semibold text-ink">Lock</strong> in the top bar locks this tab now.</p>
      <p className="mt-2">This keeps someone at your computer from opening the page and reading everything at a glance; it is not security. The password is kept as plain text in <code>data/password</code>, so if you forget it, read or delete that file.</p>
      {error && <p className="mt-2 text-[13px] font-semibold text-loss">{error}</p>}
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
