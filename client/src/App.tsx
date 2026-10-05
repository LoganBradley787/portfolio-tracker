import { Navigate, Route, Routes } from 'react-router-dom';
import { Header } from './components/Header.tsx';
import { RefreshProvider } from './lib/refresh.tsx';
import { MethodProvider } from './lib/method.tsx';
import { AccountProvider } from './lib/account.tsx';
import Overview from './pages/Overview.tsx';
import Allocation from './pages/Allocation.tsx';
import Exposure from './pages/Exposure.tsx';
import Fees from './pages/Fees.tsx';
import PerformanceArea, { Returns, PerformanceHoldings, Months, MoneyAddedPage } from './pages/Performance.tsx';
import ActivityArea, { Transactions, Sales, Dividends, Taxes } from './pages/Activity.tsx';
import Outlook from './pages/Outlook.tsx';
import DataArea, { Health, Securities, Inbox } from './pages/Data.tsx';
import Ticker from './pages/Ticker.tsx';
import { Empty } from './components/ui.tsx';

export default function App() {
  return (
    <RefreshProvider>
      <MethodProvider>
      <AccountProvider>
      <div className="min-h-screen bg-bg text-ink">
        <Header />
        <main className="mx-auto max-w-[1320px] px-5 pt-6 pb-20 sm:px-8">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/allocation" element={<Allocation />} />
            <Route path="/exposure" element={<Exposure />} />
            <Route path="/fees" element={<Fees />} />

            <Route path="/performance" element={<PerformanceArea />}>
              <Route index element={<Returns />} />
              <Route path="holdings" element={<PerformanceHoldings />} />
              <Route path="months" element={<Months />} />
              <Route path="money" element={<MoneyAddedPage />} />
            </Route>

            <Route path="/activity" element={<ActivityArea />}>
              <Route index element={<Navigate to="/activity/transactions" replace />} />
              <Route path="transactions" element={<Transactions />} />
              <Route path="sales" element={<Sales />} />
              <Route path="dividends" element={<Dividends />} />
              <Route path="taxes" element={<Taxes />} />
            </Route>

            <Route path="/outlook" element={<Outlook />} />

            <Route path="/data" element={<DataArea />}>
              <Route index element={<Navigate to="/data/health" replace />} />
              <Route path="health" element={<Health />} />
              <Route path="securities" element={<Securities />} />
              <Route path="inbox" element={<Inbox />} />
            </Route>

            <Route path="/ticker/:ticker" element={<Ticker />} />

            {/* Where things used to live. */}
            <Route path="/realized" element={<Navigate to="/activity/sales" replace />} />
            <Route path="/transactions" element={<Navigate to="/activity/transactions" replace />} />
            <Route path="/health" element={<Navigate to="/data/health" replace />} />
            <Route path="/securities" element={<Navigate to="/data/securities" replace />} />
            <Route path="/settings" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Empty title="No such page">Use the areas at the top.</Empty>} />
          </Routes>
        </main>
      </div>
      </AccountProvider>
      </MethodProvider>
    </RefreshProvider>
  );
}
