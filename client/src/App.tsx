import { Navigate, Route, Routes } from 'react-router-dom';
import { Header } from './components/Header.tsx';
import { RefreshProvider } from './lib/refresh.tsx';
import { MethodProvider } from './lib/method.tsx';
import { AccountProvider } from './lib/account.tsx';
import Overview from './pages/Overview.tsx';
import Chart from './pages/Chart.tsx';
import Allocation from './pages/Allocation.tsx';
import Exposure from './pages/Exposure.tsx';
import Fees from './pages/Fees.tsx';
import PerformanceArea, { Returns, PerformanceHoldings, Months, MoneyAddedPage } from './pages/Performance.tsx';
import ActivityArea, { Sales, Dividends, Taxes } from './pages/Activity.tsx';
import Outlook from './pages/Outlook.tsx';
import DataArea, { Health, Securities, Inbox, Transactions } from './pages/Data.tsx';
import Ticker from './pages/Ticker.tsx';
import Settings from './pages/Settings.tsx';
import { Empty } from './components/ui.tsx';

export default function App() {
  return (
    <RefreshProvider>
      <MethodProvider>
      <AccountProvider>
      <div className="min-h-screen bg-bg text-ink">
        <Header />
        <main className="px-6 pt-7 pb-24 sm:px-10">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/chart" element={<Chart />} />
            <Route path="/allocation" element={<Allocation />} />
            <Route path="/exposure" element={<Exposure />} />

            <Route path="/performance" element={<PerformanceArea />}>
              <Route index element={<Returns />} />
              <Route path="holdings" element={<PerformanceHoldings />} />
              <Route path="months" element={<Months />} />
              <Route path="money" element={<MoneyAddedPage />} />
            </Route>

            <Route path="/outlook" element={<Outlook />} />

            <Route path="/activity" element={<ActivityArea />}>
              <Route index element={<Navigate to="/activity/sales" replace />} />
              <Route path="sales" element={<Sales />} />
              <Route path="dividends" element={<Dividends />} />
              <Route path="taxes" element={<Taxes />} />
              <Route path="fees" element={<Fees />} />
            </Route>

            <Route path="/data" element={<DataArea />}>
              <Route index element={<Navigate to="/data/transactions" replace />} />
              <Route path="transactions" element={<Transactions />} />
              <Route path="securities" element={<Securities />} />
              <Route path="health" element={<Health />} />
              <Route path="inbox" element={<Inbox />} />
            </Route>

            <Route path="/ticker/:ticker" element={<Ticker />} />
            <Route path="/settings" element={<Settings />} />

            {/* Where things used to live. */}
            <Route path="/fees" element={<Navigate to="/activity/fees" replace />} />
            <Route path="/realized" element={<Navigate to="/activity/sales" replace />} />
            <Route path="/transactions" element={<Navigate to="/data/transactions" replace />} />
            <Route path="/activity/transactions" element={<Navigate to="/data/transactions" replace />} />
            <Route path="/health" element={<Navigate to="/data/health" replace />} />
            <Route path="/securities" element={<Navigate to="/data/securities" replace />} />
            <Route path="*" element={<Empty title="No such page">Use the areas at the top.</Empty>} />
          </Routes>
        </main>
      </div>
      </AccountProvider>
      </MethodProvider>
    </RefreshProvider>
  );
}
