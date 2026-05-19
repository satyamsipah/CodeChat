import fs from 'fs';
import path from 'path';
import MiniSearch from 'minisearch';
import { GoogleGenerativeAI } from '@google/generative-ai';
import IndexedRepo from '../models/IndexedRepo.js';
import Chunk from '../models/Chunk.js';
import { chunkFile } from './parsing/chunker.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

const MAX_FILE_BYTES = 512_000; // 500 KB — skip files larger than this
const BATCH_SIZE = 5;           // chunks per batchEmbedContents call
const BATCH_DELAY_MS = 1000;    // 1s between batches → ~5 req/s, well under Gemini free-tier limit

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Embed a batch of chunks in one API call.
 * Retries once with a longer delay on 429 (rate limit).
 */
async function embedBatch(chunks) {
  const requests = chunks.map((c) => ({
    content: { parts: [{ text: c.text }] },
    taskType: 'RETRIEVAL_DOCUMENT',
  }));

  // Exponential backoff: 3 retries at 2s, 4s, 8s
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const result = await embeddingModel.batchEmbedContents({ requests });
      return result.embeddings.map((e) => e.values);
    } catch (err) {
      const is429 = err?.status === 429 || String(err?.message).includes('429');
      if (is429 && attempt < 3) {
        const delay = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s
        console.warn(`[indexing] Rate limited (429) — waiting ${delay / 1000}s (attempt ${attempt + 1}/3)`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

/**
 * Background indexing pipeline.
 * Called fire-and-forget from repos.js — must not throw (catches all errors internally).
 *
 * @param {object} repo   - Mongoose IndexedRepo document
 * @param {string} tmpDir - Absolute path to the cloned repo (this function owns cleanup)
 */
export async function startIndexing(repo, tmpDir) {
  try {
    // ── Phase 1: count all chunks so we can set chunksTotal early ──────────
    await IndexedRepo.findByIdAndUpdate(repo._id, { status: 'indexing', chunksTotal: 0 });

    // Delete existing chunks for this repo (handles re-index cleanly)
    await Chunk.deleteMany({ repoId: repo._id });

    // First pass: build the full chunk list in memory
    // We do this so we can set chunksTotal before the slow embedding loop begins
    const allChunks = [];
    for (const file of repo.fileList) {
      if (file.size > MAX_FILE_BYTES) continue;
      const fullPath = path.join(tmpDir, file.path);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, 'utf8');
      const chunks = chunkFile(content, file.path);
      allChunks.push(...chunks);
    }

    await IndexedRepo.findByIdAndUpdate(repo._id, { chunksTotal: allChunks.length });
    console.log(`[indexing] ${repo.githubUrl} — ${allChunks.length} chunks to embed`);

    // ── Phase 2: build BM25 index and persist to MongoDB ───────────────────
    // MiniSearch storeFields carry full chunk text — no separate chunk map needed
    const miniSearch = new MiniSearch({
      fields: ['text', 'filePath'],
      storeFields: ['filePath', 'lineStart', 'lineEnd', 'chunkIndex', 'text'],
    });
    miniSearch.addAll(allChunks.map((c, i) => ({ id: i, ...c })));
    await IndexedRepo.findByIdAndUpdate(repo._id, { bm25Index: JSON.stringify(miniSearch) });
    console.log(`[indexing] BM25 index built (${allChunks.length} docs)`);

    // ── Phase 3: embed in batches and store in ChromaDB ────────────────────
    let indexed = 0;
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE);
      const vectors = await embedBatch(batch);

      // Store chunks with embeddings in Atlas
      await Chunk.insertMany(
        batch.map((chunk, i) => ({
          repoId:     repo._id,
          text:       chunk.text,
          filePath:   chunk.filePath,
          lineStart:  chunk.lineStart,
          lineEnd:    chunk.lineEnd,
          chunkIndex: chunk.chunkIndex,
          embedding:  vectors[i],
        }))
      );

      indexed += batch.length;
      // Update DB progress every batch so the status endpoint shows real-time progress
      await IndexedRepo.findByIdAndUpdate(repo._id, { chunksIndexed: indexed });

      if (i + BATCH_SIZE < allChunks.length) await sleep(BATCH_DELAY_MS);
    }

    await IndexedRepo.findByIdAndUpdate(repo._id, { status: 'indexed' });
    console.log(`[indexing] Done — ${repo.githubUrl} indexed (${indexed} chunks)`);

  } catch (err) {
    console.error(`[indexing] Failed for ${repo.githubUrl}:`, err.message);
    await IndexedRepo.findByIdAndUpdate(repo._id, { status: 'failed' }).catch(() => {});
  } finally {
    // Always clean up the temp clone — runs whether indexing succeeded or failed
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      console.log(`[indexing] Cleaned up tmpDir: ${tmpDir}`);
    }
  }
}
