import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

export default function Nav() {
  const { user, logout } = useAuth();
  const { connected }    = useSocket();
  const location         = useLocation();

  const link = (to, label) => (
    <Link
      to={to}
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors
        ${location.pathname === to
          ? 'bg-gray-800 text-white'
          : 'text-gray-400 hover:text-white hover:bg-gray-800/50'}`}
    >
      {label}
    </Link>
  );

  return (
    <nav className="border-b border-gray-800 bg-gray-950/90 backdrop-blur sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo.png" alt="DegenTrades" className="h-9 w-auto" />
        </Link>

        {/* Links */}
        <div className="flex items-center gap-1">
          {link('/',            '📈 Market')}
          {user && link('/portfolio', '💼 Portfolio')}
          {link('/leaderboard', '🏆 Leaderboard')}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Connection status dot */}
          <span
            className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`}
            title={connected ? 'Live' : 'Disconnected'}
          />

          {user ? (
            <>
              <span className="text-sm text-gray-400">{user.username}</span>
              <button
                onClick={logout}
                className="text-xs text-gray-500 hover:text-red-400 transition-colors"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="text-sm font-medium text-gray-300 border border-gray-600
                  hover:border-gray-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                Login
              </Link>
              <Link
                to="/register"
                className="text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors"
                style={{ backgroundColor: '#00ff88', color: '#0a0a0a' }}
              >
                Sign Up
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
