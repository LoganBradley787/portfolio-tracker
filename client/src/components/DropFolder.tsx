import { useState } from 'react';
import type { InboxStatus } from '../../../src/server/inbox.ts';
import { api } from '../lib/api.ts';
import { when } from '../lib/format.ts';
import { Table } from './Table.tsx';
import { Button, Notice, Section } from './ui.tsx';

/** The drop folder: where it is, files it could not import, and what it has imported. */
export function DropFolder({ inbox, onChanged }: { inbox: InboxStatus; onChanged: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      await api('/api/inbox/scan', { method: 'POST' });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Drop folder" count={inbox.waiting.length} aside={<Button size="sm" busy={busy} onClick={() => void check()}>Check now</Button>}>
      <p className="mb-3 max-w-prose text-[13px] text-muted">
        Save a Schwab JSON export or a Robinhood activity CSV into a folder named after its account inside{' '}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs text-ink">{inbox.dir}</code> (for example{' '}
        <code className="font-mono text-xs">Taxable/activity.csv</code>). Trades the app does not have yet are added, the database is copied
        to the backups folder first, and the file moves to that account’s <code className="font-mono text-xs">imported</code> folder.
      </p>
      {inbox.waiting.length > 0 && (
        <div className="mb-3">
          <Notice tone="warn" title={`${inbox.waiting.length} file${inbox.waiting.length > 1 ? 's' : ''} could not be imported`}>
            <ul className="mt-1 space-y-1">
              {inbox.waiting.map((w) => (
                <li key={w.file}>
                  <span className="font-mono text-xs font-semibold">{w.file}</span>: {w.message}.
                </li>
              ))}
            </ul>
            <p className="mt-1">Nothing was added from {inbox.waiting.length > 1 ? 'these files' : 'this file'}. Fix or remove {inbox.waiting.length > 1 ? 'them' : 'it'} and the notice goes away.</p>
          </Notice>
        </div>
      )}
      {inbox.recent.length ? (
        <Table
          caption="Files handled by the drop folder, newest first"
          rows={inbox.recent.slice(0, 10)}
          rowKey={(e) => `${e.at} ${e.file}`}
          columns={[
            { key: 'at', label: 'When', render: (e) => <span className="num whitespace-nowrap">{when(e.at)}</span> },
            { key: 'file', label: 'File', render: (e) => <span className="font-mono text-xs">{e.file}</span> },
            { key: 'account', label: 'Account', render: (e) => e.account || <span className="text-muted">—</span>, className: 'hidden sm:table-cell' },
            {
              key: 'result', label: 'Result',
              render: (e) => (
                <span className={e.ok ? '' : 'text-warn'}>
                  {e.message}
                  {e.ok && e.skipped > 0 && <span className="text-muted"> · {e.skipped} row{e.skipped > 1 ? 's' : ''} left out (already here, or not a stock or ETF trade)</span>}
                </span>
              ),
            },
          ]}
        />
      ) : (
        <p className="border-y border-rule py-2.5 text-[13px] text-muted">No files have been dropped yet.</p>
      )}
    </Section>
  );
}
