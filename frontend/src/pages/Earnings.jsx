import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const SOL_USD = 150;

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col gap-1">
      <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      <span
        className="text-2xl font-bold"
        style={{ color: accent || '#00ff88' }}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-gray-500">{sub}</span>}
    </div>
  );
}

function fmtSol(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M SOL`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(2)}K SOL`;
  return `${n.toFixed(4)} SOL`;
}

function fmtUsd(n) {
  if (n == null) return '';
  if (n >= 1_000_000) return `≈ $${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `≈ $${(n / 1_000).toFixed(2)}K`;
  return `≈ $${n.toFixed(2)}`;
}

export default function Earnings() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [wallet, setWallet] = useState('');
  const [savedWallet, setSavedWallet] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [removing, setRemoving] = useState(false);

  async function loadStats() {
    try {
      const headers = {};
      const token = localStorage.getItem('token');
      if (token) headers.Authorization = `Bearer ${token}`;
      const { data } = await axios.get(`${API}/api/earnings/stats`, { headers });
      setStats(data);
      if (data.myWallet) setSavedWallet(data.myWallet);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    loadStats();
    const id = setInterval(loadStats, 15_000);
    return () => clearInterval(id);
  }, [user]);

  async function saveWallet(e) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.put(
        `${API}/api/earnings/wallet`,
        { walletAddress: wallet.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSavedWallet(data.walletAddress);
      setSaveMsg({ type: 'ok', text: '✅ Wallet registered! You\'ll receive your share when the token launches.' });
      setWallet('');
    } catch (err) {
      setSaveMsg({ type: 'err', text: err.response?.data?.error || 'Failed to save wallet' });
    } finally {
      setSaving(false);
    }
  }

  async function removeWallet() {
    setRemoving(true);
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API}/api/earnings/wallet`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSavedWallet(null);
      setSaveMsg({ type: 'ok', text: 'Wallet removed.' });
    } catch (err) {
      setSaveMsg({ type: 'err', text: 'Failed to remove wallet' });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* ── Hero ── */}
      <div className="relative overflow-hidden border-b border-gray-800">
        {/* Background glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 70% 60% at 50% -10%, rgba(0,255,136,0.08) 0%, transparent 70%)',
          }}
        />

        <div className="relative max-w-5xl mx-auto px-4 py-16 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 text-xs font-semibold uppercase tracking-widest mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Token Launching on pump.fun · Soon
          </div>

          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            Hold{' '}
            <span style={{ color: '#00ff88' }}>$DEGEN</span>
            {' '}— Earn Real SOL
          </h1>

          <p className="text-gray-400 text-lg max-w-2xl mx-auto mb-8">
            Every trade on DegenTrades generates a <strong className="text-white">1% protocol fee</strong>.{' '}
            <strong style={{ color: '#00ff88' }}>50% of those fees</strong> flow directly to{' '}
            <strong className="text-white">$DEGEN token holders</strong> on Solana — proportional to how much you hold.
          </p>

          <a
            href="https://pump.fun"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all"
            style={{
              background: 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)',
              color: '#0a0a0a',
            }}
          >
            🚀 Buy $DEGEN on pump.fun
          </a>
          <p className="text-xs text-gray-600 mt-2">Contract address will be announced at launch</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-12 space-y-12">

        {/* ── How it works ── */}
        <section>
          <h2 className="text-lg font-bold text-gray-200 mb-6">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                icon: '🪙',
                step: '1',
                title: 'Buy $DEGEN',
                desc: 'Grab the token on pump.fun once it launches. The more you hold, the bigger your share.',
              },
              {
                icon: '🔗',
                step: '2',
                title: 'Register your wallet',
                desc: 'Paste your Solana wallet address below. We use this to send your SOL earnings.',
              },
              {
                icon: '💸',
                step: '3',
                title: 'Collect earnings',
                desc: '50% of all platform fees are distributed to holders. Distributions happen weekly.',
              },
            ].map((s) => (
              <div
                key={s.step}
                className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex flex-col gap-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{s.icon}</span>
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(0,255,136,0.1)', color: '#00ff88' }}
                  >
                    Step {s.step}
                  </span>
                </div>
                <h3 className="font-bold text-white">{s.title}</h3>
                <p className="text-sm text-gray-400">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Platform Stats ── */}
        <section>
          <h2 className="text-lg font-bold text-gray-200 mb-6">
            Platform stats{' '}
            <span className="text-xs text-gray-600 font-normal">· updates every 15s</span>
          </h2>
          {stats ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Total Volume"
                value={fmtSol(stats.totalVolumeSol)}
                sub={fmtUsd(stats.totalVolumeSolUsd)}
              />
              <StatCard
                label="Fees Collected"
                value={fmtSol(stats.totalFeesSol)}
                sub={fmtUsd(stats.totalFeesSolUsd)}
                accent="#facc15"
              />
              <StatCard
                label="Holder Pool (50%)"
                value={fmtSol(stats.holderPoolSol)}
                sub={fmtUsd(stats.holderPoolSolUsd)}
                accent="#00ff88"
              />
              <StatCard
                label="Registered Wallets"
                value={stats.registeredCount.toLocaleString()}
                sub={`of ${stats.traderCount} traders`}
                accent="#a78bfa"
              />
            </div>
          ) : (
            <div className="text-gray-600 text-sm animate-pulse">Loading stats…</div>
          )}
        </section>

        {/* ── Wallet Registration ── */}
        <section>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
            <div className="flex items-start gap-4 mb-6">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: 'rgba(0,255,136,0.1)' }}
              >
                🔗
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Register Your Wallet</h2>
                <p className="text-sm text-gray-400 mt-1">
                  Link your Solana wallet so we know where to send your fee earnings.{' '}
                  {!user && (
                    <>
                      <Link to="/login" className="underline" style={{ color: '#00ff88' }}>
                        Log in
                      </Link>{' '}
                      or{' '}
                      <Link to="/register" className="underline" style={{ color: '#00ff88' }}>
                        sign up
                      </Link>{' '}
                      to register.
                    </>
                  )}
                </p>
              </div>
            </div>

            {savedWallet && (
              <div className="mb-6 p-4 rounded-xl border border-green-500/20 bg-green-500/5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-green-400 font-semibold mb-1">✅ Wallet registered</p>
                  <p className="text-sm text-gray-300 font-mono break-all">{savedWallet}</p>
                </div>
                <button
                  onClick={removeWallet}
                  disabled={removing}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors whitespace-nowrap"
                >
                  {removing ? 'Removing…' : 'Remove'}
                </button>
              </div>
            )}

            {user ? (
              <form onSubmit={saveWallet} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={wallet}
                  onChange={(e) => setWallet(e.target.value)}
                  placeholder="Your Solana wallet address (e.g. 7xKX…)"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white
                    placeholder-gray-600 focus:outline-none focus:border-green-500/50 font-mono"
                />
                <button
                  type="submit"
                  disabled={saving || !wallet.trim()}
                  className="px-6 py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-40"
                  style={{
                    background: 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)',
                    color: '#0a0a0a',
                  }}
                >
                  {saving ? 'Saving…' : savedWallet ? 'Update Wallet' : 'Register Wallet'}
                </button>
              </form>
            ) : (
              <div className="flex gap-3">
                <Link
                  to="/login"
                  className="px-6 py-3 rounded-xl font-bold text-sm border border-gray-600
                    hover:border-gray-400 text-gray-300 hover:text-white transition-colors"
                >
                  Log in
                </Link>
                <Link
                  to="/register"
                  className="px-6 py-3 rounded-xl font-bold text-sm transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)',
                    color: '#0a0a0a',
                  }}
                >
                  Sign up free
                </Link>
              </div>
            )}

            {saveMsg && (
              <p
                className={`mt-3 text-sm ${saveMsg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}
              >
                {saveMsg.text}
              </p>
            )}
          </div>
        </section>

        {/* ── Tokenomics ── */}
        <section>
          <h2 className="text-lg font-bold text-gray-200 mb-6">Tokenomics</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
              <h3 className="font-bold text-white">Fee Distribution</h3>
              {[
                { label: '50% → $DEGEN Holders', color: '#00ff88', pct: 50 },
                { label: '30% → Treasury / Dev', color: '#facc15', pct: 30 },
                { label: '20% → Buyback & Burn', color: '#a78bfa', pct: 20 },
              ].map((row) => (
                <div key={row.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400">{row.label}</span>
                    <span className="font-bold" style={{ color: row.color }}>{row.pct}%</span>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${row.pct}%`, background: row.color }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-3">
              <h3 className="font-bold text-white">Token Details</h3>
              {[
                { label: 'Name',       value: '$DEGEN' },
                { label: 'Network',    value: 'Solana' },
                { label: 'Platform',   value: 'pump.fun' },
                { label: 'Supply',     value: '1,000,000,000' },
                { label: 'Contract',   value: 'TBA at launch' },
                { label: 'Fee share',  value: '50% of 1% protocol fee' },
                { label: 'Payouts',    value: 'Weekly, pro-rata by holdings' },
              ].map((r) => (
                <div key={r.label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{r.label}</span>
                  <span className="text-gray-200 font-medium">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA footer ── */}
        <section className="text-center py-8 border-t border-gray-800">
          <p className="text-gray-500 text-sm mb-4">
            The more volume DegenTrades generates, the more SOL flows to holders.
          </p>
          <a
            href="https://pump.fun"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl font-bold text-base transition-all hover:scale-105"
            style={{
              background: 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)',
              color: '#0a0a0a',
            }}
          >
            🚀 Get $DEGEN on pump.fun
          </a>
        </section>

      </div>
    </div>
  );
}
