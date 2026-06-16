// Standalone smoke test — run with: node scripts/test-gemini.js
// Proves that GEMINI_API_KEY is valid and the embedding model responds.
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const key = process.env.GEMINI_API_KEY;
if (!key || key.startsWith('PASTE')) {
  console.error('Set GEMINI_API_KEY in backend/.env first.');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(key);
// Note: Gemini's current embedding model is 'gemini-embedding-001' (not 'embedding-001')
const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

const testString = 'Hello, CodeChat!';
console.log(`Embedding: "${testString}"…`);

const result = await model.embedContent(testString);
const values = result.embedding.values;
console.log(`✓ Success — embedding dimensions: ${values.length}`);
console.log(`  First 5 values: [${values.slice(0, 5).map(v => v.toFixed(6)).join(', ')}]`);
