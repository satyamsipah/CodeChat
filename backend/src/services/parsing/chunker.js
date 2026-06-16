// AST-aware chunker — Week 3 upgrade.
// Signature and return shape are FROZEN (indexingService.js must not change):
//   chunkFile(content, filePath, chunkSize?) → {text,filePath,lineStart,lineEnd,chunkIndex}[]
//
// Strategy by file type:
//   JS/TS/JSX/TSX → Babel AST, extract named symbols; uncovered lines → 40-line chunks
//   .py            → regex block detection (def/class); gaps → 40-line chunks
//   everything else → 80-line sliding window with 20-line overlap

import * as babelParser from '@babel/parser';
import _traverse from '@babel/traverse';

// @babel/traverse ships as CJS — pull .default when bundled that way
const traverse = (_traverse.default ?? _traverse);

const JS_EXTS  = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const PY_EXT   = '.py';

// ─── helpers ─────────────────────────────────────────────────────────────────

function extOf(filePath) {
  const dot = filePath.lastIndexOf('.');
  return dot === -1 ? '' : filePath.slice(dot).toLowerCase();
}

/**
 * Build chunks from an array of {start,end} 1-indexed line ranges
 * (ranges may overlap or be disjoint).
 * Lines outside all ranges become 40-line sliding-window chunks.
 */
