import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login }     = useAuth();
  const navigate      = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy,  setBusy]  = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await axios.post('/api/auth/login', form);
      login(data);
      navigate('/');
    } catch (e) {
      setError(e.response?.data?.error ?? 'Login failed');
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-2">🎰</div>
          <h1 className="text-2xl font-bold text-white">DegenTrades</h1>
          <p className="text-gray-500 text-sm mt-1">Memecoin simulator · 10 SOL to start</p>
        </div>

        <form onSubmit={submit} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          {error && (
            <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <input
            type="email" required placeholder="Email"
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600
              rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
          />
          <input
            type="password" required placeholder="Password"
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600
              rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit" disabled={busy}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white
              font-semibold py-2.5 rounded-lg transition-colors"
          >
            {busy ? 'Signing in...' : 'Sign In'}
          </button>
          <p className="text-center text-sm text-gray-500">
            No account?{' '}
            <Link to="/register" className="text-indigo-400 hover:text-indigo-300">Register</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
