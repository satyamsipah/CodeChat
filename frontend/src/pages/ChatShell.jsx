import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link, useOutletContext } from 'react-router-dom';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// ── Indexing progress view ────────────────────────────────────────────────────
function IndexingView({ status, chunksIndexed, chunksTotal, githubUrl }) {
  const percent = chunksTotal > 0 ? Math.round((chunksIndexed / chunksTotal) * 100) : 0;

  if (status === 'failed') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-sm">
          <p className="text-red-400 font-medium mb-2">Indexing failed</p>
          <p className="text-slate-500 text-sm mb-4">{githubUrl}</p>
          <Link to="/add-repo" className="text-violet-400 hover:underline text-sm">
            ← Try another repo
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-sm w-full px-6">
        {/* Spinner */}
        <div className="w-10 h-10 border-2 border-slate-600 border-t-violet-500 rounded-full animate-spin mx-auto mb-5" />
        <p className="text-white font-medium mb-1">Indexing your repository…</p>
        <p className="text-slate-500 text-xs mb-4 truncate">{githubUrl}</p>

        {/* Progress bar — only shows once chunksTotal is known */}
        {chunksTotal > 0 && (
          <>
            <div className="w-full bg-slate-700 rounded-full h-1.5 mb-2">
              <div
                className="bg-violet-500 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-slate-400 text-xs">
              {chunksIndexed.toLocaleString()} / {chunksTotal.toLocaleString()} chunks embedded
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Single chat message bubble ─────────────────────────────────────────────────
function MessageBubble({ msg, githubUrl }) {
  const isUser = msg.role === 'user';

  const makeSourceHref = (s) => {
    const match = githubUrl?.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
    const repoPath = match ? match[1] : '';
    return repoPath
      ? `https://github.com/${repoPath}/blob/main/${s.filePath}#L${s.lineStart}`
      : null;
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-2xl ${isUser ? 'order-2' : ''}`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-violet-600 text-white rounded-br-sm whitespace-pre-wrap'
              : 'bg-slate-800 text-slate-100 rounded-bl-sm'
          }`}
        >
          {isUser ? (
            msg.content
          ) : (
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</div>
          )}
        </div>

        {/* Collapsible sources under assistant messages */}
        {!isUser && msg.sources?.length > 0 && (
          <details className="mt-2 ml-1">
            <summary className="text-xs text-slate-500 hover:text-slate-300 cursor-pointer select-none">
              {msg.sources.length} source{msg.sources.length !== 1 ? 's' : ''}
            </summary>
            <div className="mt-2 space-y-2">
              {msg.sources.map((s, i) => {
                const href = makeSourceHref(s);
                return (
                  <div key={i} className="bg-slate-900 border border-slate-700 rounded-lg p-3">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-mono text-violet-400 hover:underline mb-1 block"
                      >
                        {s.filePath}:{s.lineStart}-{s.lineEnd} ↗
                      </a>
                    ) : (
                      <p className="text-xs font-mono text-violet-400 mb-1">
                        {s.filePath}:{s.lineStart}-{s.lineEnd}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

// ── Main ChatShell ─────────────────────────────────────────────────────────────
export default function ChatShell() {
  const { indexId } = useParams();
  const navigate = useNavigate();
  const { user } = useOutletContext() ?? {};

  const [status, setStatus]           = useState('pending');
  const [chunksIndexed, setChunksIdx] = useState(0);
  const [chunksTotal, setChunksTotal] = useState(0);
  const [githubUrl, setGithubUrl]     = useState('');
  const [messages, setMessages]       = useState([]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);   // waiting for first token
  const [isStreaming, setIsStreaming]  = useState(false);   // tokens arriving
  const [streamingContent, setStreamingContent] = useState('');

  // useRef to accumulate tokens — avoids stale-closure issues in the async loop
  const accRef      = useRef('');
  const pollTimer   = useRef(null);
  const bottomRef   = useRef(null);
  const textareaRef = useRef(null);

  // Scroll to bottom whenever messages or streaming content change
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamingContent]);

  // ── Status polling ──────────────────────────────────────────────────────────
  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/repos/${indexId}/status`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setStatus(data.status);
      setChunksIdx(data.chunksIndexed);
      setChunksTotal(data.chunksTotal);
      setGithubUrl(data.githubUrl);
    } catch { /* network blip — keep polling */ }
  }, [indexId]);

  useEffect(() => {
    pollStatus();
    pollTimer.current = setInterval(pollStatus, 3000);
    return () => clearInterval(pollTimer.current);
  }, [pollStatus]);

  // Stop polling once a terminal state is reached
  useEffect(() => {
    if (status === 'indexed' || status === 'failed' || status === 'ready') {
      clearInterval(pollTimer.current);
    }
  }, [status]);

  // ── Query submission — SSE streaming ───────────────────────────────────────
  async function handleSubmit() {
    const q = input.trim();
    if (!q || loading || isStreaming) return;

    setMessages((prev) => [...prev, { role: 'user', content: q }]);
    setInput('');
    setLoading(true);
    accRef.current = '';
    setStreamingContent('');

    try {
      const response = await fetch(`${API_URL}/api/repos/${indexId}/query`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ query: q }),
      });

      if (!response.ok) {
        // Non-SSE error (auth failure, 400, etc.)
        const data = await response.json().catch(() => ({ error: 'Unknown error' }));
        setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${data.error}` }]);
        return;
      }

      setLoading(false);
      setIsStreaming(true);

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalSources = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // keep the incomplete trailing chunk

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          let data;
          try { data = JSON.parse(part.slice(6)); } catch { continue; }

          if (data.type === 'token') {
            accRef.current += data.token;
            setStreamingContent(accRef.current);
          } else if (data.type === 'sources') {
            finalSources = data.sources;
          } else if (data.type === 'done') {
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: accRef.current, sources: finalSources },
            ]);
            accRef.current = '';
            setStreamingContent('');
            setIsStreaming(false);
          } else if (data.type === 'error') {
            setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${data.message}` }]);
            setIsStreaming(false);
          }
        }
      }

      // Fallback: if stream ended without a 'done' event, commit whatever was accumulated
      if (accRef.current) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: accRef.current, sources: finalSources },
        ]);
        accRef.current = '';
        setStreamingContent('');
        setIsStreaming(false);
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Network error — is the backend running?' }]);
    } finally {
      setLoading(false);
      setIsStreaming(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleLogout() {
    await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    navigate('/login');
  }

  const isIndexed  = status === 'indexed' || status === 'ready';
  const isBusy     = loading || isStreaming;

  return (
    <div className="flex h-screen bg-slate-900 text-slate-200">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col p-4 shrink-0">
        <h2 className="text-lg font-semibold text-white mb-4">CodeChat</h2>
        <nav className="flex-1 space-y-1">
          <Link
            to="/add-repo"
            className="block rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
          >
            + Add Repository
          </Link>
          {githubUrl && (
            <div className="px-3 py-2">
              <p className="text-xs text-slate-500 mb-0.5">Current repo</p>
              <p className="text-xs text-slate-300 truncate font-mono">
                {githubUrl.replace('https://github.com/', '')}
              </p>
              <span className={`mt-1 inline-block text-xs px-1.5 py-0.5 rounded-full ${
                isIndexed ? 'bg-green-900/60 text-green-400'
                : status === 'failed' ? 'bg-red-900/60 text-red-400'
                : 'bg-yellow-900/60 text-yellow-400'
              }`}>
                {isIndexed ? 'ready' : status}
              </span>
            </div>
          )}
        </nav>
        <div className="flex items-center gap-2">
          {user?.isGuest && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-300">
              Guest
            </span>
          )}
          <button
            onClick={handleLogout}
            className="text-xs text-slate-500 hover:text-slate-300 text-left transition-colors"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main area */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-slate-700 px-6 py-3 flex items-center gap-3 shrink-0">
          <span className="text-sm text-slate-400 truncate">
            {githubUrl || 'Loading…'}
          </span>
          {chunksTotal > 0 && !isIndexed && (
            <span className="text-xs text-slate-500 shrink-0">
              {chunksIndexed}/{chunksTotal} chunks
            </span>
          )}
        </header>

        {/* Content: indexing view OR chat messages */}
        {!isIndexed ? (
          <IndexingView
            status={status}
            chunksIndexed={chunksIndexed}
            chunksTotal={chunksTotal}
            githubUrl={githubUrl}
          />
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {messages.length === 0 && !isStreaming && (
              <div className="flex items-center justify-center h-full">
                <p className="text-slate-500 text-sm">Ask anything about the codebase.</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} githubUrl={githubUrl} />
            ))}

            {/* "Searching codebase…" spinner — shown before first token arrives */}
            {loading && (
              <div className="flex justify-start mb-4">
                <div className="bg-slate-800 rounded-2xl rounded-bl-sm px-4 py-3">
                  <span className="text-xs text-slate-400">Searching codebase…</span>
                  <span className="inline-flex gap-1 ml-2">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce"
                        style={{ animationDelay: `${i * 120}ms` }}
                      />
                    ))}
                  </span>
                </div>
              </div>
            )}

            {/* Streaming bubble — live token-by-token output */}
            {isStreaming && (
              <div className="flex justify-start mb-4">
                <div className="max-w-2xl bg-slate-800 rounded-2xl rounded-bl-sm px-4 py-3 text-sm leading-relaxed text-slate-100">
                  <div className="whitespace-pre-wrap">{streamingContent}</div>
                  {/* Blinking cursor */}
                  <span className="inline-block w-0.5 h-4 bg-violet-400 animate-pulse ml-0.5 align-text-bottom" />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}

        {/* Input bar — disabled while indexing or awaiting response */}
        <div className="border-t border-slate-700 p-4 shrink-0">
          <div className={`flex items-end gap-3 bg-slate-800 rounded-xl px-4 py-3 ${!isIndexed ? 'opacity-40 pointer-events-none' : ''}`}>
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!isIndexed || isBusy}
              placeholder={isIndexed ? 'Ask a question about the codebase… (Enter to send, Shift+Enter for newline)' : 'Waiting for indexing to complete…'}
              className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 resize-none focus:outline-none max-h-40 overflow-y-auto"
              style={{ fieldSizing: 'content' }}
            />
            <button
              onClick={handleSubmit}
              disabled={!isIndexed || isBusy || !input.trim()}
              className="shrink-0 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 text-xs font-medium text-white transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
