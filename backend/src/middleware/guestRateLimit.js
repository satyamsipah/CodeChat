const GUEST_QUERY_LIMIT = 5;

// In-memory counter keyed by guestSessionId. Resets on server restart.
const queryCounts = new Map();

export function guestRateLimit(req, res, next) {
  if (!req.isGuest) return next();

  const count = queryCounts.get(req.guestSessionId) || 0;
  if (count >= GUEST_QUERY_LIMIT) {
    return res.status(429).json({
      error: `Guest query limit reached (${GUEST_QUERY_LIMIT} per session). Please sign up for unlimited access.`,
    });
  }
  queryCounts.set(req.guestSessionId, count + 1);
  next();
}
