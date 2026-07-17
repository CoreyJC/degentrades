import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { useToast }  from '../context/ToastContext';
import { useCoins }  from '../hooks/useCoins';

function fmt(price) {
  if (price == null) return '—';
  if (price < 0.000001) return price.toExponential(3);
  if (price < 0.0001)   return `$${price.toFixed(7)}`;
  if (price < 0.01)     return `$${price.toFixed(6)}`;
  if (price < 1)        return `$${price.toFixed(4)}`;
  return `$${price.toFixed(2)}`;
}

function ChangeChip({ value }) {
  const up    = value >= 0;
  const label = `${up ? '+' : ''}${value.toFixed(2)}%`;
  return (
    <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded
      ${up ? 'text-green-400 bg-green-950' : 'text-red-400 bg-red-950'}`}>
      {label}
    </span>
  );
}

export default function Market() {
  const { socket }  = useSocket();
  const { push }    = useToast();
  const { coins, loading, error } = useCoins(socket, push);
  const [search, setSearch] = useState('');
  const [sort,   setSort]   = useState({ key: 'marketCap', dir: 'desc' });

  const toggleSort = (key) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' }
    );
  };

  const arrow = (key) =>
    sort.key === key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';

  const filtered = coins
    .filter((c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.ticker.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const aVal = a[sort.key] ?? 0;
      const bVal = b[sort.key] ?? 0;
      return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
    });

  if (error) return (
    <div className="max-w-4xl mx-auto p-8 text-red-400">Error: {error}</div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">🪙 Memecoin Market</h1>
          <p className="text-gray-500 text-sm mt-1">
            {coins.length} tokens live · New tokens spawn every 30s · Prices update every 2s
          </p>
        </div>
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-gray-900 border border-gray-700 text-white placeholder-gray-600
            rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:border-gray-500"
        />
      </div>

      {loading ? (
        <div className="text-gray-500 text-center py-20">Loading market data...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left pb-3 pl-2">Token</th>
                <th
                  className="text-right pb-3 cursor-pointer hover:text-gray-300 select-none"
                  onClick={() => toggleSort('currentPrice')}
                >
                  Price{arrow('currentPrice')}
                </th>
                <th
                  className="text-right pb-3 cursor-pointer hover:text-gray-300 select-none"
                  onClick={() => toggleSort('change24h')}
                >
                  Change{arrow('change24h')}
                </th>
                <th
                  className="text-right pb-3 cursor-pointer hover:text-gray-300 select-none pr-2"
                  onClick={() => toggleSort('marketCap')}
                >
                  Mkt Cap{arrow('marketCap')}
                </th>
                <th className="pb-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((coin) => (
                <tr
                  key={coin.id}
                  className="border-b border-gray-900 hover:bg-gray-900/40 transition-colors"
                >
                  <td className="py-3 pl-2">
                    <div className="flex flex-col">
                      <span className="font-semibold text-white">{coin.name}</span>
                      <span className="text-gray-500 text-xs font-mono">{coin.ticker}</span>
                    </div>
                  </td>
                  <td className="py-3 text-right font-mono text-white">
                    {fmt(coin.currentPrice)}
                  </td>
                  <td className="py-3 text-right">
                    <ChangeChip value={coin.change24h ?? 0} />
                  </td>
                  <td className="py-3 text-right text-gray-400 pr-2">
                    ${((coin.marketCap ?? 0) / 1_000_000).toFixed(2)}M
                  </td>
                  <td className="py-3 text-right">
                    <Link
                      to={`/coin/${coin.id}`}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                    >
                      Trade →
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-gray-600 py-12">
                    No tokens found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
