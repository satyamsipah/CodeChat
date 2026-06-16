import User from '../models/User.js';
import IndexedRepo from '../models/IndexedRepo.js';
import Chunk from '../models/Chunk.js';

const GUEST_REPO_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function cleanupExpiredGuests() {
  // Remove expired JWT-based guest users (legacy path) and their data
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

  // Remove sessionId-based guest repos older than 24 hours
  const cutoff = new Date(Date.now() - GUEST_REPO_TTL_MS);
  const oldGuestRepos = await IndexedRepo.find(
    { guestSessionId: { $exists: true, $ne: null }, createdAt: { $lte: cutoff } },
    { _id: 1 },
  );
  if (oldGuestRepos.length) {
    const ids = oldGuestRepos.map((r) => r._id);
    await Chunk.deleteMany({ repoId: { $in: ids } });
    await IndexedRepo.deleteMany({ _id: { $in: ids } });
  }
}
