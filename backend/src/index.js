import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { connectDB } from './config/db.js';
import authRoutes from './routes/auth.js';
import repoRoutes from './routes/repos.js';
import { cleanupExpiredGuests } from './jobs/guestCleanup.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  allowedHeaders: ['Content-Type', 'X-Guest-Session'],
}));

app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/repos', repoRoutes);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

connectDB().then(() => {
  cleanupExpiredGuests();
  setInterval(cleanupExpiredGuests, 60 * 60 * 1000);
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
