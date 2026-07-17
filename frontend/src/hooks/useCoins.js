import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

const TOTAL_SUPPLY = 1_000_000_000;

export function useCoins(socket, pushToast) {
  const [coins,       setCoins]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const seedPrices   = useRef({});
  const priceHistory = useRef({});

  // ── Fetch / refresh ─────────────────────────────────────────────────────────
  const refresh = useCallback(() => {
    return axios.get('/api/coins')
      .then(({ data }) => {
        setCoins(data);
        data.forEach((c) => {
          if (!seedPrices.current[c.id]) seedPrices.current[c.id] = c.currentPrice;
        });
        setLoading(false);
        setLastRefresh(new Date());
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Initial load + auto-refresh every 30s
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  // ── Socket events ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    function onPriceUpdate(updates) {
      // Track last 30 prices per coin for sparklines
      Object.entries(updates).forEach(([id, u]) => {
        if (!priceHistory.current[id]) priceHistory.current[id] = [];
        priceHistory.current[id].push(u.price);
        if (priceHistory.current[id].length > 30) priceHistory.current[id].shift();
      });

      setCoins((prev) =>
        prev.map((coin) => {
          const u = updates[coin.id];
          if (!u) return coin;
          const seed = seedPrices.current[coin.id] ?? u.price;
          const change24h = seed > 0
            ? parseFloat((((u.price - seed) / seed) * 100).toFixed(2))
            : 0;
          return { ...coin, currentPrice: u.price, marketCap: u.marketCap ?? u.price * TOTAL_SUPPLY, change24h };
        })
      );
    }

    function onCoinAdded(coin) {
      seedPrices.current[coin.id] = coin.currentPrice;
      setCoins((prev) => {
        if (prev.find((c) => c.id === coin.id)) return prev;
        return [coin, ...prev];
      });
      pushToast?.(`🪙 New token: ${coin.name} (${coin.ticker})`, 'new', 5000);
    }

    function onCoinDeleted({ coinId, name, ticker, finalPrice }) {
      setCoins((prev) => prev.filter((c) => c.id !== coinId));
      delete seedPrices.current[coinId];
      const priceStr = finalPrice != null ? ` @ $${finalPrice.toExponential(2)}` : '';
      pushToast?.(`💀 RUGGED: ${name} (${ticker})${priceStr}`, 'rug', 6000);
    }

    function onCoinMigrated({ coinId, name, ticker, marketCap }) {
      setCoins((prev) =>
        prev.map((coin) =>
          coin.id === coinId
            ? { ...coin, migrated: true, migratedAt: new Date().toISOString() }
            : coin
        )
      );
      const mcStr = marketCap >= 1000 ? `$${(marketCap / 1000).toFixed(1)}K` : `$${marketCap.toFixed(0)}`;
      pushToast?.(`🚀 $${ticker} just migrated at ${mcStr} MC!`, 'pump', 7000);
    }

    socket.on('price_update',  onPriceUpdate);
    socket.on('coin_added',    onCoinAdded);
    socket.on('coin_deleted',  onCoinDeleted);
    socket.on('coin_migrated', onCoinMigrated);

    return () => {
      socket.off('price_update',  onPriceUpdate);
      socket.off('coin_added',    onCoinAdded);
      socket.off('coin_deleted',  onCoinDeleted);
      socket.off('coin_migrated', onCoinMigrated);
    };
  }, [socket, pushToast]);

  return { coins, loading, error, refresh, lastRefresh, priceHistory };
}
