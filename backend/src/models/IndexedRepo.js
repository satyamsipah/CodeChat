import mongoose from 'mongoose';

const indexedRepoSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  githubUrl: { type: String, required: true },
  fileList:  [{ path: String, size: Number }],
  // Week 1 values kept for backward compat; Week 2 uses pending/indexing/indexed/failed
  status: {
    type: String,
    enum: ['pending', 'indexing', 'indexed', 'failed', 'ready', 'error'],
    default: 'pending',
  },
  chunksTotal:   { type: Number, default: 0 },
  chunksIndexed: { type: Number, default: 0 },
  // Serialized MiniSearch BM25 index — storeFields carry filePath/lineStart/lineEnd/text
  bm25Index:     { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('IndexedRepo', indexedRepoSchema);
