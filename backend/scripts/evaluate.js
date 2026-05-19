// Retrieval evaluation harness — run with:
//   node scripts/evaluate.js <REPO_INDEX_ID>
//
// Measures retrieval@8: fraction of 20 questions where the expected file
// appears in any of the 8 retrieved chunks.
// Target: ≥ 0.70

import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import mongoose from 'mongoose';
import { ChromaClient } from 'chromadb';
import { hybridSearch } from '../src/services/retrieval/hybridRetrieval.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(
  readFileSync(path.join(__dirname, 'eval-dataset.json'), 'utf8')
);

const indexId = process.argv[2];
if (!indexId) {
  console.error('Usage: node scripts/evaluate.js <REPO_INDEX_ID>');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
const chroma = new ChromaClient({ path: 'http://localhost:8000' });
const collection = await chroma.getCollection({ name: `repo_${indexId}` });

let hits = 0;
console.log(`\nEvaluating ${dataset.length} questions for repo ${indexId}\n`);
console.log('─'.repeat(70));

for (const { question, expectedFilePath } of dataset) {
  let top8;
  try {
    top8 = await hybridSearch(question, indexId, collection);
  } catch (err) {
    console.log(`  ✗ ERROR  — ${question.slice(0, 60)}`);
    console.log(`           ${err.message}`);
    continue;
  }

  const hit = top8.some((r) => r.filePath.includes(expectedFilePath));
  if (hit) hits++;

  const mark  = hit ? '✓' : '✗';
  const label = hit ? 'HIT ' : 'MISS';
  console.log(`  ${mark} ${label} — ${question}`);
  if (!hit) {
    const got = [...new Set(top8.map((r) => r.filePath))].slice(0, 3).join(', ');
    console.log(`         expected: ${expectedFilePath}`);
    console.log(`         got:      ${got}`);
  }
}

const score = hits / dataset.length;
console.log('─'.repeat(70));
console.log(`\nRetrieval@8: ${hits}/${dataset.length} = ${(score * 100).toFixed(1)}%`);
console.log(score >= 0.7 ? '✓ Target met (≥ 70%)' : '✗ Below target — check BM25 weights and RRF');

await mongoose.disconnect();
process.exit(score >= 0.7 ? 0 : 1);
