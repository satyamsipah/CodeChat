import { useNavigate } from 'react-router-dom';

// Week 1 — layout placeholder only. AI chat will be wired in Week 2+.
export default function ChatShell() {
  const navigate = useNavigate();

  return (
    <div className="flex h-screen bg-slate-900 text-slate-200">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col p-4">
        <h2 className="text-lg font-semibold text-white mb-4">CodeChat</h2>
        <nav className="flex-1 space-y-2">
          <button
            onClick={() => navigate('/add-repo')}
            className="w-full text-left rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
          >
            + Add Repository
          </button>
          {/* TODO (Week 2): list indexed repos here */}
          <div className="px-3 py-2 text-xs text-slate-500 italic">
            No repos indexed yet
          </div>
        </nav>
      </aside>

      {/* Main chat area */}
      <main className="flex-1 flex flex-col">
        {/* Header */}
        <header className="border-b border-slate-700 px-6 py-4 flex items-center justify-between">
          <span className="text-sm text-slate-400">No repository selected</span>
          {/* TODO (Week 2): repo selector dropdown */}
        </header>

        {/* Message area — placeholder */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <p className="text-slate-500 text-sm">
              Chat UI coming in Week 2.
            </p>
            <p className="text-slate-600 text-xs mt-1">
              Index a repo first, then ask questions about its code here.
            </p>
          </div>
        </div>

        {/* Input bar — placeholder */}
        <div className="border-t border-slate-700 p-4">
          <div className="flex items-center gap-3 bg-slate-800 rounded-xl px-4 py-3 opacity-50 cursor-not-allowed">
            <span className="flex-1 text-slate-500 text-sm">Ask a question about the codebase…</span>
            <span className="text-slate-600 text-xs">⌘↵</span>
          </div>
          <p className="text-center text-xs text-slate-600 mt-2">
            {/* TODO (Week 4): wire SSE streaming here */}
            AI Q&A not yet connected
          </p>
        </div>
      </main>
    </div>
  );
}
