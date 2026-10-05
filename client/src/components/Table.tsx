// A sortable ledger table. Ruled, not boxed: a strong rule under the head,
// hairlines between rows, and the accounting single/double rule on totals.
// Figures are right-aligned and tabular.
import { useMemo, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: ReactNode;
  /** Plain-text label for aria / sort announcements when `label` is not a string. */
  title?: string;
  numeric?: boolean;
  /** A server-sorted column: show controls while preserving the supplied row order. */
  sortable?: boolean;
  sort?: (row: T) => number | string | null;
  render: (row: T) => ReactNode;
  total?: ReactNode;
  /** Extra classes on both th and td (e.g. responsive hiding). */
  className?: string;
}

export type SortState = { key: string; dir: 'asc' | 'desc' };

export function Table<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  sort: controlledSort,
  onSort,
  showTotals,
  rowClassName,
  caption,
  dense,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  initialSort?: SortState;
  sort?: SortState;
  onSort?: (s: SortState) => void;
  showTotals?: boolean;
  rowClassName?: (row: T) => string;
  caption?: string;
  dense?: boolean;
}) {
  const [ownSort, setOwnSort] = useState<SortState | undefined>(initialSort);
  const sort = controlledSort ?? ownSort;

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key);
    if (!col?.sort || !sort) return rows;
    const get = col.sort;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : 1) * dir;
    });
  }, [rows, columns, sort]);

  const toggle = (c: Column<T>) => {
    if (!c.sort && !c.sortable) return;
    const next: SortState =
      sort?.key === c.key ? { key: c.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.numeric ? 'desc' : 'asc' };
    if (onSort) onSort(next);
    else setOwnSort(next);
  };

  const pad = dense ? 'px-2 py-1' : 'px-2.5 py-[7px]';
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-rule-strong/70">
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={`px-2.5 pt-1 pb-1.5 text-xs font-medium whitespace-nowrap text-muted first:pl-0 last:pr-0 ${c.numeric ? 'text-right' : 'text-left'} ${c.className ?? ''}`}
                >
                  {c.sort || c.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggle(c)}
                      className={`inline-flex items-center gap-1 hover:text-ink ${active ? 'text-ink' : ''} ${c.numeric ? 'flex-row-reverse' : ''}`}
                    >
                      {c.label}
                      <span aria-hidden className={`text-[9px] ${active ? 'opacity-100' : 'opacity-0'}`}>
                        {sort?.dir === 'asc' ? '▲' : '▼'}
                      </span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} className={`border-b border-rule last:border-b-0 hover:bg-ink/[0.025] ${rowClassName?.(r) ?? ''}`}>
              {columns.map((c) => (
                <td key={c.key} className={`${pad} first:pl-0 last:pr-0 ${c.numeric ? 'num text-right' : ''} ${c.className ?? ''}`}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {showTotals && (
          <tfoot>
            <tr className="ledger-total font-medium">
              {columns.map((c) => (
                <td key={c.key} className={`px-2.5 py-2 first:pl-0 last:pr-0 ${c.numeric ? 'num text-right' : ''} ${c.className ?? ''}`}>
                  {c.total}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
