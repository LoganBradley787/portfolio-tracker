import { describe, expect, it } from 'vitest';
import { priceGaps, priceSanity, splitCrossCheck } from '../../src/engine/health.ts';
import type { Transaction } from '../../src/engine/types.ts';
import { historyBars } from '../helpers/fixtures.ts';

const spyDates = historyBars('SPY').map((b) => b.date);

describe('splitCrossCheck', () => {
  const provider = [{ ticker: 'SHOP', exDate: '2022-06-29', ratio: 10, source: 'provider' as const }];

  it('matches an imported split to the provider’s within 5 trading days', () => {
    expect(splitCrossCheck([{ id: 1, ticker: 'SHOP', exDate: '2022-06-29', ratio: 10 }], provider, spyDates)[0]).toMatchObject({ result: 'match' });
    expect(splitCrossCheck([{ id: 1, ticker: 'SHOP', exDate: '2022-07-06', ratio: 10 }], provider, spyDates)[0]).toMatchObject({ result: 'match', providerExDate: '2022-06-29' });
    expect(splitCrossCheck([{ id: 1, ticker: 'SHOP', exDate: '2022-07-08', ratio: 10 }], provider, spyDates)[0]).toMatchObject({ result: 'missing' });
  });

  it('flags a ratio mismatch, a missing split and a manually applied one', () => {
    const imported = [
      { id: 1, ticker: 'SHOP', exDate: '2022-06-29', ratio: 3 },
      { id: 2, ticker: 'TSLA', exDate: '2022-08-25', ratio: 3 },
      { id: 3, ticker: 'NVDA', exDate: '2024-06-10', ratio: 10 },
    ];
    const stored = [...provider, { ticker: 'NVDA', exDate: '2024-06-10', ratio: 10, source: 'manual' as const }];
    expect(splitCrossCheck(imported, stored, spyDates).map((r) => r.result)).toEqual(['ratio-differs', 'missing', 'applied']);
  });
});

describe('priceGaps', () => {
  it('lists runs of more than 5 missing trading days', () => {
    const bars = historyBars('DIS').filter((b) => b.date <= '2020-06-30');
    const holed = bars.filter((b) => !(b.date >= '2020-04-01' && b.date <= '2020-04-14')); // 9 trading days
    const short = bars.filter((b) => !(b.date >= '2020-05-01' && b.date <= '2020-05-07')); // 5 trading days
    expect(priceGaps('DIS', holed, spyDates)).toEqual([{ ticker: 'DIS', from: '2020-04-01', to: '2020-04-14', tradingDays: 9 }]);
    expect(priceGaps('DIS', short, spyDates)).toEqual([]);
    expect(priceGaps('DIS', bars, spyDates)).toEqual([]);
  });
});

describe('priceSanity', () => {
  const tx = (ticker: string, date: string, price: number, id = 1): Transaction => ({ id, seq: id, ticker, type: 'Buy', shares: 1, price, date, account: 'Main' });
  const bars = { SHOP: historyBars('SHOP'), DIS: historyBars('DIS') };

  it('flags trades more than 20% from that day’s close', () => {
    // The sample's SHOP buy, at that day's close, is fine.
    expect(priceSanity([tx('SHOP', '2022-06-27', 373.21)], bars)).toEqual([]);
    // A pre-split price recorded on the ex-date is caught.
    const out = priceSanity([tx('SHOP', '2022-06-29', 350, 7)], bars);
    expect(out).toEqual([{ txId: 7, ticker: 'SHOP', date: '2022-06-29', price: 350, close: 33.05, diffPct: expect.closeTo(350 / 33.05 - 1, 9) }]);
  });

  it('skips trades with no bar on their date', () => {
    expect(priceSanity([tx('DIS', '2020-03-07', 1)], bars)).toEqual([]);
    expect(priceSanity([tx('SQ', '2021-01-04', 1)], bars)).toEqual([]);
  });
});
