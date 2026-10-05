// The sub-tabs of each area. An area answers one question; each tab is one page.
import type { SubTab } from '../components/ui.tsx';

export const PORTFOLIO_TABS: SubTab[] = [
  { to: '/', label: 'Overview', end: true },
  { to: '/allocation', label: 'Allocation' },
  { to: '/exposure', label: 'Exposure' },
  { to: '/fees', label: 'Fees' },
];

export const PERFORMANCE_TABS: SubTab[] = [
  { to: '/performance', label: 'Returns', end: true },
  { to: '/performance/holdings', label: 'By holding' },
  { to: '/performance/months', label: 'By month' },
  { to: '/performance/money', label: 'Money added' },
];

export const ACTIVITY_TABS: SubTab[] = [
  { to: '/activity/transactions', label: 'Transactions' },
  { to: '/activity/sales', label: 'Sales' },
  { to: '/activity/dividends', label: 'Dividends' },
  { to: '/activity/taxes', label: 'Taxes' },
];

export const OUTLOOK_TABS: SubTab[] = [{ to: '/outlook', label: 'Projection', end: true }];

export const DATA_TABS: SubTab[] = [
  { to: '/data/health', label: 'Health' },
  { to: '/data/securities', label: 'Securities' },
  { to: '/data/inbox', label: 'Drop folder' },
];
