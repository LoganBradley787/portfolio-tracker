import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SellPreview } from '../../client/src/components/SellPreview.tsx';
import { TurningLongTermSoon } from '../../client/src/components/TurningLongTermSoon.tsx';

const input = { today: '2026-10-03', averageCost: 25,
  price: { price: 30, prevClose: null, asOf: '2026-10-02', source: 'close' as const },
  lots: [{ acquired: '2024-01-01', account: 'A', shares: 2, cost: 20 },
    { acquired: '2026-01-01', account: 'B', shares: 1, cost: 40 }] };
const render = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(MemoryRouter, null, element));

describe('sell estimate presentation', () => {
  it('defaults to the largest account, shows a chooser and keeps average cost pooled', () => {
    const html = render(createElement(SellPreview, { input, method: 'average' }));
    expect(html).toContain('If I sold this today');
    expect(html).toContain('<select');
    expect(html).toContain('<option value="A" selected=""');
    expect(html).toContain('max="2"');
    expect(html).toContain('value="2"');
    expect(html).toContain('$60.00');
    expect(html).toContain('+$10.00');
    expect(html).toContain('Short-term gain (FIFO)');
    expect(html).toContain('Long-term gain (FIFO)');
    expect(html).toContain('Short/long split uses FIFO lots');
    expect(html).toContain('Average cost stays pooled across the selected accounts');
    expect(html).toContain('Preview only');
    expect(html).toContain('Jan 1, 2024');
    expect(html).not.toContain('Jan 1, 2026');
  });

  it('hides the chooser when only one account holds the ticker', () => {
    const html = render(createElement(SellPreview, { input: { ...input, lots: input.lots.filter((l) => l.account === 'B') }, method: 'fifo' }));
    expect(html).not.toContain('<select');
    expect(html).toContain('value="1"');
    expect(html).toContain('max="1"');
  });

  it('shows FIFO gain, the long/short lots and closed/missing-price states', () => {
    expect(render(createElement(SellPreview, { input, method: 'fifo' }))).toContain('+$40.00');
    expect(render(createElement(SellPreview, { input: { ...input, price: null }, method: 'fifo' }))).toContain('No market price available');
    expect(render(createElement(SellPreview, { input: { ...input, lots: [] }, method: 'fifo' }))).toContain('No shares held today');
  });

  it('labels grouped reinvestments with total shares/gain and both long-term dates', () => {
    const rows = [{ ticker: 'AAA', account: 'A', acquired: '2025-10-03', shares: 0.6, cost: 14,
      longTermDate: '2026-10-04', lastLongTermDate: '2026-12-02', gain: 10, drip: true, reinvestedLots: 3 }];
    const html = render(createElement(TurningLongTermSoon, { lots: rows }));
    expect(html).toContain('3 reinvested lots');
    expect(html).toContain('Oct 4, 2026');
    expect(html).toContain('Dec 2, 2026');
    expect(html).toContain('0.6');
    expect(html).toContain('+$10.00');
  });

  it('formats price dates and timestamps like other UI dates', () => {
    for (const asOf of ['2026-10-02', '2026-10-02T16:30:00.000Z']) {
      const html = render(createElement(SellPreview, { input: { ...input, price: { ...input.price, asOf } }, method: 'fifo' }));
      expect(html).toContain('price as of Oct 2,');
      expect(html).not.toContain(asOf);
    }
  });

  it('shows upcoming date, account, shares, unknown gains and an empty state', () => {
    const rows = [{ ticker: 'AAA', account: 'A', acquired: '2025-10-03', shares: 2, cost: 20, longTermDate: '2026-10-04', gain: null }];
    const html = render(createElement(TurningLongTermSoon, { lots: rows }));
    expect(html).toContain('Turning long-term soon');
    expect(html).toContain('Oct 4, 2026');
    expect(html).toContain('No price');
    expect(html).toContain('AAA');
    expect(render(createElement(TurningLongTermSoon, { lots: [] }))).toContain('No lots cross into long-term in the next 60 days');
  });
});
