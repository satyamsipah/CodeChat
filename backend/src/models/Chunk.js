import mongoose from 'mongoose';

const chunkSchema = new mongoose.Schema({
  repoId:     { type: mongoose.Schema.Types.ObjectId, ref: 'IndexedRepo', index: true },
  text:       String,
  filePath:   String,
  lineStart:  Number,
  lineEnd:    Number,
  chunkIndex: Number,
  embedding:  { type: [Number] },   // 3072-dim from gemini-embedding-001
});

export default mongoose.model('Chunk', chunkSchema);
