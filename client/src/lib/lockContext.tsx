// The optional password, as the app sees it: whether one is set, and the
// screen that asks for it. Nothing beneath the gate mounts until the tab is
// unlocked, so no figure is fetched or drawn behind the password screen.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api.ts';
import { unlock } from './lock.ts';

interface LockState {
  /** Whether a password is set. */
  on: boolean;
  /** Forget this tab's unlock and show the password screen. */
  lock: () => Promise<void>;
  setPassword: (password: string) => Promise<void>;
  turnOff: () => Promise<void>;
}

const LockContext = createContext<LockState>({ on: false, lock: async () => {}, setPassword: async () => {}, turnOff: async () => {} });

export const useLock = () => useContext(LockContext);

export function LockGate({ children }: { children: ReactNode }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [open, setOpen] = useState(unlock.token() !== null);

  useEffect(() => {
    void api<{ on: boolean }>('/api/lock')
      .then((r) => setOn(r.on))
      .catch(() => setOn(false));
    return unlock.onLocked(() => setOpen(false));
  }, []);

  const lock = useCallback(async () => {
    await api('/api/unlock', { method: 'DELETE' }).catch(() => undefined);
    unlock.forget();
  }, []);
  const setPassword = useCallback(async (password: string) => {
    await unlock.hold(async () => {
      const { token } = await api<{ token: string }>('/api/lock', { method: 'PUT', body: { password } });
      unlock.set(token);
    });
    setOpen(true);
    setOn(true);
  }, []);
  const turnOff = useCallback(async () => {
    await api('/api/lock', { method: 'DELETE' });
    setOn(false);
  }, []);

  if (on === null) return null;
  if (on && !open) return <LockScreen onUnlocked={() => setOpen(true)} />;
  return <LockContext.Provider value={{ on, lock, setPassword, turnOff }}>{children}</LockContext.Provider>;
}

/** A blank page with one box. The right password opens the app; a wrong one empties the box and turns its edge red. */
function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    try {
      const { token } = await api<{ token: string }>('/api/unlock', { method: 'POST', body: { password } });
      unlock.set(token);
      onUnlocked();
    } catch {
      setWrong(true);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg">
      <form onSubmit={submit} aria-label="Password">
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          aria-label="Password"
          aria-invalid={wrong || undefined}
          className={`lock-box h-10 w-64 rounded border-2 bg-surface px-3 text-[15px] text-ink ${wrong ? 'border-loss' : 'border-rule-strong/70 focus:border-ink'}`}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setWrong(false);
          }}
        />
      </form>
    </main>
  );
}
