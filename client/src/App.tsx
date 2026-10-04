import { Route, Routes } from 'react-router-dom';
import { Header } from './components/Header.tsx';
import { RefreshProvider } from './lib/refresh.tsx';
import { MethodProvider } from './lib/method.tsx';
import { AccountProvider } from './lib/account.tsx';
import DataHealth from './pages/DataHealth.tsx';
import Overview from './pages/Overview.tsx';
import Performance from './pages/Performance.tsx';
import Exposure from './pages/Exposure.tsx';
import Realized from './pages/Realized.tsx';
import Transactions from './pages/Transactions.tsx';
import Securities from './pages/Securities.tsx';
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
        <main className="mx-auto max-w-[1320px] px-4 pt-7 pb-16 sm:px-6">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/performance" element={<Performance />} />
            <Route path="/exposure" element={<Exposure />} />
            <Route path="/realized" element={<Realized />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/health" element={<DataHealth />} />
            <Route path="/securities" element={<Securities />} />
            <Route path="/ticker/:ticker" element={<Ticker />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Empty title="No such page">Use the tabs above.</Empty>} />
          </Routes>
        </main>
      </div>
      </AccountProvider>
      </MethodProvider>
    </RefreshProvider>
  );
}
