// Current dollars estimated from published fund weights. No constituent quotes are needed.
import type { HoldingFlag } from './holdings.ts';
import type { AssetType } from './types.ts';

export interface FundHolding {
  name: string;
  ticker: string;
  country: string;
  cusip: string;
  sedol: string;
  /** Fraction of the fund, not percentage points. Null means unpublished. */
  weight: number | null;
}

export interface FundSnapshot {
  effectiveDate: string;
  holdings: FundHolding[];
}

export interface ExposurePosition {
  ticker: string;
  assetType: AssetType;
  equity: number;
  flag: HoldingFlag;
}

export interface ExposureContribution {
  kind: 'direct' | 'fund';
  ticker: string;
  security: FundHolding | null;
  value: number | null;
}

export interface ExposureRow {
  id: string;
  name: string;
  tickers: string[];
  countries: string[];
  matching: 'company' | 'security' | 'direct' | 'uncertain';
  direct: number;
  throughFunds: Record<string, number>;
  unknownThroughFunds: string[];
  total: number;
  pctOfPortfolio: number | null;
  contributions: ExposureContribution[];
  valuationWarnings: string[];
}

export interface FundExposure {
  ticker: string;
  value: number;
  supported: boolean;
  effectiveDate: string | null;
  allocatedValue: number;
  otherValue: number;
  roundingExcessValue: number;
  unexpandedValue: number;
  missingWeights: number;
  holdingCount: number;
  flag: HoldingFlag;
}

/** Only share-class punctuation is canonicalized; no fuzzy name matching. */
export function exposureSymbol(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/[/-]/g, '.');
}

// Explicit issuer mappings, not an inference from similar company names.
const COMPANIES: Record<string, { id: string; name: string }> = {
  GOOG: { id: 'company:alphabet', name: 'Alphabet Inc' },
  GOOGL: { id: 'company:alphabet', name: 'Alphabet Inc' },
  'BRK.A': { id: 'company:berkshire', name: 'Berkshire Hathaway Inc' },
  'BRK.B': { id: 'company:berkshire', name: 'Berkshire Hathaway Inc' },
};

