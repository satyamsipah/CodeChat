import { Router } from 'express';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// Cookie options reused across signup and login.
// In production the frontend (Vercel) and backend (Render) are on different
// domains, so the cookie must be SameSite=None; Secure — the only way
// browsers will store a cross-site cookie sent with credentials:'include'.
// Locally we keep sameSite:'lax' (no HTTPS) so dev still works.
const isProd = process.env.NODE_ENV === 'production';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: isProd ? 'none' : 'lax',
  secure:   isProd,               // 'none' requires Secure flag
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
};

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email, and password are required' });

  const existing = await User.findOne({ email });
  if (existing)
    return res.status(409).json({ error: 'Email already in use' });

  const hashed = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email, password: hashed });

  res.cookie('token', signToken(user._id), COOKIE_OPTS);
  res.status(201).json({ message: 'ok', user: { name: user.name, email: user.email } });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'email and password are required' });

  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  res.cookie('token', signToken(user._id), COOKIE_OPTS);
  res.json({ message: 'ok', user: { name: user.name, email: user.email } });
});

// POST /api/auth/guest — creates an ephemeral guest account valid for 24 h
router.post('/guest', async (req, res) => {
  const name = `guest_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const guestExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const user = await User.create({ name, isGuest: true, guestExpiresAt });
  const guestCookieOpts = { ...COOKIE_OPTS, maxAge: 24 * 60 * 60 * 1000 };
  res.cookie('token', signToken(user._id), guestCookieOpts);
  res.status(201).json({ message: 'ok', user: { name: user.name, isGuest: true } });
});

// POST /api/auth/logout — just clears the cookie
// Must pass same sameSite/secure options as Set-Cookie or browsers ignore it
router.post('/logout', (req, res) => {
  res.clearCookie('token', { sameSite: isProd ? 'none' : 'lax', secure: isProd });
  res.json({ message: 'Logged out' });
});

// GET /api/auth/me — used by the frontend ProtectedRoute to check auth state
router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId).select('name email isGuest');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

export default router;
