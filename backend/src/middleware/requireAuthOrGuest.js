import jwt from 'jsonwebtoken';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireAuthOrGuest(req, res, next) {
  const token = req.cookies?.token;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.userId = payload.userId;
      return next();
    } catch { /* fall through to guest check */ }
  }

  const guestSessionId = req.headers['x-guest-session'];
  if (guestSessionId && UUID_RE.test(guestSessionId)) {
    req.guestSessionId = guestSessionId;
    req.isGuest = true;
    return next();
  }

  return res.status(401).json({ error: 'Not authenticated' });
}
