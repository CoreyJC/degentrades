import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const SOL_USD = 150;

function fmtUSD(sol) {
  const usd = sol * SOL_USD;
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000)     return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000)         return `$${(usd / 1_000).toFixed(2)}K`;
  return `$${usd.toFixed(2)}`;
}

const REWARD_TIERS = [
  { rank: 1,     label: '🥇 #1',    sol: 100, color: 'from-yellow-500/20 to-yellow-600/10 border-yellow-500/40 text-yellow-300' },
  { rank: 2,     label: '🥈 #2',    sol: 50,  color: 'from-slate-400/20 to-slate-500/10 border-slate-400/40 text-slate-300' },
  { rank: 3,     label: '🥉 #3',    sol: 25,  color: 'from-orange-700/20 to-orange-800/10 border-orange-600/40 text-orange-300' },
  { rank: '4-5', label: '4-5',      sol: 15,  color: 'from-purple-500/10 to-purple-600/5 border-purple-500/30 text-purple-300' },
  { rank: '6-10',label: '6-10',     sol: 10,  color: 'from-indigo-500/10 to-indigo-600/5 border-indigo-500/30 text-indigo-300' },
];

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-xl border border-gray-800/50 bg-gray-900/30 animate-pulse">
      <div className="w-7 h-5 bg-gray-700 rounded" />
      <div className="flex-1 h-4 bg-gray-700 rounded w-32" />
      <div className="w-20 h-4 bg-gray-700 rounded" />
      <div className="w-16 h-4 bg-gray-700 rounded" />
    </div>
  );
}

