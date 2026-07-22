import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType, CrosshairMode } from 'lightweight-charts';
import { playBuy, playSell, primeAudio } from '../utils/sounds';

const TOTAL_SUPPLY = 1_000_000_000;

function calcSMA(candles, period = 20) {
  return candles.map((c, i) => {
    if (i < period - 1) return null;
    const avg = candles.slice(i - period + 1, i + 1).reduce((s, x) => s + x.close, 0) / period;
    return { time: c.time, value: avg };
  }).filter(Boolean);
}

function aggregateCandles(candles, seconds) {
  if (seconds === 1) return candles;
  const map = new Map();
  for (const c of candles) {
    const t = Math.floor(c.time / seconds) * seconds;
    if (!map.has(t)) {
      map.set(t, { time: t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 });
    } else {
      const b = map.get(t);
      b.high   = Math.max(b.high, c.high);
      b.low    = Math.min(b.low,  c.low);
      b.close  = c.close;
      b.volume = (b.volume || 0) + (c.volume || 0);
    }
  }
  return [...map.values()];
}
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

function LoginGateModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
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

export default function CoinDetail() {
  const { id }       = useParams();
  const navigate     = useNavigate();
  const { user }     = useAuth();
  const { socket }   = useSocket();
  const { push }     = useToast();

  const chartRef    = useRef(null);
  const seriesRef   = useRef(null);
  const volumeRef   = useRef(null);
  const smaRef      = useRef(null);
  const candleCache = useRef([]);
  const chartElRef  = useRef(null);
  const quickBuyClickTimer = useRef(null);

  const [coin,       setCoin]       = useState(null);
  const [price,      setPrice]      = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [solAmt,     setSolAmt]     = useState('');
  const [coinAmt,    setCoinAmt]    = useState('');
  const [quickAmounts, setQuickAmounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dt:quickBuy') ?? 'null') ?? [0.1, 0.5, 1, 5, 10]; }
    catch { return [0.1, 0.5, 1, 5, 10]; }
  });
  const [editingChipIdx, setEditingChipIdx] = useState(null);
  const [editingValue,   setEditingValue]   = useState('');

  function saveChipEdit(idx) {
    const val = parseFloat(editingValue);
    if (!isNaN(val) && val > 0) {
      const next = [...quickAmounts];
      next[idx] = parseFloat(val.toFixed(4));
      setQuickAmounts(next);
      localStorage.setItem('dt:quickBuy', JSON.stringify(next));
    }
    setEditingChipIdx(null);
    setEditingValue('');
  }

  function handleQuickBuyClick(amt) {
    if (quickBuyClickTimer.current) clearTimeout(quickBuyClickTimer.current);
    quickBuyClickTimer.current = setTimeout(() => {
      quickBuyClickTimer.current = null;
      executeBuy(amt);
    }, 220);
  }

  function handleQuickBuyDoubleClick(e, idx, amt) {
    e.preventDefault();
    e.stopPropagation();
    if (quickBuyClickTimer.current) {
      clearTimeout(quickBuyClickTimer.current);
      quickBuyClickTimer.current = null;
    }
    setEditingChipIdx(idx);
    setEditingValue(String(amt));
  }
  const [portfolio,  setPortfolio]  = useState(null);
  const [holding,    setHolding]    = useState(null);
  const [busy,       setBusy]       = useState(false);
  const [showGate,   setShowGate]   = useState(false);
  const [timeframe,  setTimeframe]  = useState(1);
  const timeframeRef = useRef(1);

  // ── Load coin (+ portfolio if logged in) ──────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const requests = [axios.get('/api/coins')];
        if (user) requests.push(axios.get('/api/portfolio'));

        const [coinsRes, portRes] = await Promise.all(requests);
        const found = coinsRes.data.find((c) => c.id === id);
        if (!found) { navigate('/'); return; }
        setCoin(found);
        setPrice(found.currentPrice);

        if (portRes) {
          setPortfolio(portRes.data);
          const h = portRes.data.holdings.find((h) => h.coinId === id);
          setHolding(h ?? null);
        }
        setLoading(false);
      } catch {
        navigate('/');
      }
    }
    load();
  }, [id, navigate, user]);

  // ── Chart ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (loading || !chartElRef.current) return;

    let chart = null;
    let raf   = null;

    raf = requestAnimationFrame(() => {
      if (!chartElRef.current) return;
      try {
        chart = createChart(chartElRef.current, {
          layout:          { background: { type: ColorType.Solid, color: '#030712' }, textColor: '#9ca3af' },
          grid:            { vertLines: { color: '#111827' }, horzLines: { color: '#111827' } },
          crosshair:       { mode: CrosshairMode.Normal },
          rightPriceScale: { borderColor: '#1f2937' },
          timeScale:       { borderColor: '#1f2937', timeVisible: true },
          localization: {
            priceFormatter: (p) => {
              if (p >= 1_000_000_000) return `$${(p / 1_000_000_000).toFixed(2)}B`;
              if (p >= 1_000_000)     return `$${(p / 1_000_000).toFixed(2)}M`;
              if (p >= 1_000)         return `$${(p / 1_000).toFixed(1)}K`;
              return `$${p.toFixed(0)}`;
            },
          },
          autoSize: true,
          height:   340,
        });
        chartRef.current = chart;

        const series = chart.addSeries(CandlestickSeries, {
          upColor:         '#00ff88',
          downColor:       '#ff3b3b',
          borderUpColor:   '#00ff88',
          borderDownColor: '#ff3b3b',
          wickUpColor:     '#00ff88',
          wickDownColor:   '#ff3b3b',
        });
        seriesRef.current = series;

        const volumeSeries = chart.addSeries(HistogramSeries, {
          priceFormat:  { type: 'volume' },
          priceScaleId: 'volume',
        });
        chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        volumeRef.current = volumeSeries;

        const smaSeries = chart.addSeries(LineSeries, {
          color:            '#f59e0b',
          lineWidth:        1,
          priceScaleId:     'right',
          lastValueVisible: false,
          priceLineVisible: false,
        });
        smaRef.current = smaSeries;

        axios.get(`/api/coins/${id}/history`).then(({ data }) => {
            if (!data || data.length === 0) return; // will build up shortly
          const mcData = data.map((c) => ({
            ...c,
            open:  c.open  * TOTAL_SUPPLY,
            high:  c.high  * TOTAL_SUPPLY,
            low:   c.low   * TOTAL_SUPPLY,
            close: c.close * TOTAL_SUPPLY,
          }));
          series.setData(mcData);
          volumeRef.current?.setData(data.map((c) => ({
            time:  c.time,
            value: c.volume,
            color: c.close >= c.open ? '#00ff8855' : '#ff3b3b55',
          })));
          smaRef.current?.setData(calcSMA(mcData));
          candleCache.current = mcData;
          chart.timeScale().fitContent();
        }).catch(() => {});
      } catch (err) {
        console.error('Chart init error:', err);
      }
    });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (chart) { try { chart.remove(); } catch (_) {} }
      chartRef.current  = null;
      seriesRef.current = null;
      volumeRef.current = null;
      smaRef.current    = null;
      candleCache.current = [];
    };
  }, [loading, id]);

  // Re-render chart when timeframe changes
  useEffect(() => {
    timeframeRef.current = timeframe;
    if (!seriesRef.current || candleCache.current.length === 0) return;
    const agg = aggregateCandles(candleCache.current, timeframe);
    seriesRef.current.setData(agg);
    volumeRef.current?.setData(agg.map((c) => ({ time: c.time, value: c.volume || 0, color: c.close >= c.open ? '#00ff8855' : '#ff3b3b55' })));
    smaRef.current?.setData(calcSMA(agg));
    chartRef.current?.timeScale().fitContent();
  }, [timeframe]);

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    function onPriceUpdate(updates) {
      const u = updates[id];
      if (!u) return;
      setPrice(u.price);
      setCoin((prev) => prev ? { ...prev, currentPrice: u.price } : prev);
      if (seriesRef.current && u.candle) {
        const mcCandle = {
          ...u.candle,
          open:  u.candle.open  * TOTAL_SUPPLY,
          high:  u.candle.high  * TOTAL_SUPPLY,
          low:   u.candle.low   * TOTAL_SUPPLY,
          close: u.candle.close * TOTAL_SUPPLY,
        };
        const cache = candleCache.current;
        const last  = cache[cache.length - 1];
        if (last && last.time === mcCandle.time) cache[cache.length - 1] = mcCandle;
        else { cache.push(mcCandle); if (cache.length > 500) cache.shift(); }
        const tf = timeframeRef.current;
        if (tf === 1) {
          seriesRef.current.update(mcCandle);
          volumeRef.current?.update({ time: mcCandle.time, value: u.candle.volume, color: mcCandle.close >= mcCandle.open ? '#00ff8855' : '#ff3b3b55' });
          if (smaRef.current && cache.length >= 20) {
            const avg = cache.slice(-20).reduce((s, x) => s + x.close, 0) / 20;
            smaRef.current.update({ time: mcCandle.time, value: avg });
          }
        } else {
          const bucketTime = Math.floor(mcCandle.time / tf) * tf;
          const bc = cache.filter((c) => Math.floor(c.time / tf) * tf === bucketTime);
          const bucket = { time: bucketTime, open: bc[0].open, high: Math.max(...bc.map((c) => c.high)), low: Math.min(...bc.map((c) => c.low)), close: bc[bc.length - 1].close, volume: bc.reduce((s, c) => s + (c.volume || 0), 0) };
          seriesRef.current.update(bucket);
          volumeRef.current?.update({ time: bucket.time, value: bucket.volume, color: bucket.close >= bucket.open ? '#00ff8855' : '#ff3b3b55' });
          if (smaRef.current) {
            const agg = aggregateCandles(cache, tf);
            if (agg.length >= 20) {
              const avg = agg.slice(-20).reduce((s, c) => s + c.close, 0) / 20;
              smaRef.current.update({ time: agg[agg.length - 1].time, value: avg });
            }
          }
        }
      }
    }

    function onCoinDeleted({ coinId, name, ticker }) {
      if (coinId !== id) return;
      setTimeout(() => navigate('/'), 2000);
    }

    socket.on('price_update',  onPriceUpdate);
    socket.on('coin_deleted',  onCoinDeleted);
    return () => {
      socket.off('price_update',  onPriceUpdate);
      socket.off('coin_deleted',  onCoinDeleted);
    };
  }, [socket, id, navigate, push]);

  // ── Trades ────────────────────────────────────────────────────────────────
  function requireAuth() {
    if (!user) { setShowGate(true); return false; }
    return true;
  }

  async function executeBuy(solAmount) {
    if (!requireAuth()) return;
    primeAudio();
    const sol = parseFloat(solAmount);
    if (!sol || sol <= 0) return push('Enter a valid SOL amount', 'error');
    setBusy(true);
    try {
      const { data } = await axios.post('/api/trade/buy', { coinId: id, solAmount: sol });
      const recvAmt = data.coinsReceived != null && isFinite(data.coinsReceived)
        ? data.coinsReceived.toExponential(3)
        : '?';
      playBuy();
      push(`✅ Bought ${recvAmt} ${coin.ticker}`, 'success');
      setSolAmt('');
      // Update holding from response, fallback to portfolio fetch
      if (data.holding) {
        setHolding(data.holding);
      } else {
        try { const r = await axios.get('/api/portfolio'); setPortfolio(r.data); setHolding(r.data.holdings.find(h => h.coinId === id) ?? null); } catch {}
      }
      if (data.newSolBalance != null) setPortfolio(prev => prev ? { ...prev, solBalance: data.newSolBalance } : prev);
    } catch (e) {
      push(e.response?.data?.error ?? 'Buy failed', 'error');
    } finally { setBusy(false); }
  }

  async function executeSell(coinAmount) {
    if (!requireAuth()) return;
    primeAudio();
    const amt = parseFloat(coinAmount);
    if (!amt || amt <= 0) return push('Enter a valid amount', 'error');
    setBusy(true);
    try {
      const { data } = await axios.post('/api/trade/sell', { coinId: id, coinAmount: amt });
      playSell();
      push(`💰 Sold ${amt.toExponential(3)} ${coin.ticker} for ${data.solReceived?.toFixed(4) ?? '?'} SOL`, 'success');
      setCoinAmt('');
      // Update holding from response, fallback to portfolio fetch
      const newHolding = data.holding !== undefined ? data.holding : (
        await axios.get('/api/portfolio').then(r => r.data.holdings.find(h => h.coinId === id) ?? null).catch(() => null)
      );
      setHolding(newHolding);
      if (data.newSolBalance != null) setPortfolio(prev => prev ? { ...prev, solBalance: data.newSolBalance } : prev);
    } catch (e) {
      push(e.response?.data?.error ?? 'Sell failed', 'error');
    } finally { setBusy(false); }
  }

  const buy  = () => executeBuy(solAmt);
  const sell = () => executeSell(coinAmt);

  if (loading) return <div className="text-gray-500 text-center py-20">Loading...</div>;
  if (!coin)   return null;

  const pnl    = holding ? (price - holding.avgBuyPrice) * holding.amount : null;
  const pnlPct = holding && holding.avgBuyPrice > 0
    ? ((price - holding.avgBuyPrice) / holding.avgBuyPrice) * 100
    : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {showGate && <LoginGateModal onClose={() => setShowGate(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{coin.name}</h1>
          <span className="text-gray-500 text-sm font-mono">{coin.ticker}</span>
        </div>
        <div className="text-right">
          <div className="text-3xl font-mono font-bold text-white">{fmt(price)}</div>
          <div className={`text-sm ${(coin.change24h ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {(coin.change24h ?? 0) >= 0 ? '+' : ''}{(coin.change24h ?? 0).toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="flex gap-1 mb-1">
        {[1, 15].map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`px-2 py-0.5 text-xs rounded font-mono transition-colors ${
              timeframe === tf ? 'bg-green-500 text-black font-bold' : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {tf}s
          </button>
        ))}
      </div>
      <div ref={chartElRef} className="rounded-xl overflow-hidden border border-gray-800 mb-6" />

      {/* Trade + holding info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Buy */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-green-400">Buy {coin.ticker}</h3>
            {user && portfolio && (
              <span className="text-xs text-gray-500 font-mono">
                {portfolio.solBalance.toFixed(2)} SOL available
              </span>
            )}
          </div>

          {/* Quick SOL amount chips */}
          <div className="mb-3">
            <div className="text-xs text-gray-600 mb-1.5 uppercase tracking-wider">Quick Buy</div>
            <div className="flex flex-wrap gap-1.5">
              {quickAmounts.map((amt, idx) =>
                editingChipIdx === idx ? (
                  <input
                    key={idx}
                    autoFocus
                    type="number"
                    min="0"
                    step="any"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={() => saveChipEdit(idx)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveChipEdit(idx);
                      if (e.key === 'Escape') { setEditingChipIdx(null); setEditingValue(''); }
                    }}
                    className="w-16 text-xs px-2 py-1.5 rounded-lg border border-green-500 bg-gray-800 text-white text-center focus:outline-none"
                  />
                ) : (
                  <button
                    key={idx}
                    onClick={() => handleQuickBuyClick(amt)}
                    onDoubleClick={(e) => handleQuickBuyDoubleClick(e, idx, amt)}
                    title="Click to buy instantly • Double-click to edit"
                    disabled={busy}
                    className="text-xs px-2.5 py-1.5 rounded-lg border transition-all
                      bg-gray-800 border-gray-700 text-gray-400 hover:bg-green-700 hover:border-green-600 hover:text-white disabled:opacity-40"
                  >
                    {amt} SOL
                  </button>
                )
              )}
              {user && portfolio && (
                <button
                  onClick={() => executeBuy(portfolio.solBalance)}
                  disabled={busy}
                  title="Buy with full balance"
                  className="text-xs px-2.5 py-1.5 rounded-lg border transition-all
                    bg-gray-800 border-gray-700 text-gray-400 hover:bg-green-700 hover:border-green-600 hover:text-white disabled:opacity-40"
                >
                  MAX
                </button>
              )}
            </div>
            <div className="text-xs text-gray-700 mt-1">⚡ click to buy instantly • ✏️ double-click to edit amount</div>
          </div>

          {/* % of balance chips */}
          {user && portfolio && (
            <div className="mb-3">
              <div className="text-xs text-gray-600 mb-1.5 uppercase tracking-wider">% of Balance</div>
              <div className="flex gap-1.5">
                {[10, 25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => executeBuy((portfolio.solBalance * pct) / 100)}
                    disabled={busy}
                    className="flex-1 text-xs py-1.5 rounded-lg border border-gray-700 bg-gray-800
                      text-gray-400 hover:bg-green-700 hover:border-green-600 hover:text-white transition-all disabled:opacity-40"
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Custom input */}
          <div className="relative mb-2">
            <input
              type="number" min="0" step="any"
              placeholder="SOL amount"
              value={solAmt}
              onChange={(e) => setSolAmt(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5
                text-sm focus:outline-none focus:border-green-600 pr-14"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-mono">SOL</span>
          </div>

          {/* Estimate */}
          {solAmt && parseFloat(solAmt) > 0 && price > 0 && (
            <div className="bg-gray-800/50 rounded-lg px-3 py-2 mb-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">You receive</span>
                <span className="text-white font-mono">{(parseFloat(solAmt) / price).toExponential(3)} {coin.ticker}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">USD value</span>
                <span className="text-gray-400 font-mono">${(parseFloat(solAmt) * 150).toFixed(2)}</span>
              </div>
            </div>
          )}

          <button
            onClick={buy} disabled={busy || !solAmt || parseFloat(solAmt) <= 0}
            className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed
              text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
          >
            {user ? (busy ? 'Buying...' : `Buy ${coin.ticker}`) : '🔒 Sign in to Buy'}
          </button>
        </div>

        {/* Sell */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-red-400">Sell {coin.ticker}</h3>
            {user && holding && (
              <span className={`text-xs font-mono ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {pnl >= 0 ? '+' : ''}{pnl?.toFixed(3)} SOL ({pnlPct?.toFixed(1)}%)
              </span>
            )}
          </div>

          {user && holding ? (
            <>
              <div className="text-xs text-gray-500 mb-3 font-mono">
                Holding: {holding.amount.toExponential(3)} {coin.ticker}
              </div>

              {/* % of holding chips */}
              <div className="mb-3">
                <div className="text-xs text-gray-600 mb-1.5 uppercase tracking-wider">Sell Amount</div>
                <div className="flex gap-1.5">
                  {[10, 25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => executeSell(holding.amount * pct / 100)}
                      disabled={busy}
                      className={`flex-1 text-xs py-1.5 rounded-lg border transition-all disabled:opacity-40
                        ${pct === 100
                          ? 'border-red-800 bg-red-950/40 text-red-400 hover:bg-red-900/60'
                          : 'border-gray-700 bg-gray-800 text-gray-400 hover:bg-red-900/40 hover:border-red-700 hover:text-red-400'}`}
                    >
                      {pct === 100 ? 'ALL' : `${pct}%`}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : user ? (
            <div className="text-xs text-gray-600 mb-4 py-3 text-center border border-gray-800 rounded-lg">
              You don't hold any {coin.ticker}
            </div>
          ) : (
            <div className="text-xs text-gray-600 mb-4 py-3 text-center border border-gray-800 rounded-lg">
              Sign in to trade {coin.ticker}
            </div>
          )}

          {/* Custom input */}
          <div className="relative mb-2">
            <input
              type="number" min="0" step="any"
              placeholder={`${coin.ticker} amount`}
              value={coinAmt}
              onChange={(e) => setCoinAmt(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5
                text-sm focus:outline-none focus:border-red-600 pr-20"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-mono truncate max-w-[60px]">
              {coin.ticker}
            </span>
          </div>

          {/* Estimate */}
          {coinAmt && parseFloat(coinAmt) > 0 && price > 0 && (
            <div className="bg-gray-800/50 rounded-lg px-3 py-2 mb-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">You receive</span>
                <span className="text-white font-mono">{(parseFloat(coinAmt) * price).toFixed(4)} SOL</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">USD value</span>
                <span className="text-gray-400 font-mono">${(parseFloat(coinAmt) * price * 150).toFixed(2)}</span>
              </div>
            </div>
          )}

          <button
            onClick={sell}
            disabled={busy || !coinAmt || parseFloat(coinAmt) <= 0 || (user && !holding)}
            className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed
              text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
          >
            {user ? (busy ? 'Selling...' : `Sell ${coin.ticker}`) : '🔒 Sign in to Sell'}
          </button>
        </div>
      </div>
    </div>
  );
}
