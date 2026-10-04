import type { ExposureRow } from './exposure.ts';

export interface ExposurePage {
  query: string;
  sort: { key: string; dir: 'asc' | 'desc' };
  offset?: number;
  limit: number;
}

/** Sort/search the full universe before selecting a response page, including small constituents. */
export function selectExposureRows(rows: ExposureRow[], opts: ExposurePage) {
  const query = opts.query.trim().toLowerCase();
  const filtered = query ? rows.filter((r) => [r.name, ...r.tickers, ...r.countries,
    ...r.contributions.flatMap((c) => c.security ? [c.security.cusip, c.security.sedol, c.security.name] : []),
  ].some((s) => s.toLowerCase().includes(query))) : rows;
  const value = (r: ExposureRow): number | string | null => {
    if (opts.sort.key === 'name') return r.name.toLowerCase();
    if (opts.sort.key === 'direct') return r.direct;
    if (opts.sort.key.startsWith('fund:')) {
      const ticker = opts.sort.key.slice(5);
      return r.unknownThroughFunds.includes(ticker) ? null : r.throughFunds[ticker] ?? 0;
    }
    return r.total;
  };
  const direction = opts.sort.dir === 'asc' ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === y) return b.total - a.total || a.id.localeCompare(b.id);
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : 1) * direction;
  });
  // Account selection or a refresh can shrink the universe while a later page is open.
  const lastPage = Math.max(0, Math.floor((sorted.length - 1) / opts.limit) * opts.limit);
  const offset = Math.min(opts.offset ?? 0, lastPage);
  return { rows: sorted.slice(offset, offset + opts.limit), count: filtered.length, offset };
}

