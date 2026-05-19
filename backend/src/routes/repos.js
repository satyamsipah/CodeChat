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
import chromaClient from '../services/chromaClient.js';

const router = Router();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
const llm = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

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
// Embeds the query, retrieves top-10 chunks from ChromaDB, calls Gemini LLM,
// and returns the answer with source citations.
router.post('/:indexId/query', requireAuth, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });

  const repo = await IndexedRepo.findOne({ _id: req.params.indexId, userId: req.userId });
  if (!repo) return res.status(404).json({ error: 'Repo not found' });
  if (repo.status !== 'indexed')
    return res.status(400).json({ error: `Repo is not ready (status: ${repo.status})` });

  // Embed the user's query — use RETRIEVAL_QUERY task type for best retrieval results
  const embedResult = await embeddingModel.embedContent({
    content: { parts: [{ text: query }] },
    taskType: 'RETRIEVAL_QUERY',
  });
  const queryVector = embedResult.embedding.values;

  // Retrieve top 10 semantically similar chunks from ChromaDB
  const collection = await chromaClient.getCollection({ name: `repo_${repo._id}` });
  const results = await collection.query({ queryEmbeddings: [queryVector], nResults: 10 });

  // Build context block: each result gets a citation header + chunk text
  const sources = results.metadatas[0].map((meta, i) => ({
    filePath:  meta.filePath,
    lineStart: meta.lineStart,
    lineEnd:   meta.lineEnd,
    text:      results.documents[0][i],
  }));

  const contextBlock = sources
    .map((s) => `[${s.filePath}:${s.lineStart}-${s.lineEnd}]\n${s.text}`)
    .join('\n\n');

  const prompt = `You are a codebase Q&A assistant. Answer using ONLY the provided code context below. Cite every claim with its source as [filePath:lineStart-lineEnd]. If the context does not contain enough information to answer, say so clearly.

CODE CONTEXT:
${contextBlock}

QUESTION: ${query}`;

  const llmResult = await llm.generateContent(prompt);
  const answer = llmResult.response.text();

  res.json({ answer, sources });
});

export default router;
