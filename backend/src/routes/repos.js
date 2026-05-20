import { Router } from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import simpleGit from 'simple-git';
import IndexedRepo from '../models/IndexedRepo.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { startIndexing } from '../services/indexingService.js';
import { hybridSearch } from '../services/retrieval/hybridRetrieval.js';

const router = Router();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = path.resolve(__dirname, '../../tmp');

const TEXT_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.css', '.html', '.md', '.txt', '.json', '.yml', '.yaml',
  '.sh', '.bash', '.env', '.toml', '.xml', '.rb', '.php',
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor']);

function walkDir(dirPath, rootPath, depth = 0) {
  if (depth > 5) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, rootPath, depth + 1));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (TEXT_EXTENSIONS.has(ext)) {
        const { size } = fs.statSync(fullPath);
        results.push({ path: path.relative(rootPath, fullPath), size });
      }
    }
  }
  return results;
}

// ── POST /api/repos/index ─────────────────────────────────────────────────────
// Clones + walks synchronously (fast), then fires background chunking/embedding.
// Returns immediately so the client doesn't have to wait for the slow embed step.
router.post('/index', requireAuth, async (req, res) => {
  const { githubUrl } = req.body;
  if (!githubUrl)
    return res.status(400).json({ error: 'githubUrl is required' });
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/.test(githubUrl))
    return res.status(400).json({ error: 'githubUrl must be https://github.com/owner/repo' });

  const repo = await IndexedRepo.create({ userId: req.userId, githubUrl, status: 'pending' });
  const tmpDir = path.join(TMP_ROOT, randomUUID());

  try {
    await simpleGit().clone(githubUrl, tmpDir);
    const fileList = walkDir(tmpDir, tmpDir);
    await IndexedRepo.findByIdAndUpdate(repo._id, { fileList });

    // Kick off background pipeline — do NOT await (that would block the response)
    // indexingService owns tmpDir cleanup in its finally block
    startIndexing({ ...repo.toObject(), fileList }, tmpDir).catch(() => {});

    res.json({ indexId: repo._id, status: 'indexing', fileCount: fileList.length });
  } catch (err) {
    await IndexedRepo.findByIdAndUpdate(repo._id, { status: 'failed' });
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    res.status(500).json({ error: `Clone failed: ${err.message}` });
  }
});

// ── GET /api/repos/:indexId/status ────────────────────────────────────────────
// Polled by ChatShell every 3 s to drive the indexing progress UI.
router.get('/:indexId/status', requireAuth, async (req, res) => {
  const repo = await IndexedRepo.findOne({ _id: req.params.indexId, userId: req.userId });
  if (!repo) return res.status(404).json({ error: 'Repo not found' });
  res.json({
    status:        repo.status,
    chunksIndexed: repo.chunksIndexed,
    chunksTotal:   repo.chunksTotal,
    githubUrl:     repo.githubUrl,
  });
});

// ── POST /api/repos/:indexId/query ────────────────────────────────────────────
// Streams the answer token-by-token via SSE using Gemini generateContentStream.
// Event types: { type: 'token', token } | { type: 'sources', sources } | { type: 'done' } | { type: 'error', message }
router.post('/:indexId/query', requireAuth, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });

  const repo = await IndexedRepo.findOne({ _id: req.params.indexId, userId: req.userId });
  if (!repo) return res.status(404).json({ error: 'Repo not found' });
  if (repo.status !== 'indexed')
    return res.status(400).json({ error: `Repo is not ready (status: ${repo.status})` });

  // Set SSE-specific headers without overwriting CORS headers already applied by middleware
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders(); // flush headers immediately so the browser opens the stream

  try {
    // Hybrid retrieval: Atlas $vectorSearch + BM25 → RRF → cross-encoder → top 8
    const top8 = await hybridSearch(query, repo._id);

    const contextBlock = top8
      .map((c) => `[${c.filePath}:${c.lineStart}-${c.lineEnd}]\n${c.text}`)
      .join('\n\n---\n\n');

    const prompt = `You are a codebase Q&A assistant. The snippets below were retrieved using hybrid semantic + BM25 keyword search, re-ranked by a cross-encoder. Answer using ONLY these snippets. Cite every claim as [filePath:lineStart-lineEnd]. If the answer is not in the snippets, say so explicitly.

CODE CONTEXT:
${contextBlock}

QUESTION: ${query}`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const streamResult = await model.generateContentStream(prompt);

    for await (const chunk of streamResult.stream) {
      const token = chunk.text();
      if (token) res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({
      type: 'sources',
      sources: top8.map((c) => ({ filePath: c.filePath, lineStart: c.lineStart, lineEnd: c.lineEnd })),
    })}\n\n`);

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    // Return a human-readable message instead of the raw API error
    let message = 'Something went wrong — please try again.';
    const raw = err.message || '';
    if (raw.includes('429') || raw.toLowerCase().includes('quota')) {
      message = 'Gemini API rate limit reached. The free tier allows a limited number of requests per minute — please wait 60 seconds and try again.';
    } else if (raw.includes('API_KEY') || raw.includes('401') || raw.includes('403')) {
      message = 'Gemini API key is invalid or missing. Check the GEMINI_API_KEY environment variable.';
    } else if (raw.includes('503') || raw.toLowerCase().includes('unavailable')) {
      message = 'Gemini API is temporarily unavailable. Please try again in a moment.';
    }
    res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    res.end();
  }
});

export default router;
