import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { ToastProvider } from './context/ToastContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Market from './pages/Market';
import Portfolio from './pages/Portfolio';
import Leaderboard from './pages/Leaderboard';
import CoinDetail from './pages/CoinDetail';
import Nav from './components/Nav';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>;
  return user ? children : <Navigate to="/login" replace />;
}

function AppInner() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-gray-950">
      {user && <Nav />}
      <Routes>
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<ProtectedRoute><Market /></ProtectedRoute>} />
        <Route path="/coin/:id" element={<ProtectedRoute><CoinDetail /></ProtectedRoute>} />
        <Route path="/portfolio" element={<ProtectedRoute><Portfolio /></ProtectedRoute>} />
        <Route path="/leaderboard" element={<ProtectedRoute><Leaderboard /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <ToastProvider>
          <AppInner />
        </ToastProvider>
      </SocketProvider>
    </AuthProvider>
  );
}
