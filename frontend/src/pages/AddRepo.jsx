import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function AddRepo() {
  const [url, setUrl]         = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/repos/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ githubUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      // Navigate immediately — ChatShell handles progress polling
      navigate(`/chat/${data.indexId}`);
    } catch {
      setError('Network error — is the backend running?');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-white">Index a Repository</h1>
            <p className="text-slate-400 text-sm mt-1">
              Paste a public GitHub URL — cloning takes ~30 s, embedding runs in the background.
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            Logout
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="url" required
            value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="flex-1 rounded-lg bg-slate-800 border border-slate-700 px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <button
            type="submit" disabled={loading}
            className="rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-5 py-2.5 font-medium text-white transition-colors whitespace-nowrap"
          >
            {loading ? 'Cloning…' : 'Index repo'}
          </button>
        </form>

        {error && (
          <div className="mt-4 rounded-lg bg-red-500/20 border border-red-500/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
