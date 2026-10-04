#!/usr/bin/env python3
"""Builds the made-up sample and its reference values.

The sample is invented: no real person's trades. Prices are each ticker's
recorded close on the trade date (tests/fixtures/tiingo), so they are
plausible. The reference values are computed here, independently of the
TypeScript engine, with the spreadsheet rules the engine's average-cost mode
must reproduce:

- split-adjusted shares = shares x every split ratio for that ticker on this
  row or a later row (only the Split rows in the sample itself count);
- one average-cost pool per ticker across accounts;
- on a sale, cost removed = pool cost / pool shares x shares sold.

Run from the repository root:  python3 tests/fixtures/sample/make-reference.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent

# (ticker, asset type, type, shares, split n-to-1, date M/D/YYYY, account)
ROWS = [
    ('DIS', 'Stock', 'Buy', 30, None, '3/10/2020', 'Main'),
    ('DIS', 'Stock', 'Buy', 4, None, '4/14/2020', 'Main'),
    ('DIS', 'Stock', 'Buy', 2, None, '4/14/2020', 'Main'),
    ('TSLA', 'Stock', 'Buy', 6, None, '3/16/2021', 'Brokerage'),
    ('DIS', 'Stock', 'Buy', 3, None, '3/16/2021', 'Brokerage'),
    ('VZ', 'Stock', 'Buy', 10, None, '3/23/2021', 'Brokerage'),
    ('AMD', 'Stock', 'Buy', 8, None, '3/23/2021', 'Brokerage'),
    ('F', 'Stock', 'Buy', 40, None, '4/13/2021', 'Brokerage'),
    ('TSLA', 'Stock', 'Sell', 2, None, '4/13/2021', 'Brokerage'),
    ('KO', 'Stock', 'Buy', 12, None, '8/24/2021', 'Main'),
    ('UBER', 'Stock', 'Buy', 15, None, '8/24/2021', 'Main'),
    ('SHOP', 'Stock', 'Buy', 3, None, '6/27/2022', 'Main'),
    ('ZM', 'Stock', 'Buy', 4, None, '6/29/2022', 'Main'),
    ('SHOP', '', 'Split', None, 10, '6/29/2022', ''),
    ('QQQM', 'ETF', 'Buy', 7, None, '7/6/2022', 'Main'),
]


def iso(us):
    m, d, y = us.split('/')
    return f'{y}-{int(m):02d}-{int(d):02d}'


def close(ticker, date):
    bars = json.loads((ROOT / 'tests/fixtures/tiingo' / f'history_{ticker}.json').read_text())
    return next(b['close'] for b in bars if b['date'] == date)


def main():
    rows = [dict(ticker=t, assetType=a, type=ty, shares=s, split=sp, date=d, account=acct,
                 price=None if ty == 'Split' else close(t, iso(d)))
            for t, a, ty, s, sp, d, acct in ROWS]

    header = ['Ticker', 'Asset Type', 'Type', 'Shares', 'Split (n to 1)', 'Avg Price', 'Date', 'Account']
    cells = [[r['ticker'], r['assetType'], r['type'], '' if r['shares'] is None else str(r['shares']),
              '' if r['split'] is None else str(r['split']), '' if r['price'] is None else str(r['price']),
              r['date'], r['account']] for r in rows]
    (HERE / 'transactions.tsv').write_text(''.join('\t'.join(c) + '\r\n' for c in [header] + cells))
    (HERE / 'transactions.csv').write_text(''.join(','.join(c + ['']) + '\r\n' for c in [header[:8] + []] + cells).replace(
        ','.join(header) + ',', ','.join(header) + ',Note', 1))

    splits = [dict(ticker=r['ticker'], exDate=iso(r['date']), ratio=r['split']) for r in rows if r['type'] == 'Split']
    pools, bought, asset, running, realized = {}, {}, {}, [], []
    for i, r in enumerate(rows):
        t = r['ticker']
        if r['type'] == 'Split':
            running.append(dict(ticker=t, type='Split', date=iso(r['date']), splitAdjustedShares=0, runningShares=None, runningCost=None))
            continue
        factor = 1
        for later in rows[i:]:
            if later['type'] == 'Split' and later['ticker'] == t:
                factor *= later['split']
        adjusted = r['shares'] * factor
        pool = pools.setdefault(t, dict(shares=0, cost=0.0))
        asset.setdefault(t, r['assetType'])
        if r['type'] == 'Buy':
            pool['shares'] += adjusted
            pool['cost'] += r['shares'] * r['price']
            bought[t] = bought.get(t, 0) + adjusted
        else:
            avg = pool['cost'] / pool['shares']
            removed = avg * adjusted
            proceeds = r['shares'] * r['price']
            gain = proceeds - removed
            realized.append(dict(ticker=t, date=iso(r['date']), account=r['account'], sharesSold=float(adjusted),
                                 sellPrice=r['price'], proceeds=proceeds, costRemoved=removed, gain=gain,
                                 gainPerShare=gain / adjusted, gainPct=gain / removed, avgBuyPrice=avg))
            pool['shares'] -= adjusted
            pool['cost'] -= removed
        running.append(dict(ticker=t, type=r['type'], date=iso(r['date']), splitAdjustedShares=adjusted,
                            runningShares=pool['shares'], runningCost=round(pool['cost'], 10)))

    # The spreadsheet's benchmark tab: every trade's dollars go into or out of one
    # benchmark pool at that day's close (SPY's recorded close stands in for the index).
    units = cost = units_sold = bench_gain = 0.0
    bench_rows = []
    for r in rows:
        if r['type'] == 'Split':
            continue
        index_close = close('SPY', iso(r['date']))
        amount = r['shares'] * r['price']
        row_units = amount / index_close
        removed = None
        if r['type'] == 'Buy':
            units += row_units
            cost += amount
        else:
            removed = cost / units * row_units
            bench_gain += amount - removed
            units_sold += row_units
            units -= row_units
            cost -= removed
        bench_rows.append(dict(type=r['type'], shares=r['shares'], price=r['price'], date=iso(r['date']), indexClose=index_close,
                               indexUnits=row_units, runningUnits=units, runningCost=cost, costRemoved=removed))

    holdings = {t: dict(assetType=asset[t], shares=p['shares'], totalBought=bought[t], totalCost=round(p['cost'], 10),
                        avgCost=p['cost'] / p['shares']) for t, p in pools.items() if p['shares'] > 0}
    out = {
        '_comment': 'Reference values for the made-up sample, written by make-reference.py with the spreadsheet rules '
                    '(average cost pooled per ticker). Only the Split row in the sample is known here (SHOP 10-for-1, '
                    '2022-06-29); TSLA\'s 2022-08-25 3-for-1 is not. Use splits=[SHOP 10:1 2022-06-29] to reproduce these.',
        'splitsKnownToSheet': splits,
        'holdings': holdings,
        'realized': realized,
        'runningByTransaction': running,
        'totals': dict(totalCost=round(sum(h['totalCost'] for h in holdings.values()), 10),
                       totalRealizedGain=round(sum(s['gain'] for s in realized), 10)),
        'benchmarkSheetCompatible': dict(rows=bench_rows, realizedGain=bench_gain, unitsSold=units_sold),
    }
    (HERE / 'expected-from-sheet.json').write_text(json.dumps(out, indent=1) + '\n')
    print(f"{len(cells)} rows; total cost {out['totals']['totalCost']}; realized {out['totals']['totalRealizedGain']}")


if __name__ == '__main__':
    main()
