import User from '../models/User.js';
import IndexedRepo from '../models/IndexedRepo.js';
import Chunk from '../models/Chunk.js';

// Runs ahead of MongoDB's TTL reaper to cascade-delete repos and chunks
// owned by expired guest users before the user documents themselves are removed.
export async function cleanupExpiredGuests() {
  const expired = await User.find(
    { isGuest: true, guestExpiresAt: { $lte: new Date() } },
    { _id: 1 },
  );
  for (const guest of expired) {
    const repos = await IndexedRepo.find({ userId: guest._id }, { _id: 1 });
    if (repos.length) {
      await Chunk.deleteMany({ repoId: { $in: repos.map((r) => r._id) } });
      await IndexedRepo.deleteMany({ userId: guest._id });
    }
    await User.deleteOne({ _id: guest._id });
  }
}
