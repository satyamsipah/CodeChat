// Hybrid retrieval: semantic (ChromaDB) + keyword (BM25/MiniSearch) + RRF + cross-encoder re-rank.
// Returns top 8 chunks ready for the LLM prompt.

import MiniSearch from 'minisearch';
import { GoogleGenerativeAI } from '@google/generative-ai';
import IndexedRepo from '../../models/IndexedRepo.js';

const genAI  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embedModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

// ── Reciprocal Rank Fusion ────────────────────────────────────────────────────
// Merges two ranked lists using RRF(k=60). Chunks appearing in both lists get
// boosted; chunks unique to one list still contribute.
function reciprocalRankFusion(semanticResults, bm25Results, k = 60) {
  const scores    = new Map();
  const byKey     = new Map();

  semanticResults.forEach((r, idx) => {
    const key = `${r.filePath}:${r.lineStart}`;
    scores.set(key, (scores.get(key) || 0) + 1 / (k + idx + 1));
    byKey.set(key, r);
  });

  bm25Results.forEach((r, idx) => {
    const key = `${r.filePath}:${r.lineStart}`;
    scores.set(key, (scores.get(key) || 0) + 1 / (k + idx + 1));
    if (!byKey.has(key)) byKey.set(key, r);
  });

  return [...byKey.entries()]
    .map(([key, chunk]) => ({ ...chunk, rrfScore: scores.get(key) }))
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, 30);
}

// ── Cross-encoder re-ranking ───────────────────────────────────────────────────
// Sends top30 to HuggingFace cross-encoder in sequential batches of 5
// (free-tier rate limit guard). Falls back to RRF top-8 on any error.
async function rerank(query, top30) {
  try {
    const { HfInference } = await import('@huggingface/inference');
    const hf = new HfInference(process.env.HF_TOKEN);

    const BATCH = 5;
    const scored = [];

    for (let i = 0; i < top30.length; i += BATCH) {
      const batch = top30.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map((chunk) =>
          hf.textClassification({
            model: 'cross-encoder/ms-marco-MiniLM-L-6-v2',
            inputs: `${query} [SEP] ${chunk.text.slice(0, 500)}`,
          })
        )
      );
      results.forEach((r, j) => {
        scored.push({ ...batch[j], rerankScore: r[0]?.score ?? 0 });
      });

      // Small pause between batches to stay within HF free-tier limits
      if (i + BATCH < top30.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return scored.sort((a, b) => b.rerankScore - a.rerankScore).slice(0, 8);
  } catch (err) {
    console.warn('[rerank] Unavailable — using RRF top-8:', err.message);
    return top30.slice(0, 8);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Full hybrid retrieval pipeline for a single query.
 *
 * @param {string} query
 * @param {string|ObjectId} indexId    - IndexedRepo._id
 * @param {object} chromaCollection    - live ChromaDB collection object
 * @returns {Promise<Array<{filePath,lineStart,lineEnd,text,rrfScore,rerankScore?}>>}
 *   Always returns exactly 8 chunks (or fewer if the index is tiny).
 */
export async function hybridSearch(query, indexId, chromaCollection) {
  // 1. Embed query with RETRIEVAL_QUERY task type
  const embedResult = await embedModel.embedContent({
    content: { parts: [{ text: query }] },
    taskType: 'RETRIEVAL_QUERY',
  });
  const queryVector = embedResult.embedding.values;

  // 2. Semantic search — top 20 from ChromaDB
  const chromaResult = await chromaCollection.query({
    queryEmbeddings: [queryVector],
    nResults: 20,
  });
  const semanticResults = chromaResult.metadatas[0].map((meta, i) => ({
    filePath:  meta.filePath,
    lineStart: meta.lineStart,
    lineEnd:   meta.lineEnd,
    text:      chromaResult.documents[0][i],
  }));

  // 3. BM25 keyword search — load serialized index from MongoDB
  const repo = await IndexedRepo.findById(indexId).select('bm25Index');
  const miniSearch = MiniSearch.loadJSON(repo.bm25Index, {
    fields: ['text', 'filePath'],
    storeFields: ['filePath', 'lineStart', 'lineEnd', 'chunkIndex', 'text'],
  });
  const bm25Results = miniSearch
    .search(query, { fuzzy: 0.2, prefix: true, boost: { text: 2, filePath: 1 } })
    .slice(0, 20);

  // 4. RRF merge → top 30
  const top30 = reciprocalRankFusion(semanticResults, bm25Results);

  // 5. Cross-encoder re-rank → top 8 (with graceful fallback)
  return rerank(query, top30);
}
