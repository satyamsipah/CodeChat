import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { connectDB } from './config/db.js';
import authRoutes from './routes/auth.js';
import repoRoutes from './routes/repos.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Allow the Vite dev server / Vercel frontend to call our API with cookies
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,      // required so the browser sends httpOnly cookies cross-origin
}));

app.use(express.json());
app.use(cookieParser());  // parses Cookie header → req.cookies

app.use('/api/auth', authRoutes);
app.use('/api/repos', repoRoutes);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Global error handler — catches any async error thrown inside a route
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

connectDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
