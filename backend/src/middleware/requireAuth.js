import jwt from 'jsonwebtoken';

// Reads the httpOnly cookie set at login/signup, verifies the JWT,
// and attaches req.userId so downstream routes know who is calling.
export function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
