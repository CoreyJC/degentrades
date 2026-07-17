import { useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useToast }  from '../context/ToastContext';
import { useCoins }  from '../hooks/useCoins';
import CoinModal     from '../components/CoinModal';
import Sparkline     from '../components/Sparkline';

const TOTAL_SUPPLY        = 1_000_000_000;
const MIGRATION_THRESHOLD = 69_000;
const ABOUT_TO_MIGRATE    = 50_000;

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

/** Human-readable age string */
function ageString(createdAt) {
  const ageMs = Date.now() - new Date(createdAt ?? 0).getTime();
  if (ageMs < 60_000)   return `${Math.floor(ageMs / 1_000)}s`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m`;
  return `${Math.floor(ageMs / 3_600_000)}h`;
}

function CoinTile({ coin, priceHistory, migrationPct, onClick }) {
  const mc     = getMC(coin);
  const prices = priceHistory[coin.id] ?? [];
  const isUp   = (coin.change24h ?? 0) >= 0;
  const ageStr = ageString(coin.createdAt);

  return (
    <div
      onClick={onClick}
      className={`bg-gray-900 border rounded-xl p-3 cursor-pointer transition-all duration-150
        hover:scale-[1.02] hover:shadow-lg
        ${isUp ? 'border-green-900 hover:border-green-600' : 'border-gray-800 hover:border-red-800'}`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <div className="font-bold text-white text-sm truncate">{coin.name}</div>
          <div className="text-gray-500 text-xs font-mono">${coin.ticker}</div>
        </div>
        <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ml-1
          ${isUp ? 'text-green-400 bg-green-950' : 'text-red-400 bg-red-950'}`}>
          {isUp ? '+' : ''}{(coin.change24h ?? 0).toFixed(1)}%
        </span>
      </div>

      {/* Sparkline */}
      <div className="mb-2">
        <Sparkline prices={prices} height={36} width={160} />
      </div>

      {/* Footer row */}
      <div className="flex items-center justify-between">
        <div className="text-white font-mono font-semibold text-sm">{fmtMC(mc)}</div>
        <div className="text-gray-600 text-xs">{ageStr} ago</div>
      </div>

      {/* Migration progress bar (About to Migrate section only) */}
      {migrationPct != null && (
        <div className="mt-2">
          <div className="flex justify-between text-xs text-gray-600 mb-1">
            <span>Migration</span>
            <span>{migrationPct.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1">
            <div
              className="bg-green-500 h-1 rounded-full transition-all duration-500"
              style={{ width: `${migrationPct}%` }}
            />
          </div>
        </div>
      )}
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
  const { coins, loading, error, refresh, lastRefresh, priceHistory } = useCoins(socket, push);
  const [search, setSearch] = useState('');
  const [selectedCoinId, setSelectedCoinId] = useState(null);

  const filtered = search
    ? coins.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.ticker.toLowerCase().includes(search.toLowerCase())
      )
    : coins;

  // ── 🟢 New Tokens — not migrated, MC < $20k, newest first
  const newTokens = filtered
    .filter((c) => !c.migrated && getMC(c) < ABOUT_TO_MIGRATE)
    .sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));

  // ── 🔥 About to Migrate — not migrated, MC $20k–$30k
  const aboutToMigrate = filtered
    .filter((c) => !c.migrated && getMC(c) >= ABOUT_TO_MIGRATE && getMC(c) < MIGRATION_THRESHOLD)
    .sort((a, b) => getMC(b) - getMC(a));

  // ── 🚀 Just Migrated — migrated OR MC >= $30k
  const justMigrated = filtered
    .filter((c) => c.migrated || getMC(c) >= MIGRATION_THRESHOLD)
    .sort((a, b) => getMC(b) - getMC(a));

  if (error) return (
    <div className="max-w-4xl mx-auto p-8 text-red-400">Error: {error}</div>
  );

  const tileGrid = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3';

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">🪙 Memecoin Market</h1>
          <p className="text-gray-500 text-sm mt-1">
            Prices update every 2s · New tokens spawn every 30s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-gray-900 border border-gray-700 text-white placeholder-gray-600
              rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:border-gray-500"
          />
          <button
            onClick={refresh}
            title="Refresh market"
            className="bg-gray-900 border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white
              rounded-lg px-3 py-2 text-sm transition-colors flex items-center gap-1.5"
          >
            🔄 {lastRefresh ? lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Refresh'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-center py-20">Loading market data...</div>
      ) : (
        <>
          {/* Stats Bar */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-white">{coins.length}</div>
              <div className="text-gray-500 text-xs">Live Tokens</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-green-400">{aboutToMigrate.length}</div>
              <div className="text-gray-500 text-xs">About to Migrate</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-purple-400">{justMigrated.length}</div>
              <div className="text-gray-500 text-xs">Migrated</div>
            </div>
          </div>

          {/* ── 🟢 New Tokens ─────────────────────────────────────────────── */}
          <div className="mb-10">
            <SectionHeader
              emoji="🟢"
              title="New Tokens"
              count={`${newTokens.length} tokens`}
              subtitle="MC < $20K · Oldest first"
            />
            {newTokens.length === 0 ? (
              <div className="text-gray-600 text-sm text-center py-8">No new tokens</div>
            ) : (
              <div className={tileGrid}>
                {newTokens.map((coin) => (
                  <CoinTile
                    key={coin.id}
                    coin={coin}
                    priceHistory={priceHistory.current}
                    onClick={() => setSelectedCoinId(coin.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── 🔥 About to Migrate ───────────────────────────────────────── */}
          <div className="mb-10">
            <SectionHeader
              emoji="🔥"
              title="About to Migrate"
              count={`${aboutToMigrate.length} tokens`}
              subtitle="MC $20K–$30K · Closest to 🎓"
            />
            {aboutToMigrate.length === 0 ? (
              <div className="text-gray-600 text-sm text-center py-8">None approaching yet</div>
            ) : (
              <div className={tileGrid}>
                {aboutToMigrate.map((coin) => {
                  const mc  = getMC(coin);
                  const pct = Math.min((mc / MIGRATION_THRESHOLD) * 100, 100);
                  return (
                    <CoinTile
                      key={coin.id}
                      coin={coin}
                      priceHistory={priceHistory.current}
                      migrationPct={pct}
                      onClick={() => setSelectedCoinId(coin.id)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* ── 🚀 Just Migrated ──────────────────────────────────────────── */}
          <div className="mb-10">
            <SectionHeader
              emoji="🚀"
              title="Just Migrated"
              count={`${justMigrated.length} tokens`}
              subtitle="Crossed $30K · Still trading"
            />
            {justMigrated.length === 0 ? (
              <div className="text-gray-600 text-sm text-center py-8">
                <div className="text-4xl mb-2">🎓</div>
                <div>No graduates yet</div>
                <div className="text-xs mt-1">First to $30K MC!</div>
              </div>
            ) : (
              <div className={tileGrid}>
                {justMigrated.map((coin) => (
                  <CoinTile
                    key={coin.id}
                    coin={coin}
                    priceHistory={priceHistory.current}
                    onClick={() => setSelectedCoinId(coin.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {selectedCoinId && (
        <CoinModal coinId={selectedCoinId} onClose={() => setSelectedCoinId(null)} />
      )}
    </div>
  );
}
