import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  email:     { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  password:  { type: String },
  isGuest:   { type: Boolean, default: false },
  guestExpiresAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

// TTL index: MongoDB removes guest user docs when guestExpiresAt is reached.
// sparse: true means documents without guestExpiresAt (real users) are never touched.
userSchema.index({ guestExpiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

export default mongoose.model('User', userSchema);
