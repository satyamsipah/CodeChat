import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import IndexedRepo from '../models/IndexedRepo.js';
import chromaClient from './chromaClient.js';
import { chunkFile } from './parsing/chunker.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

const MAX_FILE_BYTES = 512_000; // 500 KB — skip files larger than this
const BATCH_SIZE = 5;           // chunks per batchEmbedContents call
const BATCH_DELAY_MS = 200;     // pause between batches (free-tier rate limit guard)

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

  try {
    const result = await embeddingModel.batchEmbedContents({ requests });
    return result.embeddings.map((e) => e.values);
  } catch (err) {
    // 429 = rate limited — wait longer and retry once
    if (err?.status === 429) {
      console.warn('[indexing] Rate limited (429) — retrying after 500 ms');
      await sleep(500);
      const result = await embeddingModel.batchEmbedContents({ requests });
      return result.embeddings.map((e) => e.values);
    }
    throw err;
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

    // Delete + recreate the ChromaDB collection (handles re-index cleanly)
    try {
      await chromaClient.deleteCollection({ name: `repo_${repo._id}` });
    } catch {
      // Collection didn't exist yet — fine
    }
    const collection = await chromaClient.createCollection({
      name: `repo_${repo._id}`,
      metadata: { 'hnsw:space': 'cosine' },
    });

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

    // ── Phase 2: embed in batches and store in ChromaDB ────────────────────
    let indexed = 0;
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE);
      const vectors = await embedBatch(batch);

      // ChromaDB add() expects parallel arrays
      await collection.add({
        ids:        batch.map((c) => `${repo._id}_${c.filePath}_${c.chunkIndex}`),
        embeddings: vectors,
        documents:  batch.map((c) => c.text),
        metadatas:  batch.map((c) => ({
          filePath:   c.filePath,
          lineStart:  c.lineStart,
          lineEnd:    c.lineEnd,
          repoId:     String(repo._id),
          chunkIndex: c.chunkIndex,
        })),
      });

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
