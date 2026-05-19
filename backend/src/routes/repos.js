import { Router } from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import simpleGit from 'simple-git';
import IndexedRepo from '../models/IndexedRepo.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// Resolve the backend root so we can build an absolute path to backend/tmp/
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = path.resolve(__dirname, '../../tmp');

// Extensions we treat as text source files worth indexing.
// Everything else (images, binaries, lock files) is skipped.
const TEXT_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.css', '.html', '.md', '.txt', '.json', '.yml', '.yaml',
  '.sh', '.bash', '.env', '.toml', '.xml', '.rb', '.php',
]);

// Directories that are never worth walking into.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor']);

/**
 * Recursively walk a directory (max depth 5) and return an array of
 * { path: relPath, size: bytes } for every matching text file.
 */
function walkDir(dirPath, rootPath, depth = 0) {
  if (depth > 5) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, rootPath, depth + 1));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (TEXT_EXTENSIONS.has(ext)) {
        const { size } = fs.statSync(fullPath);
        results.push({ path: path.relative(rootPath, fullPath), size });
      }
    }
  }
  return results;
}

// POST /api/repos/index
// Body: { githubUrl: "https://github.com/owner/repo" }
// Clones the repo into a temp folder, walks the file tree, saves metadata to DB,
// deletes the temp folder, and returns the file list.
router.post('/index', requireAuth, async (req, res) => {
  const { githubUrl } = req.body;

  // Basic inline validation
  if (!githubUrl) return res.status(400).json({ error: 'githubUrl is required' });
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/.test(githubUrl))
    return res.status(400).json({ error: 'githubUrl must be a valid https://github.com/owner/repo URL' });

  // Create DB record early so the user can track status
  const repo = await IndexedRepo.create({
    userId: req.userId,
    githubUrl,
    status: 'indexing',
  });

  const tmpDir = path.join(TMP_ROOT, randomUUID());

  try {
    // Clone — simple-git handles depth/progress; no extra flags needed for Week 1
    await simpleGit().clone(githubUrl, tmpDir);

    const fileList = walkDir(tmpDir, tmpDir);

    await IndexedRepo.findByIdAndUpdate(repo._id, { fileList, status: 'ready' });

    res.json({
      repoId: repo._id,
      fileCount: fileList.length,
      files: fileList,
    });
  } catch (err) {
    await IndexedRepo.findByIdAndUpdate(repo._id, { status: 'error' });
    res.status(500).json({ error: `Failed to clone or walk repo: ${err.message}` });
  } finally {
    // Always clean up the temp clone, even on error
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

export default router;
