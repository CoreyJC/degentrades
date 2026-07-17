import { useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useToast }  from '../context/ToastContext';
import { useCoins }  from '../hooks/useCoins';
import CoinModal     from '../components/CoinModal';

const TOTAL_SUPPLY = 1_000_000_000;
const NEW_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/** Format market cap as abbreviated string: $1.2K, $24.5K, $1.2M */
function fmtMC(mc) {
  if (mc == null) return '—';
  if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(1)}M`;
  if (mc >= 1_000)     return `$${(mc / 1_000).toFixed(1)}K`;
  return `$${mc.toFixed(0)}`;
}

/** Market cap from coin */
function getMC(coin) {
  return coin.marketCap ?? (coin.currentPrice * TOTAL_SUPPLY);
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

function CoinCard({ coin, onClick }) {
  const mc = getMC(coin);

  return (
    <div
      className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-600 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="font-bold text-white">{coin.name}</span>
          <div className="text-gray-500 text-xs font-mono">${coin.ticker}</div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-400 text-xs">Market Cap</span>
        <span className="text-white font-mono font-semibold">{fmtMC(mc)}</span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-gray-400 text-xs">24h Change</span>
        <ChangeChip value={coin.change24h ?? 0} />
      </div>
    </div>
  );
}

function SectionHeader({ emoji, title, count, subtitle }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-xl">{emoji}</span>
      <div>
        <h2 className="text-lg font-bold text-white">{title}</h2>
        {subtitle && <p className="text-gray-500 text-xs">{subtitle}</p>}
      </div>
      <span className="ml-auto text-gray-600 text-sm">{count}</span>
    </div>
  );
}

export default function Market() {
  const { socket }  = useSocket();
  const { push }    = useToast();
  const { coins, loading, error } = useCoins(socket, push);
  const [search, setSearch] = useState('');
  const [selectedCoinId, setSelectedCoinId] = useState(null);

  const now = Date.now();

  const filtered = search
    ? coins.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.ticker.toLowerCase().includes(search.toLowerCase())
      )
    : coins;

  // ── 🆕 New — created in last 5 min, newest first ─────────────────────────
  const newCoins = filtered
    .filter((c) => now - new Date(c.createdAt ?? 0).getTime() <= NEW_WINDOW_MS)
    .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));

  const newIds = new Set(newCoins.map((c) => c.id));

  // ── 🔥 Pumping — non-new coins with positive or flat change, sorted best first
  const pumping = filtered
    .filter((c) => !newIds.has(c.id) && (c.change24h ?? 0) >= 0)
    .sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0));

  // ── 💀 Bleeding — non-new coins with negative change, sorted worst first
  const bleeding = filtered
    .filter((c) => !newIds.has(c.id) && (c.change24h ?? 0) < 0)
    .sort((a, b) => (a.change24h ?? 0) - (b.change24h ?? 0));

  if (error) return (
    <div className="max-w-4xl mx-auto p-8 text-red-400">Error: {error}</div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* ── 🆕 New ───────────────────────────────────────────────────────── */}
          <div>
            <SectionHeader
              emoji="🆕"
              title="New"
              count={`${newCoins.length} tokens`}
              subtitle="Just launched · Last 5 min"
            />
            <div className="flex flex-col gap-3 overflow-y-auto max-h-[70vh] pr-1">
              {newCoins.length === 0 ? (
                <div className="text-gray-600 text-sm text-center py-8">No new tokens</div>
              ) : (
                newCoins.map((coin) => (
                  <CoinCard key={coin.id} coin={coin} onClick={() => setSelectedCoinId(coin.id)} />
                ))
              )}
            </div>
          </div>

          {/* ── 🔥 Pumping ───────────────────────────────────────────────────── */}
          <div>
            <SectionHeader
              emoji="🔥"
              title="Pumping"
              count={`${pumping.length} tokens`}
              subtitle="Biggest gainers · 24h"
            />
            <div className="flex flex-col gap-3 overflow-y-auto max-h-[70vh] pr-1">
              {pumping.length === 0 ? (
                <div className="text-gray-600 text-sm text-center py-8">No gainers yet</div>
              ) : (
                pumping.map((coin) => (
                  <CoinCard key={coin.id} coin={coin} onClick={() => setSelectedCoinId(coin.id)} />
                ))
              )}
            </div>
          </div>

          {/* ── 💀 Bleeding ──────────────────────────────────────────────────── */}
          <div>
            <SectionHeader
              emoji="💀"
              title="Bleeding"
              count={`${bleeding.length} tokens`}
              subtitle="Biggest losers · 24h"
            />
            <div className="flex flex-col gap-3 overflow-y-auto max-h-[70vh] pr-1">
              {bleeding.length === 0 ? (
                <div className="text-gray-600 text-sm text-center py-8">No losers yet</div>
              ) : (
                bleeding.map((coin) => (
                  <CoinCard key={coin.id} coin={coin} onClick={() => setSelectedCoinId(coin.id)} />
                ))
              )}
            </div>
          </div>

        </div>
      )}

      {selectedCoinId && (
        <CoinModal coinId={selectedCoinId} onClose={() => setSelectedCoinId(null)} />
      )}
    </div>
  );
}
