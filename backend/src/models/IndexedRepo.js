import mongoose from 'mongoose';

const indexedRepoSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  githubUrl: { type: String, required: true },
  fileList:  [{ path: String, size: Number }],
  // 'indexing' while cloning/walking, 'ready' on success, 'error' on failure
  status:    { type: String, enum: ['indexing', 'ready', 'error'], default: 'indexing' },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('IndexedRepo', indexedRepoSchema);