function PodiumCard({ row, rank }) {
  const configs = {
    1: {
      glow: 'shadow-[0_0_30px_rgba(234,179,8,0.25)]',
      border: 'border-yellow-500/50',
      bg: 'bg-gradient-to-br from-yellow-950/60 to-gray-900/80',
      label: 'text-yellow-400',
      badge: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
      icon: '👑',
      size: 'scale-105',
    },
    2: {
      glow: 'shadow-[0_0_20px_rgba(148,163,184,0.2)]',
      border: 'border-slate-400/50',
      bg: 'bg-gradient-to-br from-slate-800/60 to-gray-900/80',
      label: 'text-slate-300',
      badge: 'bg-slate-500/20 text-slate-300 border-slate-400/40',
      icon: '🥈',
      size: '',
    },
    3: {
      glow: 'shadow-[0_0_20px_rgba(194,120,58,0.2)]',
      border: 'border-orange-600/50',
      bg: 'bg-gradient-to-br from-orange-950/60 to-gray-900/80',
      label: 'text-orange-300',
      badge: 'bg-orange-600/20 text-orange-300 border-orange-600/40',
      icon: '🥉',
      size: '',
    },
  };

  const c = configs[rank];
  const up = row.gainPct >= 0;

  return (
    <div className={`relative flex flex-col gap-2 p-4 rounded-2xl border ${c.border} ${c.bg} ${c.glow} ${c.size} transition-transform`}>
      <div className="flex items-center justify-between">
        <span className="text-2xl">{c.icon}</span>
        <span className={`text-xs font-bold px-2 py-1 rounded-full border ${c.badge}`}>
          +{row.bonusSol} SOL
        </span>
      </div>
      <div className={`font-bold text-lg truncate ${c.label}`}>{row.username}</div>
      <div className="flex items-end justify-between mt-1">
        <div>
          <div className="text-gray-400 text-xs">Portfolio</div>
          <div className="font-mono text-white font-semibold">{fmtUSD(row.currentValue)}</div>
        </div>
        <div className="text-right">
          <div className="text-gray-400 text-xs">Gain</div>
          <div className={`font-mono font-bold text-sm ${up ? 'text-green-400' : 'text-red-400'}`}>
            {up ? '+' : ''}{row.gainPct.toFixed(2)}%
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Leaderboard() {
  const { user } = useAuth();
  const [rows, setRows]       = useState([]);
  const [season, setSeason]   = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [lbRes, seasonRes] = await Promise.all([
        axios.get('/api/leaderboard'),
        axios.get('/api/leaderboard/season'),
      ]);
      setRows(lbRes.data);
      setSeason(seasonRes.data);
    } catch (err) {
      console.error('Leaderboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30_000);
    return () => clearInterval(t);
  }, []);

  // Find current user rank (may be outside top 20)
  const myRank = rows.findIndex((r) => r.username === user?.username);

  const top3  = rows.slice(0, 3);
  const rest  = rows.slice(3);

  return (
    <div
      className="min-h-screen"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(99,56,206,0.15) 0%, rgba(10,10,18,1) 60%)' }}
    >
      <div className="max-w-3xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-4xl font-black text-white tracking-tight">
            🏆 DEGEN LEADERBOARD
          </h1>
          <p className="text-gray-400 mt-2 text-sm">Top 10 traders win SOL rewards each month</p>
        </div>

        {/* Season Banner */}
        {season && (
          <div className="flex items-center justify-between px-5 py-3 rounded-2xl border border-indigo-500/30 bg-indigo-950/40 mb-5">
            <div className="flex items-center gap-2">
              <span className="text-indigo-400 font-bold text-lg">Season #{season.currentSeason.number}</span>
              <span className="text-gray-500 text-sm">•</span>
              <span className="text-gray-400 text-sm">
                Started {new Date(season.currentSeason.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500 uppercase tracking-wider">Resets in</div>
              <div className="text-indigo-300 font-bold">{season.currentSeason.daysUntilReset}d</div>
            </div>
          </div>
        )}

        {/* Rewards Legend */}
        <div className="grid grid-cols-5 gap-2 mb-7">
          {REWARD_TIERS.map((tier) => (
            <div
              key={tier.rank}
              className={`flex flex-col items-center py-2 px-1 rounded-xl border bg-gradient-to-b ${tier.color} text-center`}
            >
              <div className="font-bold text-xs">{tier.label}</div>
              <div className="text-white font-black text-sm mt-0.5">{tier.sol}</div>
              <div className="text-gray-400 text-xs">SOL</div>
            </div>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="text-gray-600 text-center py-16 text-lg">No players yet — be the first degen!</div>
        )}

        {!loading && rows.length > 0 && (
          <>
            {/* Top 3 Podium */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {top3.map((row, i) => (
                <PodiumCard key={row.username} row={row} rank={i + 1} />
              ))}
            </div>

            {/* Ranks 4-20 */}
            {rest.length > 0 && (
              <div className="space-y-1.5">
                {rest.map((row, i) => {
                  const rank = i + 4;
                  const isMe = row.username === user?.username;
                  const isTop10 = rank <= 10;
                  const up = row.gainPct >= 0;
                  return (
                    <div
                      key={row.username}
                      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-colors
                        ${isMe
                          ? 'border-indigo-500/50 bg-indigo-950/40'
                          : 'border-gray-800/60 bg-gray-900/40 hover:bg-gray-900/60'}`}
                    >
                      {/* Rank badge */}
                      <span className={`text-xs font-bold w-7 h-6 flex items-center justify-center rounded-md
                        ${isTop10 ? 'bg-green-900/60 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                        {rank}
                      </span>

                      {/* Username */}
                      <span className={`flex-1 font-semibold text-sm ${isMe ? 'text-indigo-300' : 'text-white'}`}>
                        {row.username}
                        {isMe && <span className="text-xs text-indigo-500 ml-1.5">(you)</span>}
                      </span>

                      {/* Bonus SOL badge for top 10 */}
                      {isTop10 && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-900/50 text-purple-300 border border-purple-700/40">
                          +{row.bonusSol} SOL
                        </span>
                      )}

                      {/* Portfolio value */}
                      <span className="font-mono text-gray-400 text-xs w-20 text-right hidden sm:block">
                        {fmtUSD(row.currentValue)}
                      </span>

                      {/* Gain */}
                      <span className={`font-mono font-bold text-sm w-20 text-right ${up ? 'text-green-400' : 'text-red-400'}`}>
                        {up ? '+' : ''}{row.gainPct.toFixed(2)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Current user pinned if not in top 20 */}
            {user && myRank === -1 && (
              <div className="mt-4 px-4 py-3 rounded-xl border border-indigo-600/40 bg-indigo-950/30">
                <p className="text-indigo-400 text-sm text-center">
                  You're not in the top 20 yet — keep trading! 🚀
                </p>
              </div>
            )}

            {/* User rank summary if in list */}
            {user && myRank !== -1 && (
              <div className="mt-4 text-center text-gray-500 text-xs">
                You are ranked <span className="text-indigo-300 font-bold">#{myRank + 1}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
