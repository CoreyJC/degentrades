import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useSocket } from '../context/SocketContext';

const SOL_USD      = 150;
const TOTAL_SUPPLY = 1_000_000_000;

function fmtUSD(sol) {
  const usd = sol * SOL_USD;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000)     return `$${(usd / 1_000).toFixed(2)}K`;
  return `$${usd.toFixed(2)}`;
}

function fmtMC(price) {
  const mc = price * TOTAL_SUPPLY;
  if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(2)}M`;
  if (mc >= 1_000)     return `$${(mc / 1_000).toFixed(1)}K`;
  return `$${mc.toFixed(0)}`;
}

function fmt(p) {
  if (p == null) return '—';
  if (p < 0.000001) return p.toExponential(3);
  if (p < 0.01)     return `$${p.toFixed(6)}`;
  return `$${p.toFixed(4)}`;
}

export default function Portfolio() {
  const { socket }   = useSocket();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const { data } = await axios.get('/api/portfolio');
      setData(data);
      setLoading(false);
    } catch { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  // Live price updates for holdings
  useEffect(() => {
    if (!socket || !data) return;

    function onPriceUpdate(updates) {
      setData((prev) => {
        if (!prev) return prev;
        const newHoldings = prev.holdings.map((h) => {
          const u = updates[h.coinId];
          if (!u) return h;
          const currentPrice = u.price;
          const currentValue = h.amount * currentPrice;
          const pnl = currentValue - h.amount * h.avgBuyPrice;
          const pnlPct = h.avgBuyPrice > 0 ? ((currentPrice - h.avgBuyPrice) / h.avgBuyPrice) * 100 : 0;
          return { ...h, coin: { ...h.coin, currentPrice }, currentValue, pnl, pnlPct };
        });
        const holdingsValue = newHoldings.reduce((s, h) => s + (h.currentValue ?? 0), 0);
        const totalValue = prev.solBalance + holdingsValue;
        return { ...prev, holdings: newHoldings, holdingsValue, totalValue, gainPct: ((totalValue - 100) / 100) * 100 };
      });
    }

    function onCoinDeleted({ coinId }) {
      setData((prev) => {
        if (!prev) return prev;
        const newHoldings = prev.holdings.filter((h) => h.coinId !== coinId);
        const holdingsValue = newHoldings.reduce((s, h) => s + (h.currentValue ?? 0), 0);
        const totalValue = prev.solBalance + holdingsValue;
        return { ...prev, holdings: newHoldings, holdingsValue, totalValue, gainPct: ((totalValue - 100) / 100) * 100 };
      });
    }

    socket.on('price_update', onPriceUpdate);
    socket.on('coin_deleted', onCoinDeleted);
    return () => {
      socket.off('price_update', onPriceUpdate);
      socket.off('coin_deleted', onCoinDeleted);
    };
  }, [socket, data]);

  if (loading) return <div className="text-gray-500 text-center py-20">Loading...</div>;
  if (!data)   return <div className="text-red-400 text-center py-20">Failed to load portfolio</div>;

  const isUp = (data.gainPct ?? 0) >= 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-white mb-6">💼 Portfolio</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Value',    val: fmtUSD(data.totalValue),    sub: `${data.totalValue.toFixed(2)} SOL` },
          { label: 'SOL Balance',    val: fmtUSD(data.solBalance),    sub: `${data.solBalance.toFixed(2)} SOL` },
          { label: 'Holdings Value', val: fmtUSD(data.holdingsValue), sub: `${data.holdingsValue.toFixed(2)} SOL` },
          { label: 'Gain vs Start',  val: `${isUp ? '+' : ''}${data.gainPct.toFixed(2)}%`, sub: fmtUSD(data.totalValue - 100), up: isUp },
        ].map(({ label, val, sub, up }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">{label}</div>
            <div className={`text-lg font-bold font-mono ${up === false ? 'text-red-400' : up ? 'text-green-400' : 'text-white'}`}>
              {val}
            </div>
            {sub && <div className="text-xs text-gray-600 mt-0.5 font-mono">{sub}</div>}
          </div>
        ))}
      </div>

      {/* Holdings table */}
      <h2 className="text-gray-400 text-sm font-semibold uppercase tracking-wide mb-3">Holdings</h2>
      {data.holdings.length === 0 ? (
        <div className="text-gray-600 text-center py-12 border border-gray-800 rounded-xl">
          No holdings yet — <Link to="/" className="text-indigo-400 hover:text-indigo-300">go degen</Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left pb-2 pl-2">Token</th>
                <th className="text-right pb-2">Value (SOL)</th>
                <th className="text-right pb-2">Avg Buy MC</th>
                <th className="text-right pb-2">Current MC</th>
                <th className="text-right pb-2">Value</th>
                <th className="text-right pb-2 pr-2">P&L</th>
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((h) => {
                const up = (h.pnl ?? 0) >= 0;
                return (
                  <tr key={h.id} className="border-b border-gray-900 hover:bg-gray-900/40">
                    <td className="py-3 pl-2">
                      <Link to={`/coin/${h.coinId}`} className="hover:text-indigo-400">
                        <div className="font-semibold text-white">{h.coin.name}</div>
                        <div className="text-gray-500 text-xs">{h.coin.ticker}</div>
                      </Link>
                    </td>
                    <td className="py-3 text-right font-mono text-gray-300">
                      {(h.currentValue ?? 0).toFixed(3)}
                      <div className="text-xs text-gray-600">{h.amount.toExponential(2)} coins</div>
                    </td>
                    <td className="py-3 text-right font-mono text-gray-400">
                      {fmtMC(h.avgBuyPrice)}
                    </td>
                    <td className="py-3 text-right font-mono text-white">
                      {fmtMC(h.coin.currentPrice)}
                    </td>
                    <td className="py-3 text-right font-mono text-gray-300">
                      {fmtUSD(h.currentValue ?? 0)}
                      <div className="text-xs text-gray-600">{(h.currentValue ?? 0).toFixed(3)} SOL</div>
                    </td>
                    <td className={`py-3 text-right font-mono pr-2 ${up ? 'text-green-400' : 'text-red-400'}`}>
                      {up ? '+' : ''}{(h.pnl ?? 0).toFixed(4)}
                      <div className="text-xs">{up ? '+' : ''}{(h.pnlPct ?? 0).toFixed(2)}%</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
