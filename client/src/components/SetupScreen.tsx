export function SetupScreen() {
  return (
    <div className="mx-auto max-w-xl border-y border-rule-strong/60 bg-surface px-6 py-6">
      <h1 className="text-lg font-semibold">Add your Tiingo API key</h1>
      <p className="mt-2 text-[13px] text-muted">
        Prices, splits and quotes come from Tiingo’s free tier. Without a key the app still keeps your transactions, but every holding is valued at cost.
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-[13px]">
        <li>
          Get a free key at <span className="font-medium">tiingo.com</span> → Account → API Token.
        </li>
        <li>
          Put it in a file named <code className="rounded bg-surface-2 px-1 font-mono text-xs">.env</code> (or <code className="rounded bg-surface-2 px-1 font-mono text-xs">.env.local</code>) in the project folder:
          <pre className="mt-1.5 rounded bg-surface-2 px-3 py-2 font-mono text-xs">TIINGO_API_KEY=your-key-here</pre>
        </li>
        <li>
          Stop the server and run <code className="rounded bg-surface-2 px-1 font-mono text-xs">npm start</code> again.
        </li>
      </ol>
      <p className="mt-4 text-xs text-muted">Ticker symbols and dates are sent to Tiingo; public fund identifiers are sent to Vanguard for ETF holdings. Amounts and share counts stay on this computer.</p>
    </div>
  );
}
