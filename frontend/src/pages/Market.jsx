import { useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useToast }  from '../context/ToastContext';
import { useCoins }  from '../hooks/useCoins';
import CoinModal     from '../components/CoinModal';

const TOTAL_SUPPLY        = 1_000_000_000;
const MIGRATION_THRESHOLD = 30_000;
const ABOUT_TO_MIGRATE    = 20_000;

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

  const filtered = search
    ? coins.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.ticker.toLowerCase().includes(search.toLowerCase())
      )
    : coins;

  // ── 🟢 New Tokens — not migrated, MC < $20k, newest first
  const newTokens = filtered
    .filter((c) => !c.migrated && getMC(c) < ABOUT_TO_MIGRATE)
    .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));

  // ── 🔥 About to Migrate — not migrated, MC $20k–$30k
  const aboutToMigrate = filtered
    .filter((c) => !c.migrated && getMC(c) >= ABOUT_TO_MIGRATE && getMC(c) < MIGRATION_THRESHOLD)
    .sort((a, b) => getMC(b) - getMC(a));

  // ── 🚀 Just Migrated — migrated, sorted by migratedAt DESC (no cap, tokens keep moving)
  const justMigrated = filtered
    .filter((c) => c.migrated)
    .sort((a, b) => new Date(b.migratedAt ?? 0) - new Date(a.migratedAt ?? 0));

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

          {/* ── 🟢 New Tokens ──────────────────────────────────────────────── */}
          <div>
            <SectionHeader
              emoji="🟢"
              title="New Tokens"
              count={`${newTokens.length} tokens`}
              subtitle="MC < $20K · Newest first"
            />
            <div className="flex flex-col gap-3 overflow-y-auto max-h-[70vh] pr-1">
              {newTokens.length === 0 ? (
                <div className="text-gray-600 text-sm text-center py-8">No new tokens</div>
              ) : (
                newTokens.map((coin) => (
                  <CoinCard key={coin.id} coin={coin} onClick={() => setSelectedCoinId(coin.id)} />
                ))
              )}
            </div>
          </div>

          {/* ── 🔥 About to Migrate ────────────────────────────────────────── */}
          <div>
            <SectionHeader
              emoji="🔥"
              title="About to Migrate"
              count={`${aboutToMigrate.length} tokens`}
              subtitle="MC $20K–$30K · Closest to 🎓"
            />
            <div className="flex flex-col gap-3 overflow-y-auto max-h-[70vh] pr-1">
              {aboutToMigrate.length === 0 ? (
                <div className="text-gray-600 text-sm text-center py-8">None approaching yet</div>
              ) : (
                aboutToMigrate.map((coin) => {
                  const mc  = getMC(coin);
                  const pct = Math.min((mc / MIGRATION_THRESHOLD) * 100, 100).toFixed(1);
                  return (
                    <div key={coin.id}>
                      <CoinCard coin={coin} onClick={() => setSelectedCoinId(coin.id)} />
                      <div className="px-4 pb-3 -mt-1 bg-gray-900 border border-t-0 border-gray-800 rounded-b-xl">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>Migration</span><span>{pct}%</span>
                        </div>
                        <div className="w-full bg-gray-800 rounded-full h-1.5">
                          <div className="bg-green-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── 🚀 Just Migrated ───────────────────────────────────────────── */}
          <div>
            <SectionHeader
              emoji="🚀"
              title="Just Migrated"
              count={`${justMigrated.length} tokens`}
              subtitle="Crossed $30K · Still trading"
            />
            <div className="flex flex-col gap-3 overflow-y-auto max-h-[70vh] pr-1">
              {justMigrated.length === 0 ? (
                <div className="text-gray-600 text-sm text-center py-8">
                  <div className="text-4xl mb-2">🎓</div>
                  <div>No graduates yet</div>
                  <div className="text-xs mt-1">First to $30K MC!</div>
                </div>
              ) : (
                justMigrated.map((coin) => (
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