function buildChunksFromRanges(lines, filePath, symbolRanges, gapChunkSize = 40) {
  const covered = new Uint8Array(lines.length + 1); // 1-indexed
  for (const { start, end } of symbolRanges) {
    for (let l = start; l <= end && l <= lines.length; l++) covered[l] = 1;
  }

  const chunks = [];
  let idx = 0;

  // Symbol chunks (in source order, deduped by start line)
  const sorted = [...symbolRanges].sort((a, b) => a.start - b.start);
  const seen = new Set();
  for (const { start, end } of sorted) {
    const key = `${start}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const clampedEnd = Math.min(end, lines.length);
    const text = lines.slice(start - 1, clampedEnd).join('\n').trim();
    if (!text) continue;
    chunks.push({ text, filePath, lineStart: start, lineEnd: clampedEnd, chunkIndex: idx++ });
  }

  // Gap chunks — uncovered lines in order
  let gapStart = null;
  for (let l = 1; l <= lines.length; l++) {
    if (!covered[l]) {
      if (gapStart === null) gapStart = l;
    } else {
      if (gapStart !== null) {
        pushSlidingWindow(lines, filePath, gapStart, l - 1, gapChunkSize, 0, chunks, idx);
        idx = chunks.length;
        gapStart = null;
      }
    }
  }
  if (gapStart !== null) {
    pushSlidingWindow(lines, filePath, gapStart, lines.length, gapChunkSize, 0, chunks, idx);
  }

  return chunks;
}

/** Append sliding-window chunks for lines[start-1 .. end-1] (1-indexed) */
function pushSlidingWindow(lines, filePath, start, end, size, overlap, out, startIdx) {
  let idx = startIdx;
  for (let i = start; i <= end; i += (size - overlap)) {
    const sliceEnd = Math.min(i + size - 1, end);
    const text = lines.slice(i - 1, sliceEnd).join('\n').trim();
    if (!text) { i = sliceEnd; continue; }
    out.push({ text, filePath, lineStart: i, lineEnd: sliceEnd, chunkIndex: idx++ });
    if (sliceEnd === end) break;
  }
  return out;
}

// ─── JS/TS/JSX/TSX branch ─────────────────────────────────────────────────────

function chunkJS(content, filePath) {
  const lines = content.split('\n');
  const symbolRanges = [];

  let ast;
  try {
    ast = babelParser.parse(content, {
      sourceType: 'module',
      allowImportExportEverywhere: true,
      errorRecovery: true,
      plugins: ['typescript', 'jsx', 'classProperties', 'decorators-legacy', 'importMeta'],
    });
  } catch (err) {
    console.warn(`[chunker] Babel parse failed for ${filePath}: ${err.message} — falling back`);
    return chunkSliding(content, filePath, 80, 20);
  }

  function addRange(node) {
    if (!node?.loc) return;
    // Capture up to 3 leading comment lines for JSDoc context
    const rawStart = node.loc.start.line;
    const adjustedStart = Math.max(1, rawStart - 3);
    const end = node.loc.end.line;
    const len = end - adjustedStart + 1;

    if (len <= 100) {
      symbolRanges.push({ start: adjustedStart, end });
    } else {
      // Large block: split into 50-line sub-chunks, keep signature on each
      const sig = lines[rawStart - 1]; // function/class declaration line
      for (let i = adjustedStart; i <= end; i += 50) {
        const subEnd = Math.min(i + 49, end);
        symbolRanges.push({ start: i, end: subEnd, prefixLine: i === adjustedStart ? null : sig });
      }
    }
  }

  traverse(ast, {
    FunctionDeclaration: ({ node }) => addRange(node),
    ClassDeclaration:    ({ node }) => addRange(node),
    ClassMethod:         ({ node }) => addRange(node),
    ObjectMethod:        ({ node }) => addRange(node),
    // ArrowFunctionExpression / FunctionExpression only when they're named via assignment
    VariableDeclarator({ node }) {
      if (
        node.init &&
        (node.init.type === 'ArrowFunctionExpression' ||
         node.init.type === 'FunctionExpression')
      ) {
        addRange(node.init);
      }
    },
    ExportDefaultDeclaration({ node }) {
      if (
        node.declaration?.type === 'ArrowFunctionExpression' ||
        node.declaration?.type === 'FunctionExpression'
      ) {
        addRange(node.declaration);
      }
    },
  });

  if (symbolRanges.length === 0) {
    // No symbols found (e.g. pure config file) — use enhanced sliding window
    return chunkSliding(content, filePath, 80, 20);
  }

  return buildChunksFromRanges(lines, filePath, symbolRanges);
}

// ─── Python branch ────────────────────────────────────────────────────────────

function chunkPython(content, filePath) {
  const lines = content.split('\n');
  const blockStartRe = /^(async def |def |class )[\w]/gm;

  // Find all block start line numbers (1-indexed)
  const blockStarts = [];
  let m;
  const lineOffsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineOffsets.push(i + 1);
  }

  while ((m = blockStartRe.exec(content)) !== null) {
    // Convert byte offset to line number
    let lo = 0, hi = lineOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineOffsets[mid] <= m.index) lo = mid; else hi = mid - 1;
    }
    blockStarts.push(lo + 1); // 1-indexed
  }

  if (blockStarts.length === 0) return chunkSliding(content, filePath, 80, 20);

  const symbolRanges = blockStarts.map((start, i) => ({
    start,
    end: i + 1 < blockStarts.length ? blockStarts[i + 1] - 1 : lines.length,
  }));

  return buildChunksFromRanges(lines, filePath, symbolRanges, 40);
}

// ─── Enhanced sliding window (fallback + other file types) ────────────────────

function chunkSliding(content, filePath, size = 80, overlap = 20) {
  const lines = content.split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) return [];
  const out = [];
  pushSlidingWindow(lines, filePath, 1, lines.length, size, overlap, out, 0);
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {string} content
 * @param {string} filePath   relative path (for metadata only)
 * @param {number} chunkSize  used only by the sliding-window fallback
 * @returns {{ text:string, filePath:string, lineStart:number, lineEnd:number, chunkIndex:number }[]}
 */
export function chunkFile(content, filePath, chunkSize = 50) {
  if (!content || !content.trim()) return [];

  const ext = extOf(filePath);
  if (JS_EXTS.has(ext))  return chunkJS(content, filePath);
  if (ext === PY_EXT)    return chunkPython(content, filePath);
  return chunkSliding(content, filePath, 80, 20);
}
