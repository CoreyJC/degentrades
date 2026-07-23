import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useSocket } from '../context/SocketContext';

const API = import.meta.env.VITE_API_URL || '';

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)   return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

function fmtNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function TweetCard({ tweet, onCoinClick }) {
  const isLaunch = tweet.type === 'launch';

  return (
    <div
      className={`
        px-3 py-3 border-b border-gray-800/60 transition-all duration-300
        animate-in slide-in-from-top-2 fade-in
        ${isLaunch
          ? 'bg-yellow-950/20 border-l-2 border-l-yellow-500/60'
          : 'hover:bg-gray-900/40'}
      `}
    >
      {/* Header row */}
      <div className="flex items-start gap-2 mb-1.5">
        <span className="text-lg leading-none mt-0.5 shrink-0">{tweet.avatar}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-white text-xs font-semibold truncate">{tweet.name}</span>
            {tweet.verified && (
              <span className="text-blue-400 text-xs font-bold shrink-0">✓</span>
            )}
            {isLaunch && (
              <span className="text-yellow-400 text-xs ml-1 shrink-0">🔥 LAUNCH</span>
            )}
          </div>
          <div className="text-gray-500 text-xs">
            {tweet.handle} · {tweet.followers}
          </div>
        </div>
        <span className="text-gray-600 text-xs shrink-0">{timeAgo(tweet.timestamp)}</span>
      </div>

      {/* Tweet text */}
      <p className="text-gray-200 text-xs leading-relaxed mb-2 pl-7">{tweet.text}</p>

      {/* Coin button */}
      {tweet.coinTicker && tweet.coinId && (
        <div className="pl-7 mb-2">
          <button
            onClick={() => onCoinClick(tweet.coinId)}
            className={`
              text-xs font-mono font-semibold px-2.5 py-1 rounded-full border transition-all
              ${isLaunch
                ? 'bg-yellow-500/10 border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/20'
                : 'bg-green-950/60 border-green-800/60 text-green-400 hover:bg-green-900/60'}
            `}
          >
            VIEW ${tweet.coinTicker} →
          </button>
        </div>
      )}

      {/* Engagement */}
      <div className="flex items-center gap-4 pl-7 text-gray-600 text-xs">
        <span>❤️ {fmtNumber(tweet.likes)}</span>
        <span>🔁 {fmtNumber(tweet.retweets)}</span>
      </div>
    </div>
  );
}

export default function TweetFeed() {
  const { socket } = useSocket();
  const navigate   = useNavigate();
  const [open, setOpen]     = useState(false);
  const [tweets, setTweets] = useState([]);
  const [hasNew, setHasNew] = useState(false);
  const listRef = useRef(null);

  // Initial load
  useEffect(() => {
    axios.get(`${API}/api/tweets`)
      .then(r => setTweets(r.data))
      .catch(() => {});
  }, []);

  // Live updates
  useEffect(() => {
    if (!socket) return;
    const handler = (tweet) => {
      setTweets(prev => {
        const next = [tweet, ...prev].slice(0, 50);
        return next;
      });
      if (!open) setHasNew(true);
    };
    socket.on('tweet_added', handler);
    return () => socket.off('tweet_added', handler);
  }, [socket, open]);

  const handleOpen = () => {
    setOpen(true);
    setHasNew(false);
  };

  const handleCoinClick = (coinId) => {
    navigate(`/coin/${coinId}`);
  };

  return (
    <>
      {/* Toggle button — fixed right edge */}
      <button
        onClick={open ? () => setOpen(false) : handleOpen}
        className={`
          fixed right-0 top-1/2 -translate-y-1/2 z-50
          flex flex-col items-center gap-1
          bg-gray-900 border border-gray-700 border-r-0
          rounded-l-xl px-2 py-3
          text-gray-400 hover:text-white hover:border-gray-500
          transition-all shadow-xl
        `}
        title="Toggle Social Feed"
      >
        <span className="text-lg">📡</span>
        {hasNew && (
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        )}
        {!open && (
          <span className="text-xs font-mono text-gray-600 [writing-mode:vertical-rl] rotate-180">
            Feed
          </span>
        )}
      </button>

      {/* Slide-in panel */}
      <div
        className={`
          fixed top-0 right-0 h-full z-40
          w-80 bg-gray-950 border-l border-gray-800
          flex flex-col
          transition-transform duration-300 ease-in-out
          ${open ? 'translate-x-0' : 'translate-x-full'}
          shadow-2xl
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">📡</span>
            <span className="text-white font-semibold text-sm">Social Feed</span>
            <span className="text-xs font-mono text-gray-600 bg-gray-900 px-1.5 py-0.5 rounded">
              {tweets.length}
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-gray-600 hover:text-white text-sm transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Legend */}
        <div className="px-3 py-2 bg-gray-900/50 border-b border-gray-800/50 shrink-0">
          <div className="flex gap-3 text-xs text-gray-500">
            <span>🔥 = Celebrity launch</span>
            <span>✓ = Verified</span>
          </div>
        </div>

        {/* Tweet list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent"
        >
          {tweets.length === 0 ? (
            <div className="text-gray-600 text-sm text-center py-16">
              <div className="text-3xl mb-2">📡</div>
              <div>Waiting for tweets...</div>
            </div>
          ) : (
            tweets.map(tweet => (
              <TweetCard
                key={tweet.id}
                tweet={tweet}
                onCoinClick={handleCoinClick}
              />
            ))
          )}
        </div>
      </div>

      {/* Backdrop (mobile) */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}
    </>
  );
}
