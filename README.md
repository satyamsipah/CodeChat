# CodeChat — Ask Questions About Any Codebase

Paste a public GitHub repo URL and ask questions about the code in natural language. Answers stream token-by-token with exact file and line citations.

---

## Demo

> "What does the Router class do?"

*Answer streams in real time with citations like `lib/router/index.js:45-120` — click to open the exact line on GitHub.*

---

## The Problem

Reading an unfamiliar codebase means grep-ing through files, tracing call stacks, and piecing together context from a dozen different places. CodeChat collapses that into a single question. It retrieves the most relevant code chunks, re-ranks them, and streams a grounded answer — every claim backed by a source you can verify.

---

## How It Works

### Indexing Pipeline

```
GitHub URL
  → git clone
  → AST-aware chunking (Babel parser for JS/TS, regex for Python, sliding window fallback)
  → Gemini embeddings (gemini-embedding-001, 3072-dim, batched 5/req)
  → MongoDB Atlas Vector Search  (semantic index)
  + MiniSearch BM25              (keyword index, serialized to MongoDB)
```

### Query Pipeline

```
User question
  → Gemini embed (RETRIEVAL_QUERY task type)
  → Parallel retrieval:
      Atlas $vectorSearch  → top 20 semantic chunks
      MiniSearch BM25      → top 20 keyword chunks
  → Reciprocal Rank Fusion → top 30
  → cross-encoder/ms-marco-MiniLM-L-6-v2 re-ranking → top 8
  → Gemini 1.5 Flash (generateContentStream)
  → SSE stream → answer + file:line citations
```

---

## Evaluation

Evaluated on `expressjs/express` (~110 JS files):

| Metric | Score |
|--------|-------|
| retrieval@8 | run `node evaluate.js` to get your score |
| Chunks generated | ~1,200 |

**Sample Q&A from eval dataset:**

| Question | Expected source |
|----------|----------------|
| What does the Router class do? | `lib/router/index.js` |
| How does Express handle middleware? | `lib/application.js` |
| What parameters does app.listen accept? | `lib/application.js` |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, Tailwind CSS v4, react-markdown |
| Backend | Node.js 20+, Express, ESM |
| Auth | JWT via httpOnly cookie |
| Vector DB | MongoDB Atlas Vector Search (cosine, 3072-dim) |
| Keyword search | MiniSearch (BM25, serialized in MongoDB) |
| Embeddings | Google Gemini `gemini-embedding-001` |
| LLM | Google Gemini `gemini-1.5-flash-latest` (streaming) |
| Re-ranking | HuggingFace `cross-encoder/ms-marco-MiniLM-L-6-v2` |
| Chunking | `@babel/parser` (JS/TS), regex (Python), sliding window |
| Deployment | Render (backend) + Vercel (frontend) |

---

## Running Locally

### Prerequisites

- Node.js 20+
- A MongoDB Atlas cluster with the `chunks_vector_index` created (see below)
- Google Gemini API key
- HuggingFace token (free tier is fine)

### 1. Clone and install

```bash
git clone https://github.com/satyamsipah/CodeChat.git
cd CodeChat

# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 2. Configure environment

Create `backend/.env`:

```env
MONGODB_URI=mongodb+srv://...
GEMINI_API_KEY=...
HF_TOKEN=hf_...
JWT_SECRET=some-long-random-string
FRONTEND_URL=http://localhost:5173
PORT=5000
```

### 3. Create the Atlas Vector Search index

In the Atlas UI:
1. Browse Collections → your database → `chunks` collection
2. **Search Indexes** tab → Create Search Index → JSON Editor
3. Paste:
```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 3072, "similarity": "cosine" },
    { "type": "filter", "path": "repoId" }
  ]
}
```
4. Name it `chunks_vector_index`. Wait ~2 minutes for status → Active.

### 4. Start the servers

```bash
# Backend (from /backend)
node src/index.js

# Frontend (from /frontend)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), paste a GitHub URL, and start asking.

---

## Deployment

| Service | Role |
|---------|------|
| [Render](https://render.com) | Backend (Node, free tier) |
| [Vercel](https://vercel.com) | Frontend (Vite, free tier) |
| MongoDB Atlas | Vector + document DB (free tier) |
| HuggingFace Inference API | Cross-encoder re-ranking (free tier) |

**Render env vars:** `MONGODB_URI`, `GEMINI_API_KEY`, `HF_TOKEN`, `JWT_SECRET`, `FRONTEND_URL=https://your-app.vercel.app`, `NODE_ENV=production`

**Vercel env var:** `VITE_API_URL=https://your-backend.onrender.com`

**Atlas Network Access:** Add `0.0.0.0/0` to allow Render's dynamic IPs.

> **Note:** Render free tier sleeps after 15 minutes of inactivity. The first request after sleep takes ~30 seconds (cold start). Hit `GET /api/health` to wake it before a demo.

---

## Running the Evaluation Harness

```bash
cd backend
node evaluate.js
```

Runs 20 questions against `expressjs/express` and reports `retrieval@8` — the fraction of questions where the correct file appears in the top 8 retrieved chunks.

---

## Author

**Satyam Maddheshiya** | satyam.sipah12@gmail.com
