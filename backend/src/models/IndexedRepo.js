import mongoose from 'mongoose';

const indexedRepoSchema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // null for guest sessions
  guestSessionId: { type: String },                                       // UUID for headerless guest flow
  githubUrl:      { type: String, required: true },
  fileList:       [{ path: String, size: Number }],
  status: {
    type: String,
    enum: ['pending', 'indexing', 'indexed', 'failed', 'ready', 'error'],
    default: 'pending',
  },
  chunksTotal:   { type: Number, default: 0 },
  chunksIndexed: { type: Number, default: 0 },
  bm25Index:     { type: String, default: '' },
  createdAt:     { type: Date, default: Date.now },
});

export default mongoose.model('IndexedRepo', indexedRepoSchema);
