import { Link } from 'react-router-dom';

export function TickerLink({ ticker }: { ticker: string }) {
  return <Link to={`/ticker/${encodeURIComponent(ticker)}`} className="font-semibold text-ink hover:text-accent hover:underline">{ticker}</Link>;
}
