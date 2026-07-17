import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { createChart, ColorType, CrosshairMode } from 'lightweight-charts';
import axios from 'axios';
import { useAuth }   from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useToast }  from '../context/ToastContext';

function fmt(p) {
  if (p == null) return '—';
  if (p < 0.000001) return p.toExponential(4);
  if (p < 0.0001)   return `$${p.toFixed(7)}`;
  if (p < 0.01)     return `$${p.toFixed(6)}`;
  return `$${p.toFixed(4)}`;
}

function fmtMC(mc) {
  if (mc == null) return '—';
  if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(1)}M`;
  if (mc >= 1_000)     return `$${(mc / 1_000).toFixed(1)}K`;
  return `$${mc.toFixed(0)}`;
}

function LoginGateModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 max-w-sm w-full mx-4 text-center shadow-2xl">
        <div className="text-4xl mb-4">🔒</div>
        <h2 className="text-xl font-bold text-white mb-2">Sign in to start trading</h2>
        <p className="text-gray-400 text-sm mb-6">
          Create a free account to buy and sell memecoins on DegenTrades.
        </p>
        <div className="flex flex-col gap-3">
          <Link
            to="/register"
            className="w-full py-2.5 rounded-lg font-semibold text-sm transition-colors"
            style={{ backgroundColor: '#00ff88', color: '#0a0a0a' }}
          >
            Sign Up — It's Free
          </Link>
          <Link
            to="/login"
            className="w-full py-2.5 rounded-lg font-medium text-sm border border-gray-600
              text-gray-300 hover:border-gray-400 hover:text-white transition-colors"
          >
            Login
          </Link>
          <button
            onClick={onClose}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors mt-1"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CoinModal({ coinId, onClose }) {
  const { user }   = useAuth();
  const { socket } = useSocket();
  const { push }   = useToast();

  const chartRef   = useRef(null);
  const seriesRef  = useRef(null);
  const chartElRef = useRef(null);

  const [coin,      setCoin]      = useState(null);
  const [price,     setPrice]     = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [solAmt,    setSolAmt]    = useState('');
  const [coinAmt,   setCoinAmt]   = useState('');
  const [portfolio, setPortfolio] = useState(null);
  const [holding,   setHolding]   = useState(null);
  const [busy,      setBusy]      = useState(false);
  const [showGate,  setShowGate]  = useState(false);

  // Close on Escape key
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Load coin + portfolio
  useEffect(() => {
    async function load() {
      try {
        const requests = [axios.get('/api/coins')];
        if (user) requests.push(axios.get('/api/portfolio'));

        const [coinsRes, portRes] = await Promise.all(requests);
        const found = coinsRes.data.find((c) => c.id === coinId);
        if (!found) { onClose(); return; }
        setCoin(found);
        setPrice(found.currentPrice);

        if (portRes) {
          setPortfolio(portRes.data);
          const h = portRes.data.holdings.find((h) => h.coinId === coinId);
          setHolding(h ?? null);
        }
        setLoading(false);
      } catch {
        onClose();
      }
    }
    load();
  }, [coinId, user, onClose]);

  // Chart
  useEffect(() => {
    if (loading || !chartElRef.current) return;

    const chart = createChart(chartElRef.current, {
      layout:     { background: { type: ColorType.Solid, color: '#030712' }, textColor: '#9ca3af' },
      grid:       { vertLines: { color: '#111827' }, horzLines: { color: '#111827' } },
      crosshair:  { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1f2937' },
      timeScale:  { borderColor: '#1f2937', timeVisible: true },
      width:      chartElRef.current.clientWidth,
      height:     280,
    });
    chartRef.current = chart;

    const series = chart.addCandlestickSeries({
      upColor:        '#22c55e',
      downColor:      '#ef4444',
      borderUpColor:  '#22c55e',
      borderDownColor:'#ef4444',
      wickUpColor:    '#22c55e',
      wickDownColor:  '#ef4444',
    });
    seriesRef.current = series;

    axios.get(`/api/coins/${coinId}/history`).then(({ data }) => {
      series.setData(data);
      chart.timeScale().fitContent();
    });

    const ro = new ResizeObserver(() => {
      if (chartElRef.current) {
        chart.applyOptions({ width: chartElRef.current.clientWidth });
      }
    });
    ro.observe(chartElRef.current);

    return () => { chart.remove(); ro.disconnect(); };
  }, [loading, coinId]);

  // Socket events
  useEffect(() => {
    if (!socket) return;

    function onPriceUpdate(updates) {
      const u = updates[coinId];
      if (!u) return;
      setPrice(u.price);
      setCoin((prev) => prev ? { ...prev, currentPrice: u.price } : prev);
      if (seriesRef.current && u.candle) {
        seriesRef.current.update(u.candle);
      }
    }

    function onCoinDeleted({ coinId: deletedId, name, ticker }) {
      if (deletedId !== coinId) return;
      push(`💀 ${name} (${ticker}) was RUGGED`, 'rug', 8000);
      onClose();
    }

    socket.on('price_update', onPriceUpdate);
    socket.on('coin_deleted', onCoinDeleted);
    return () => {
      socket.off('price_update', onPriceUpdate);
      socket.off('coin_deleted', onCoinDeleted);
    };
  }, [socket, coinId, push, onClose]);

  // Auth guard
  function requireAuth() {
    if (!user) { setShowGate(true); return false; }
    return true;
  }

  async function buy() {
    if (!requireAuth()) return;
    const sol = parseFloat(solAmt);
    if (!sol || sol <= 0) return push('Enter a valid SOL amount', 'error');
    setBusy(true);
    try {
      const { data } = await axios.post('/api/trade/buy', { coinId, solAmount: sol });
      push(`✅ Bought ${data.coinsReceived.toExponential(3)} ${coin.ticker}`, 'success');
      setSolAmt('');
      const portRes = await axios.get('/api/portfolio');
      setPortfolio(portRes.data);
      setHolding(portRes.data.holdings.find((h) => h.coinId === coinId) ?? null);
    } catch (e) {
      push(e.response?.data?.error ?? 'Buy failed', 'error');
    } finally { setBusy(false); }
  }

  async function sell() {
    if (!requireAuth()) return;
    const amt = parseFloat(coinAmt);
    if (!amt || amt <= 0) return push('Enter a valid amount', 'error');
    setBusy(true);
    try {
      const { data } = await axios.post('/api/trade/sell', { coinId, coinAmount: amt });
      push(`💰 Sold ${amt.toExponential(3)} ${coin.ticker} for ${data.solReceived.toFixed(4)} SOL`, 'success');
      setCoinAmt('');
      const portRes = await axios.get('/api/portfolio');
      setPortfolio(portRes.data);
      setHolding(portRes.data.holdings.find((h) => h.coinId === coinId) ?? null);
    } catch (e) {
      push(e.response?.data?.error ?? 'Sell failed', 'error');
    } finally { setBusy(false); }
  }

  const pnl    = holding && price != null ? (price - holding.avgBuyPrice) * holding.amount : null;
  const pnlPct = holding && holding.avgBuyPrice > 0 && price != null
    ? ((price - holding.avgBuyPrice) / holding.avgBuyPrice) * 100
    : null;

  const mc = coin ? (coin.marketCap ?? (coin.currentPrice * 1_000_000_000)) : null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        {/* Card */}
        <div className="relative bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 text-gray-500 hover:text-white text-xl
              w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            ✕
          </button>

          <div className="p-6">
            {loading ? (
              <div className="text-gray-500 text-center py-20">Loading...</div>
            ) : !coin ? null : (
              <>
                {/* Header */}
                <div className="flex items-center justify-between mb-5 pr-8">
                  <div>
                    <h2 className="text-2xl font-bold text-white">{coin.name}</h2>
                    <span className="text-gray-500 text-sm font-mono">${coin.ticker}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-2xl font-mono font-bold text-white">{fmt(price)}</div>
                      <div className="flex items-center gap-2 justify-end mt-0.5">
                        <span className="text-xs text-gray-500">MC {fmtMC(mc)}</span>
                        <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded
                          ${(coin.change24h ?? 0) >= 0
                            ? 'text-green-400 bg-green-950'
                            : 'text-red-400 bg-red-950'}`}>
                          {(coin.change24h ?? 0) >= 0 ? '+' : ''}{(coin.change24h ?? 0).toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Chart */}
                <div
                  ref={chartElRef}
                  className="rounded-xl overflow-hidden border border-gray-800 mb-6"
                />

                {/* Buy / Sell panel */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Buy */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                    <h3 className="font-semibold text-green-400 mb-3">Buy {coin.ticker}</h3>
                    {user ? (
                      <>
                        <div className="text-xs text-gray-500 mb-2">
                          Balance: {portfolio?.solBalance.toFixed(4) ?? '—'} SOL
                        </div>
                        <div className="flex gap-2 mb-3">
                          {[25, 50, 100].map((pct) => (
                            <button
                              key={pct}
                              onClick={() => setSolAmt(((portfolio?.solBalance ?? 0) * pct / 100).toFixed(4))}
                              className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded"
                            >
                              {pct}%
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-gray-600 mb-4">Sign in to see your balance</div>
                    )}
                    <input
                      type="number" min="0" step="any"
                      placeholder="SOL amount"
                      value={solAmt}
                      onChange={(e) => setSolAmt(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2
                        text-sm mb-3 focus:outline-none focus:border-green-600"
                    />
                    {solAmt && price > 0 && (
                      <div className="text-xs text-gray-500 mb-3">
                        ≈ {(parseFloat(solAmt) / price).toExponential(3)} {coin.ticker}
                      </div>
                    )}
                    <button
                      onClick={buy} disabled={busy}
                      className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white
                        font-semibold py-2 rounded-lg transition-colors"
                    >
                      {user ? 'Buy' : '🔒 Sign in to Buy'}
                    </button>
                  </div>

                  {/* Sell */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                    <h3 className="font-semibold text-red-400 mb-3">Sell {coin.ticker}</h3>
                    {user && holding ? (
                      <>
                        <div className="text-xs text-gray-500 mb-1">
                          Holding: {holding.amount.toExponential(3)} {coin.ticker}
                        </div>
                        <div className={`text-xs mb-2 ${pnl != null && pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          P&L: {pnl != null ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} SOL (${pnlPct?.toFixed(2)}%)` : '—'}
                        </div>
                        <div className="flex gap-2 mb-3">
                          {[25, 50, 100].map((pct) => (
                            <button
                              key={pct}
                              onClick={() => setCoinAmt((holding.amount * pct / 100).toExponential(6))}
                              className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded"
                            >
                              {pct}%
                            </button>
                          ))}
                        </div>
                      </>
                    ) : user ? (
                      <div className="text-xs text-gray-600 mb-4">You don't hold any {coin.ticker}</div>
                    ) : (
                      <div className="text-xs text-gray-600 mb-4">Sign in to trade {coin.ticker}</div>
                    )}
                    <input
                      type="number" min="0" step="any"
                      placeholder={`${coin.ticker} amount`}
                      value={coinAmt}
                      onChange={(e) => setCoinAmt(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2
                        text-sm mb-3 focus:outline-none focus:border-red-600"
                    />
                    {coinAmt && price > 0 && (
                      <div className="text-xs text-gray-500 mb-3">
                        ≈ {(parseFloat(coinAmt) * price).toFixed(6)} SOL
                      </div>
                    )}
                    <button
                      onClick={sell} disabled={busy || (user && !holding)}
                      className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white
                        font-semibold py-2 rounded-lg transition-colors"
                    >
                      {user ? 'Sell' : '🔒 Sign in to Sell'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {showGate && <LoginGateModal onClose={() => setShowGate(false)} />}
    </>
  );
}