export function computeExposure(input: {
  holdings: ExposurePosition[];
  securities: { ticker: string; providerSymbol: string; name: string | null }[];
  snapshots: Record<string, FundSnapshot>;
  supportedFunds: string[];
}) {
  const totalValue = input.holdings.reduce((n, h) => n + h.equity, 0);
  const heldFunds = input.holdings.filter((h) => h.assetType === 'ETF' || input.supportedFunds.includes(h.ticker));
  const entries = heldFunds.filter((f) => input.supportedFunds.includes(f.ticker)).flatMap((fund) =>
    (input.snapshots[fund.ticker]?.holdings ?? []).map((security, i) => ({ fund, security, key: `${fund.ticker}:${i}` })),
  );

  // Connect matching security IDs across funds/listings. A CUSIP or SEDOL identifies
  // a security; it does not establish that two different share classes are one issuer.
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    const next = parent.get(id);
    if (!next) { parent.set(id, id); return id; }
    if (next === id) return id;
    const result = root(next);
    parent.set(id, result);
    return result;
  };
  const identifiers = (s: FundHolding) => [
    ...(s.cusip ? [`cusip:${s.cusip}`] : []),
    ...(s.sedol ? [`sedol:${s.sedol}`] : []),
  ];
  for (const { security } of entries) {
    const ids = identifiers(security);
    const company = security.country === 'US' ? COMPANIES[exposureSymbol(security.ticker)] : undefined;
    if (company) ids.push(company.id);
    if (!ids.length) continue;
    const roots = ids.map(root).sort();
    for (const id of roots) parent.set(id, roots[0]);
  }
  const keyFor = (s: FundHolding, fallback: string) => {
    const company = s.country === 'US' ? COMPANIES[exposureSymbol(s.ticker)] : undefined;
    const id = company?.id ?? identifiers(s)[0];
    return id ? root(id) : `unidentified:${fallback}`;
  };
  const companyByKey = new Map<string, { id: string; name: string }>();
  for (const c of Object.values(COMPANIES)) if (parent.has(c.id)) companyByKey.set(root(c.id), c);

  const rows = new Map<string, ExposureRow>();
  const allTickers = new Map<string, Set<string>>();
  const usTickers = new Map<string, Set<string>>();
  const members = new Map<string, FundHolding[]>();
  const unpublished = new Map<string, ExposureContribution[]>();
  for (const { fund, security, key } of entries) {
    const id = keyFor(security, key);
    const list = members.get(id) ?? [];
    list.push(security);
    members.set(id, list);
    if (security.weight === null) {
      const unknown = unpublished.get(id) ?? [];
      unknown.push({ kind: 'fund', ticker: fund.ticker, security, value: null });
      unpublished.set(id, unknown);
    }
    if (security.ticker) {
      const symbol = exposureSymbol(security.ticker);
      const candidates = allTickers.get(symbol) ?? new Set<string>();
      candidates.add(id);
      allTickers.set(symbol, candidates);
    }
    if (security.country === 'US' && security.ticker) {
      const symbol = exposureSymbol(security.ticker);
      const candidates = usTickers.get(symbol) ?? new Set<string>();
      candidates.add(id);
      usTickers.set(symbol, candidates);
    }
  }
  const getRow = (id: string, name: string, matching: ExposureRow['matching']) => {
    let row = rows.get(id);
    if (!row) {
      const company = companyByKey.get(id);
      const securities = members.get(id) ?? [];
      row = {
        id, name: company?.name ?? name,
        tickers: [...new Set(securities.map((s) => s.ticker).filter(Boolean))].sort(),
        countries: [...new Set(securities.map((s) => s.country).filter(Boolean))].sort(),
        matching: company ? 'company' : matching,
        direct: 0, throughFunds: {}, unknownThroughFunds: [...new Set((unpublished.get(id) ?? []).map((c) => c.ticker))].sort(),
        total: 0, pctOfPortfolio: null, contributions: [...(unpublished.get(id) ?? [])], valuationWarnings: [],
      };
      rows.set(id, row);
    }
    return row;
  };
  const add = (row: ExposureRow, value: number, contribution: ExposureContribution, flag: HoldingFlag) => {
    row.total += value;
    row.contributions.push(contribution);
    if (flag) {
      const warning = `${contribution.ticker}: ${flag}`;
      if (!row.valuationWarnings.includes(warning)) row.valuationWarnings.push(warning);
    }
  };
  for (const { fund, security, key } of entries) {
    if (security.weight === null || security.weight === 0) continue;
    const id = keyFor(security, key);
    const row = getRow(id, security.name, identifiers(security).length ? 'security' : 'uncertain');
    const value = fund.equity * security.weight;
    row.throughFunds[fund.ticker] = (row.throughFunds[fund.ticker] ?? 0) + value;
    add(row, value, { kind: 'fund', ticker: fund.ticker, security, value }, fund.flag);
  }
  const metadata = new Map(input.securities.map((s) => [s.ticker, s]));
  for (const holding of input.holdings.filter((h) => h.assetType === 'Stock' && !input.supportedFunds.includes(h.ticker))) {
    const sec = metadata.get(holding.ticker);
    const symbol = exposureSymbol(sec?.providerSymbol ?? holding.ticker);
    const candidates = usTickers.get(symbol) ?? allTickers.get(symbol);
    const company = COMPANIES[symbol];
    const ambiguous = !!candidates && candidates.size > 1;
    const id = candidates?.size === 1 ? [...candidates][0]
      : !ambiguous && company ? (parent.has(company.id) ? root(company.id) : company.id)
      : `direct:${holding.ticker}`;
    const name = members.get(id)?.[0]?.name ?? sec?.name ?? holding.ticker;
    const row = getRow(id, company && !ambiguous ? company.name : name, ambiguous ? 'uncertain' : company ? 'company' : 'direct');
    if (!row.tickers.includes(holding.ticker)) row.tickers.push(holding.ticker);
    row.tickers.sort();
    row.direct += holding.equity;
    add(row, holding.equity, { kind: 'direct', ticker: holding.ticker, security: null, value: holding.equity }, holding.flag);
  }

  const funds: FundExposure[] = heldFunds.map((h) => {
    const supported = input.supportedFunds.includes(h.ticker);
    const snapshot = supported ? input.snapshots[h.ticker] : undefined;
    const weight = snapshot?.holdings.reduce((n, s) => n + (s.weight ?? 0), 0) ?? 0;
    return {
      ticker: h.ticker, value: h.equity, supported, effectiveDate: snapshot?.effectiveDate ?? null,
      allocatedValue: h.equity * weight,
      otherValue: snapshot ? h.equity * Math.max(0, 1 - weight) : 0,
      roundingExcessValue: snapshot ? h.equity * Math.max(0, weight - 1) : 0,
      unexpandedValue: snapshot ? 0 : h.equity,
      missingWeights: snapshot?.holdings.filter((s) => s.weight === null).length ?? 0,
      holdingCount: snapshot?.holdings.length ?? 0,
      flag: h.flag,
    };
  });
  const result = [...rows.values()].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  for (const row of result) row.pctOfPortfolio = totalValue ? row.total / totalValue : null;
  const directValue = result.reduce((n, r) => n + r.direct, 0);
  const throughFundsValue = funds.reduce((n, f) => n + f.allocatedValue, 0);
  const mappedValue = directValue + throughFundsValue;
  return {
    rows: result, funds, totalValue, directValue, throughFundsValue, mappedValue,
    otherValue: funds.reduce((n, f) => n + f.otherValue, 0),
    unexpandedValue: funds.reduce((n, f) => n + f.unexpandedValue, 0),
    roundingExcessValue: funds.reduce((n, f) => n + f.roundingExcessValue, 0),
    coverage: totalValue ? mappedValue / totalValue : null,
  };
}
