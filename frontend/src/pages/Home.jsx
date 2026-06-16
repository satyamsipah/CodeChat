import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { fetchAuthState, ensureGuestSession, clearGuestSession, buildHeaders } from '../utils/auth.js';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function Home() {
  const [auth, setAuth] = useState({ user: null, isAuthenticated: false, isGuest: false, loading: true });
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAuthState().then((state) => setAuth({ ...state, loading: false }));
  }, []);

  async function handleLogout() {
    if (!auth.isGuest) {
      await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    }
    clearGuestSession();
    setAuth({ user: null, isAuthenticated: false, isGuest: false, loading: false });
  }

  function handleContinueAsGuest() {
    ensureGuestSession();
    setAuth((prev) => ({ ...prev, isGuest: true }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!auth.isAuthenticated && !auth.isGuest) {
      ensureGuestSession();
      setAuth((prev) => ({ ...prev, isGuest: true }));
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/repos/index`, {
        method: 'POST',
        headers: buildHeaders(),
        credentials: 'include',
        body: JSON.stringify({ githubUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong.');
        return;
      }
      navigate(`/chat/${data.indexId}`);
    } catch {
      setError('Network error — is the backend running?');
    } finally {
      setSubmitting(false);
    }
  }

  const { user, isAuthenticated, isGuest } = auth;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 flex flex-col">
      {/* Navbar */}
      <nav className="border-b border-slate-700/50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-xl font-bold text-white tracking-tight">CodeChat</span>
          <span className="text-xs px-2 py-0.5 bg-violet-900/60 text-violet-300 rounded-full font-medium">
            beta
          </span>
        </div>

        <div className="flex items-center gap-3">
          {auth.loading ? null : isAuthenticated ? (
            <>
              <span className="text-sm text-slate-400 hidden sm:block">{user?.name}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-slate-400 hover:text-white transition-colors"
              >
                Logout
              </button>
            </>
          ) : isGuest ? (
            <>
              <span className="text-xs px-2.5 py-1 rounded-full bg-amber-900/40 text-amber-300 border border-amber-700/50 font-medium">
                Guest mode
              </span>
              <Link
                to="/login"
                className="text-sm px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors"
              >
                Sign in
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="text-sm text-slate-300 hover:text-white transition-colors"
              >
                Login
              </Link>
              <Link
                to="/signup"
                className="text-sm px-4 py-1.5 rounded-lg border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white transition-colors"
              >
                Sign Up
              </Link>
              <button
                onClick={handleContinueAsGuest}
                className="text-sm px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors"
              >
                Continue as Guest
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-2xl text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-5 tracking-tight leading-tight">
            Ask anything about<br />any codebase
          </h1>
          <p className="text-slate-400 text-lg leading-relaxed max-w-lg mx-auto">
            Paste a public GitHub URL and get instant answers with exact file and line
            citations — powered by hybrid semantic + keyword search.
          </p>
        </div>

        {/* URL form */}
        <form onSubmit={handleSubmit} className="w-full max-w-2xl">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="flex-1 rounded-xl bg-slate-800 border border-slate-700 px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors"
            />
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-7 py-3 font-semibold text-white transition-colors whitespace-nowrap"
            >
              {submitting ? 'Cloning…' : 'Start Chatting'}
            </button>
          </div>

          {error && (
            <div className="mt-3 rounded-lg bg-red-500/20 border border-red-500/40 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <p className="mt-3 text-center text-sm text-slate-500">
            {isAuthenticated
              ? 'Cloning takes ~30 s; embedding runs in the background.'
              : isGuest
              ? <>
                  Guest mode: up to 10 queries per session.{' '}
                  <Link to="/signup" className="text-violet-400 hover:underline">
                    Create a free account
                  </Link>{' '}
                  for unlimited access and saved history.
                </>
              : <>
                  Submit a URL to start as a guest (10 free queries) or{' '}
                  <Link to="/login" className="text-violet-400 hover:underline">sign in</Link>{' '}
                  for unlimited access.
                </>
            }
          </p>
        </form>

        {/* Feature cards */}
        <div className="mt-20 w-full max-w-3xl grid grid-cols-1 sm:grid-cols-3 gap-5">
          {[
            {
              title: 'Hybrid Search',
              desc: 'Semantic vector search fused with BM25 keyword retrieval via reciprocal rank fusion.',
            },
            {
              title: 'Source Citations',
              desc: 'Every answer links to the exact file and line it came from — click to open on GitHub.',
            },
            {
              title: 'Streaming Answers',
              desc: 'Responses stream token-by-token in real time, re-ranked by a cross-encoder.',
            },
          ].map((f) => (
            <div
              key={f.title}
              className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5"
            >
              <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="text-center py-6 text-xs text-slate-600">
        Built by{' '}
        <a
          href="mailto:satyam.sipah12@gmail.com"
          className="text-slate-500 hover:text-slate-400 transition-colors"
        >
          Satyam Maddheshiya
        </a>
      </footer>
    </div>
  );
}
