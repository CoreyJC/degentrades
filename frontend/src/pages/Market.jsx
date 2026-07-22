import { useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useToast }  from '../context/ToastContext';
import { useCoins }  from '../hooks/useCoins';
import CoinModal     from '../components/CoinModal';

const TOTAL_SUPPLY        = 1_000_000_000;
const MIGRATION_THRESHOLD = 69_000;
const ABOUT_TO_MIGRATE    = 50_000;

/** Format market cap as abbreviated string: $1.2K, $24.5K, $1.2M */
function fmtMC(mc) {
  if (mc == null) return '—';
  if (mc >= 1_000_000_000) return `$${(mc / 1_000_000_000).toFixed(2)}B`;
  if (mc >= 1_000_000)     return `$${(mc / 1_000_000).toFixed(1)}M`;
  if (mc >= 1_000)         return `$${(mc / 1_000).toFixed(1)}K`;
  return `$${mc.toFixed(0)}`;
}

/** Market cap from coin */
function getMC(coin) {
  return coin.marketCap ?? (coin.currentPrice * TOTAL_SUPPLY);
}

function StatCard({ label, value, color = 'text-white' }) {
  return (
    <div className="bg-gray-900/80 border border-gray-800 rounded-xl p-4 text-center backdrop-blur-sm">
      <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
      <div className="text-gray-500 text-xs mt-1 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function CoinCard({ coin, showProgress = false, showBadge = false, onClick }) {
  const mc      = getMC(coin);
  const isDying = mc < 1_000;
  const isUp    = (coin.change24h ?? 0) >= 0;
  const ageMs = Date.now() - new Date(coin.createdAt ?? 0).getTime();
  const ageStr = ageMs < 60_000
    ? `${Math.floor(ageMs / 1_000)}s`
    : ageMs < 3_600_000
      ? `${Math.floor(ageMs / 60_000)}m`
      : `${Math.floor(ageMs / 3_600_000)}h`;
  const holders      = coin.holderCount ?? 1;
  const topPct        = coin.topHolderPct ?? 50;
  const bondingPct    = Math.min((mc / MIGRATION_THRESHOLD) * 100, 100);
  const holderRisk    = topPct >= 80 ? 'skull' : topPct >= 50 ? 'high' : topPct >= 20 ? 'mid' : 'low';
  const holderRiskColor = holderRisk === 'skull' ? 'text-red-500' : holderRisk === 'high' ? 'text-orange-400' : holderRisk === 'mid' ? 'text-yellow-400' : 'text-green-400';

  return (
    <div
      onClick={onClick}
      className={`
        relative rounded-xl p-4 cursor-pointer transition-all duration-500
        border bg-gray-900/80 backdrop-blur-sm
        hover:scale-[1.01] hover:shadow-xl
        ${isDying
          ? 'border-gray-800/30 opacity-30 grayscale pointer-events-none'
          : isUp
            ? 'border-green-900/50 hover:border-green-500/60 hover:shadow-green-900/20'
            : 'border-gray-800 hover:border-red-800/60 hover:shadow-red-900/20'}
      `}
    >
      {isDying && (
        <div className="absolute inset-0 flex items-center justify-center z-10 rounded-xl bg-gray-950/40">
          <span className="text-gray-500 text-xs font-mono tracking-widest uppercase">💀 dying</span>
        </div>
      )}
      {/* Top row: name + change chip */}
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 pr-2">
          <div className="font-bold text-white text-sm leading-tight truncate">{coin.name}</div>
          <div className="text-gray-500 text-xs font-mono mt-0.5">${coin.ticker}</div>
        </div>
        <span className={`text-xs font-mono font-bold px-2 py-1 rounded-lg shrink-0
          ${isUp ? 'text-green-400 bg-green-950/80' : 'text-red-400 bg-red-950/80'}`}>
          {isUp ? '▲' : '▼'} {Math.abs(coin.change24h ?? 0).toFixed(2)}%
        </span>
      </div>

      {/* Market cap + holders row */}
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-xs text-gray-600 uppercase tracking-wider mb-1">Market Cap</div>
          <div className={`text-xl font-mono font-bold ${isUp ? 'text-green-400' : 'text-white'}`}>
            {fmtMC(mc)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-600 uppercase tracking-wider mb-1">Holders</div>
          <div className="text-sm font-mono text-gray-300">{holders.toLocaleString()}</div>
          <div className={`text-xs font-mono mt-0.5 ${holderRiskColor}`}>
            {holderRisk === 'skull' ? '💀' : holderRisk === 'high' ? '⚠️' : holderRisk === 'mid' ? '👀' : '✅'} top {topPct.toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Bonding curve progress — always shown */}
      {!showBadge && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-600 mb-1">
            <span>Bonding curve</span>
            <span className={bondingPct >= 72 ? 'text-yellow-400' : 'text-gray-500'}>
              {bondingPct.toFixed(1)}%
            </span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1">
            <div
              className="h-1 rounded-full transition-all duration-500"
              style={{
                width: `${bondingPct}%`,
                background: bondingPct >= 72
                  ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                  : 'linear-gradient(90deg, #22c55e, #3b82f6)',
              }}
            />
          </div>
        </div>
      )}

      {/* Bottom row: age + badge */}
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>🕐 {ageStr} ago</span>
        {showBadge && <span className="text-purple-400 font-semibold">🚀 Migrated</span>}
      </div>

      {/* Enhanced progress bar for "about to migrate" */}
      {showProgress && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-600 mb-1">
            <span>Migration</span>
            <span className="text-yellow-400 font-bold">{bondingPct.toFixed(0)}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div
              className="h-2 rounded-full transition-all duration-500"
              style={{
                width: `${bondingPct}%`,
                background: 'linear-gradient(90deg, #f59e0b, #ef4444)',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ emoji, title, count, subtitle, accentColor = 'text-white' }) {
  return (
    <div className="flex items-center gap-3 mb-4 pb-3 border-b border-gray-800">
      <span className="text-2xl">{emoji}</span>
      <div className="flex-1">
        <h2 className={`text-base font-bold ${accentColor}`}>{title}</h2>
        {subtitle && <p className="text-gray-600 text-xs mt-0.5">{subtitle}</p>}
      </div>
      <span className="text-xs font-mono bg-gray-800 text-gray-400 px-2 py-1 rounded-full">{count}</span>
    </div>
  );
}

export default function Market() {
  const { socket }  = useSocket();
  const { push }    = useToast();
  const { coins, loading, error, refresh, lastRefresh } = useCoins(socket, push);
  const [search, setSearch]               = useState('');
  const [selectedCoinId, setSelectedCoinId] = useState(null);
  const [sortKey, setSortKey]               = useState('age-asc'); // default: oldest first

  const SORTS = [
    { key: 'age-asc',    label: '🕐 Oldest',   fn: (a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0) },
    { key: 'age-desc',   label: '🆕 Newest',   fn: (a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0) },
    { key: 'mc-desc',    label: '💰 MC High',  fn: (a, b) => getMC(b) - getMC(a) },
    { key: 'mc-asc',     label: '📉 MC Low',   fn: (a, b) => getMC(a) - getMC(b) },
    { key: 'gain-desc',  label: '🚀 Gainers',  fn: (a, b) => (b.change24h ?? 0) - (a.change24h ?? 0) },
    { key: 'gain-asc',   label: '💀 Losers',   fn: (a, b) => (a.change24h ?? 0) - (b.change24h ?? 0) },
  ];

  const activeSortFn = SORTS.find((s) => s.key === sortKey)?.fn ?? SORTS[0].fn;

  const filtered = search
    ? coins.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.ticker.toLowerCase().includes(search.toLowerCase())
      )
    : coins;

  // ── 🟢 New Tokens — not migrated, MC < $50k
  const newTokens = filtered
    .filter((c) => !c.migrated && getMC(c) < ABOUT_TO_MIGRATE)
    .sort(activeSortFn);

  // ── 🔥 About to Migrate — not migrated, MC $50k–$69k (always closest to migration first, then secondary sort)
  const aboutToMigrate = filtered
    .filter((c) => !c.migrated && getMC(c) >= ABOUT_TO_MIGRATE && getMC(c) < MIGRATION_THRESHOLD)
    .sort(activeSortFn);

  // ── 🚀 Just Migrated — migrated OR MC >= $69k
  const justMigrated = filtered
    .filter((c) => c.migrated || getMC(c) >= MIGRATION_THRESHOLD)
    .sort(activeSortFn);

  if (error) return (
    <div className="max-w-4xl mx-auto p-8 text-red-400">Error: {error}</div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Memecoin Market</h1>
          <p className="text-gray-600 text-sm mt-1">
            Live prices · New token every 10s · {coins.length} live
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-gray-900 border border-gray-800 text-white placeholder-gray-600
              rounded-lg px-3 py-2 text-sm w-44 focus:outline-none focus:border-gray-600
              transition-colors"
          />
          <button
            onClick={refresh}
            title="Refresh market"
            className="bg-gray-900 border border-gray-800 hover:border-gray-600 text-gray-500 hover:text-white
              rounded-lg px-3 py-2 text-sm transition-all flex items-center gap-1.5"
          >
            🔄{' '}
            {lastRefresh
              ? lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              : 'Refresh'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-center py-20">Loading market data...</div>
      ) : (
        <>
          {/* Stats Bar */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard label="Live Tokens"      value={coins.length}          color="text-white" />
            <StatCard label="About to Migrate" value={aboutToMigrate.length} color="text-yellow-400" />
            <StatCard label="Migrated"         value={justMigrated.length}   color="text-purple-400" />
          </div>

          {/* Sort bar */}
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            <span className="text-gray-600 text-xs uppercase tracking-wider mr-1">Sort:</span>
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSortKey(s.key)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all duration-150
                  ${
                    sortKey === s.key
                      ? 'bg-white text-gray-950 border-white'
                      : 'bg-transparent text-gray-500 border-gray-700 hover:border-gray-500 hover:text-gray-300'
                  }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* 3-column layout */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* ── 🟢 New Tokens ─────────────────────── */}
            <div className="flex flex-col">
              <SectionHeader
                emoji="🟢"
                title="New Tokens"
                count={newTokens.length}
                subtitle={`MC < $50K · ${SORTS.find(s => s.key === sortKey)?.label ?? 'Oldest'}`}
                accentColor="text-green-400"
              />
              <div className="flex-1 max-h-[70vh] overflow-y-auto space-y-2 pr-1
                scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
                {newTokens.length === 0 ? (
                  <div className="text-gray-600 text-sm text-center py-12">No new tokens</div>
                ) : (
                  newTokens.map((coin) => (
                    <CoinCard
                      key={coin.id}
                      coin={coin}
                      onClick={() => setSelectedCoinId(coin.id)}
                    />
                  ))
                )}
              </div>
            </div>

            {/* ── 🔥 About to Migrate ───────────────── */}
            <div className="flex flex-col">
              <SectionHeader
                emoji="🔥"
                title="About to Migrate"
                count={aboutToMigrate.length}
                subtitle="$50K–$69K · Closest first"
                accentColor="text-yellow-400"
              />
              <div className="flex-1 max-h-[70vh] overflow-y-auto space-y-2 pr-1
                scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
                {aboutToMigrate.length === 0 ? (
                  <div className="text-gray-600 text-sm text-center py-12">None approaching yet</div>
                ) : (
                  aboutToMigrate.map((coin) => (
                    <CoinCard
                      key={coin.id}
                      coin={coin}
                      showProgress
                      onClick={() => setSelectedCoinId(coin.id)}
                    />
                  ))
                )}
              </div>
            </div>

            {/* ── 🚀 Just Migrated ──────────────────── */}
            <div className="flex flex-col">
              <SectionHeader
                emoji="🚀"
                title="Just Migrated"
                count={justMigrated.length}
                subtitle="Crossed $69K · Still trading"
                accentColor="text-purple-400"
              />
              <div className="flex-1 max-h-[70vh] overflow-y-auto space-y-2 pr-1
                scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
                {justMigrated.length === 0 ? (
                  <div className="text-gray-600 text-sm text-center py-12">
                    <div className="text-4xl mb-2">🎓</div>
                    <div>No graduates yet</div>
                    <div className="text-xs mt-1 text-gray-700">First to $69K MC!</div>
                  </div>
                ) : (
                  justMigrated.map((coin) => (
                    <CoinCard
                      key={coin.id}
                      coin={coin}
                      showBadge
                      onClick={() => setSelectedCoinId(coin.id)}
                    />
                  ))
                )}
              </div>
            </div>

          </div>
        </>
      )}

      {selectedCoinId && (
        <CoinModal coinId={selectedCoinId} onClose={() => setSelectedCoinId(null)} />
      )}
    </div>
  );
}
