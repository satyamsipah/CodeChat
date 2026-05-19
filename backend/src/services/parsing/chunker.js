// Pure function — no imports from models or routes.
// Week 3 will replace this with a tree-sitter AST-aware version.
// The signature and return shape must stay the same.

/**
 * Split file content into fixed-size line windows.
 * @param {string} content   - Full file text
 * @param {string} filePath  - Relative path (stored in metadata, not read here)
 * @param {number} chunkSize - Lines per chunk (default 50)
 * @returns {{ text: string, filePath: string, lineStart: number, lineEnd: number, chunkIndex: number }[]}
 */
export function chunkFile(content, filePath, chunkSize = 50) {
  const lines = content.split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) return [];

  const chunks = [];
  let chunkIndex = 0;

  for (let i = 0; i < lines.length; i += chunkSize) {
    const slice = lines.slice(i, i + chunkSize);
    const text = slice.join('\n').trim();
    if (!text) continue; // skip blank-only windows

    chunks.push({
      text,
      filePath,
      lineStart: i + 1,               // 1-indexed
      lineEnd: i + slice.length,       // inclusive
      chunkIndex,
    });
    chunkIndex++;
  }

  return chunks;
}
