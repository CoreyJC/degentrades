import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const MEDALS = ['🥇', '🥈', '🥉'];
const SOL_USD = 150;
function fmtUSD(sol) {
  const usd = sol * SOL_USD;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000)     return `$${(usd / 1_000).toFixed(2)}K`;
  return `$${usd.toFixed(2)}`;
}

export default function Leaderboard() {
  const { user } = useAuth();
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/api/leaderboard').then(({ data }) => {
      setRows(data);
      setLoading(false);
    });
    // Refresh every 30s
    const t = setInterval(() => {
      axios.get('/api/leaderboard').then(({ data }) => setRows(data));
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  if (loading) return <div className="text-gray-500 text-center py-20">Loading...</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-white mb-2">🏆 Leaderboard</h1>
      <p className="text-gray-500 text-sm mb-6">Top degens ranked by % gain from 100 SOL</p>

      <div className="space-y-2">
        {rows.map((row, i) => {
          const isMe = row.username === user?.username;
          const up   = row.gainPct >= 0;
          return (
            <div
              key={row.username}
              className={`flex items-center gap-4 px-4 py-3 rounded-xl border transition-colors
                ${isMe
                  ? 'border-indigo-600 bg-indigo-950/40'
                  : 'border-gray-800 bg-gray-900/50'}`}
            >
              <span className="text-lg w-7 text-center">
                {MEDALS[i] ?? <span className="text-gray-600 font-mono text-sm">{i + 1}</span>}
              </span>
              <span className={`flex-1 font-semibold ${isMe ? 'text-indigo-300' : 'text-white'}`}>
                {row.username} {isMe && <span className="text-xs text-indigo-500">(you)</span>}
              </span>
              <span className="font-mono text-gray-400 text-sm">
                {fmtUSD(row.currentValue)}
              </span>
              <span className={`font-mono font-bold text-sm w-20 text-right
                ${up ? 'text-green-400' : 'text-red-400'}`}>
                {up ? '+' : ''}{row.gainPct.toFixed(2)}%
              </span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="text-gray-600 text-center py-12">No players yet</div>
        )}
      </div>
    </div>
  );
}
