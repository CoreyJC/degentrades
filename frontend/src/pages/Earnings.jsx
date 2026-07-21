import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function fmtSol(n) {
  if (n == null) return '0 SOL';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M SOL`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(2)}K SOL`;
  return `${n.toFixed(4)} SOL`;
}
function fmtUsd(n) {
  if (!n) return '';
  if (n >= 1_000_000) return `≈$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `≈$${(n / 1_000).toFixed(2)}K`;
  return `≈$${n.toFixed(2)}`;
}
function fmtTime(ms) {
  if (ms <= 0) return '0s';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
function fmtDate(d) {
  return new Date(d).toLocaleString();
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col gap-1">
      <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      <span className="text-2xl font-bold" style={{ color: accent || '#00ff88' }}>{value}</span>
      {sub && <span className="text-xs text-gray-500">{sub}</span>}
    </div>
  );
}

// Active epoch card with live countdown
function EpochCard({ epoch }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const endsAt   = new Date(epoch.endsAt).getTime();
  const startedAt = new Date(epoch.startedAt).getTime();
  const msLeft   = Math.max(0, endsAt - now);
  const totalMs  = endsAt - startedAt;
  const pct      = Math.min(100, ((epoch.distributedSol / epoch.totalSol) * 100)).toFixed(1);
  const timePct  = Math.min(100, ((totalMs - msLeft) / totalMs) * 100);
  const nextTickMs = 60_000 - ((now - startedAt) % 60_000);

  return (
    <div className="bg-gray-900 border border-green-500/20 rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-sm font-bold text-green-400">ACTIVE DISTRIBUTION</span>
        </div>
        <span className="text-xs text-gray-500">ends in {fmtTime(msLeft)}</span>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Distributed: {fmtSol(epoch.distributedSol)}</span>
          <span>Total: {fmtSol(epoch.totalSol)}</span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #00ff88, #00cc6a)' }}
          />
        </div>
        <div className="text-right text-xs text-gray-500 mt-1">{pct}% complete</div>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 pt-1 border-t border-gray-800">
        <span>⏱ Next payout in <span className="text-white font-mono">{fmtTime(nextTickMs)}</span></span>
        <span>~{fmtSol((epoch.totalSol - epoch.distributedSol) / Math.max(1, Math.ceil(msLeft / 60_000)))} / tick</span>
      </div>
    </div>
  );
}

export default function Earnings() {
  const { user } = useAuth();
  const [stats, setStats]       = useState(null);
  const [epochs, setEpochs]     = useState([]);
  const [myPayouts, setMyPayouts] = useState(null);
  const [wallet, setWallet]     = useState('');
  const [savedWallet, setSavedWallet] = useState(null);
  const [saving, setSaving]     = useState(false);
  const [saveMsg, setSaveMsg]   = useState(null);
  const [removing, setRemoving] = useState(false);
  const intervalRef = useRef(null);

  function authHeaders() {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function loadAll() {
    try {
      const [statsRes, epochsRes] = await Promise.all([
        axios.get(`${API}/api/earnings/stats`,  { headers: authHeaders() }),
        axios.get(`${API}/api/earnings/epochs`, { headers: authHeaders() }),
      ]);
      setStats(statsRes.data);
      setEpochs(epochsRes.data);
      if (statsRes.data.myWallet) {
        setSavedWallet(statsRes.data.myWallet);
        // Load this wallet's payouts
        const pRes = await axios.get(`${API}/api/earnings/payouts?wallet=${statsRes.data.myWallet}`);
        setMyPayouts(pRes.data);
      }
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    loadAll();
    intervalRef.current = setInterval(loadAll, 15_000);
    return () => clearInterval(intervalRef.current);
  }, [user]);

  async function saveWallet(e) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    try {
      const { data } = await axios.put(
        `${API}/api/earnings/wallet`,
        { walletAddress: wallet.trim() },
        { headers: authHeaders() }
      );
      setSavedWallet(data.walletAddress);
      setSaveMsg({ type: 'ok', text: '✅ Wallet registered — you\'ll receive payouts automatically.' });
      setWallet('');
      loadAll();
    } catch (err) {
      setSaveMsg({ type: 'err', text: err.response?.data?.error || 'Failed to save wallet' });
    } finally {
      setSaving(false);
    }
  }

  async function removeWallet() {
    setRemoving(true);
    try {
      await axios.delete(`${API}/api/earnings/wallet`, { headers: authHeaders() });
      setSavedWallet(null);
      setMyPayouts(null);
      setSaveMsg({ type: 'ok', text: 'Wallet removed.' });
    } catch {
      setSaveMsg({ type: 'err', text: 'Failed to remove wallet' });
    } finally {
      setRemoving(false);
    }
  }

  const activeEpochs = epochs.filter(e => e.status === 'active');
  const pastEpochs   = epochs.filter(e => e.status !== 'active');
  const svcReady     = stats?.distributionService?.ready;

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* ── Hero ── */}
      <div className="relative overflow-hidden border-b border-gray-800">
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 70% 60% at 50% -10%, rgba(0,255,136,0.08) 0%, transparent 70%)' }} />
        <div className="relative max-w-5xl mx-auto px-4 py-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 text-xs font-semibold uppercase tracking-widest mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Token Launching on pump.fun · Soon
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
            Hold <span style={{ color: '#00ff88' }}>$DEGEN</span> · Earn Real SOL
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto mb-8">
            Every trade on DegenTrades generates a <strong className="text-white">1% protocol fee</strong>.{' '}
            <strong style={{ color: '#00ff88' }}>50% of those fees</strong> are automatically sent to{' '}
            <strong className="text-white">$DEGEN holders</strong> every 60 seconds. No claiming required.
          </p>
          <a href="https://pump.fun" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:scale-105"
            style={{ background: 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)', color: '#0a0a0a' }}>
            🚀 Buy $DEGEN on pump.fun
          </a>
          <p className="text-xs text-gray-600 mt-2">Contract address announced at launch</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-12 space-y-12">

        {/* ── Distribution service status ── */}
        {stats && (
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
            svcReady
              ? 'border-green-500/20 bg-green-500/5 text-green-400'
              : 'border-yellow-500/20 bg-yellow-500/5 text-yellow-400'
          }`}>
            <span className={`w-2 h-2 rounded-full ${svcReady ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
            {svcReady ? (
              <>
                Distribution engine <strong>live</strong> · monitoring treasury{' '}
                <span className="font-mono text-xs opacity-70">
                  {stats.distributionService.treasuryAddress?.slice(0, 8)}…
                </span>
                {stats.distributionService.tokenMint
                  ? ` · verifying on-chain $DEGEN balance`
                  : ` · awaiting token CA`}
              </>
            ) : (
              'Distribution engine offline. Treasury wallet not configured yet.'
            )}
          </div>
        )}

        {/* ── Active epochs ── */}
        {activeEpochs.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-200">Live Distributions</h2>
            {activeEpochs.map(e => <EpochCard key={e.id} epoch={e} />)}
          </section>
        )}

        {/* ── Platform stats ── */}
        <section>
          <h2 className="text-lg font-bold text-gray-200 mb-6">
            Platform stats <span className="text-xs text-gray-600 font-normal">· refreshes every 15s</span>
          </h2>
          {stats ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Volume"       value={fmtSol(stats.totalVolumeSol)}        sub={fmtUsd(stats.totalVolumeSolUsd)} />
              <StatCard label="Fees Collected"     value={fmtSol(stats.totalFeesSol)}          sub={fmtUsd(stats.totalFeesSolUsd)}   accent="#facc15" />
              <StatCard label="SOL Distributed"    value={fmtSol(stats.allTimeDistributedSol)} sub="to holders"                      accent="#00ff88" />
              <StatCard label="Registered Wallets" value={stats.registeredCount}               sub={`of ${stats.traderCount} traders`} accent="#a78bfa" />
            </div>
          ) : (
            <div className="text-gray-600 text-sm animate-pulse">Loading…</div>
          )}
        </section>

        {/* ── How it works ── */}
        <section>
          <h2 className="text-lg font-bold text-gray-200 mb-6">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: '🪙', step: '1', title: 'Buy $DEGEN', desc: 'Get the token on pump.fun. Your share of payouts is proportional to how much you hold.' },
              { icon: '🔗', step: '2', title: 'Register your wallet', desc: 'Paste your Solana wallet address below. This is where your SOL earnings land automatically.' },
              { icon: '💸', step: '3', title: 'Get paid every 60s', desc: 'Fees are distributed automatically and continuously to all $DEGEN holders. The more volume DegenTrades generates, the more you earn.' },
            ].map(s => (
              <div key={s.step} className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{s.icon}</span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(0,255,136,0.1)', color: '#00ff88' }}>
                    Step {s.step}
                  </span>
                </div>
                <h3 className="font-bold text-white">{s.title}</h3>
                <p className="text-sm text-gray-400">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Wallet registration ── */}
        <section>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: 'rgba(0,255,136,0.1)' }}>🔗</div>
              <div>
                <h2 className="text-lg font-bold text-white">Register Your Wallet</h2>
                <p className="text-sm text-gray-400 mt-1">
                  Link your Solana wallet so SOL earnings hit your address automatically.{' '}
                  {!user && (
                    <><Link to="/login" className="underline" style={{ color: '#00ff88' }}>Log in</Link>{' '}
                    or{' '}<Link to="/register" className="underline" style={{ color: '#00ff88' }}>sign up</Link> to register.</>
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
                <button onClick={removeWallet} disabled={removing}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors whitespace-nowrap">
                  {removing ? 'Removing…' : 'Remove'}
                </button>
              </div>
            )}

            {user ? (
              <form onSubmit={saveWallet} className="flex flex-col sm:flex-row gap-3">
                <input type="text" value={wallet} onChange={e => setWallet(e.target.value)}
                  placeholder="Your Solana wallet address…"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white
                    placeholder-gray-600 focus:outline-none focus:border-green-500/50 font-mono" />
                <button type="submit" disabled={saving || !wallet.trim()}
                  className="px-6 py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-40 hover:scale-105"
                  style={{ background: 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)', color: '#0a0a0a' }}>
                  {saving ? 'Saving…' : savedWallet ? 'Update' : 'Register'}
                </button>
              </form>
            ) : (
              <div className="flex gap-3">
                <Link to="/login" className="px-6 py-3 rounded-xl font-bold text-sm border border-gray-600
                  hover:border-gray-400 text-gray-300 hover:text-white transition-colors">Log in</Link>
                <Link to="/register" className="px-6 py-3 rounded-xl font-bold text-sm hover:scale-105 transition-all"
                  style={{ background: 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)', color: '#0a0a0a' }}>
                  Sign up free
                </Link>
              </div>
            )}

            {saveMsg && (
              <p className={`mt-3 text-sm ${saveMsg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                {saveMsg.text}
              </p>
            )}
          </div>
        </section>

        {/* ── My payout history ── */}
        {myPayouts && myPayouts.payouts.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-200">Your Earnings</h2>
              <span className="text-sm font-bold" style={{ color: '#00ff88' }}>
                {fmtSol(myPayouts.totalSol)} total
              </span>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Amount</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Tx</th>
                    <th className="text-left px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {myPayouts.payouts.map(p => (
                    <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-4 py-3 font-bold" style={{ color: '#00ff88' }}>
                        +{fmtSol(p.amountSol)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 hidden sm:table-cell">
                        {p.txSig
                          ? <a href={`https://solscan.io/tx/${p.txSig}`} target="_blank" rel="noopener noreferrer"
                              className="hover:text-white transition-colors">
                              {p.txSig.slice(0, 8)}…
                            </a>
                          : 'N/A'
                        }
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Past epochs ── */}
        {pastEpochs.length > 0 && (
          <section>
            <h2 className="text-lg font-bold text-gray-200 mb-4">Distribution History</h2>
            <div className="space-y-2">
              {pastEpochs.map(e => {
                const pct = ((e.distributedSol / e.totalSol) * 100).toFixed(0);
                return (
                  <div key={e.id} className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4
                    flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-500">
                        {e.status === 'completed' ? '✅' : '❌'} {e.status}
                      </span>
                      <span className="text-sm text-gray-300">{fmtSol(e.totalSol)} total</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold" style={{ color: '#00ff88' }}>
                        {fmtSol(e.distributedSol)} sent
                      </div>
                      <div className="text-xs text-gray-500">{fmtDate(e.startedAt)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── CTA ── */}
        <section className="text-center py-8 border-t border-gray-800">
          <p className="text-gray-500 text-sm mb-4">The more volume DegenTrades generates, the more SOL flows to you.</p>
          <a href="https://pump.fun" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl font-bold text-base transition-all hover:scale-105"
            style={{ background: 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)', color: '#0a0a0a' }}>
            🚀 Get $DEGEN on pump.fun
          </a>
        </section>

      </div>
    </div>
  );
}
