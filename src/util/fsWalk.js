const fs = require('fs/promises');
const path = require('path');

const SKIP_DIRS = new Set(['.git', 'node_modules', '.hg', '.svn']);
const MAX_FILES = 50000;

/**
 * Recursively lists files under `root`, returning repo-relative POSIX paths.
 * Skips VCS internals and node_modules. Directory order is deterministic.
 */
async function walkFiles(root, options = {}) {
  const skip = options.skipDirs || SKIP_DIRS;
  const maxFiles = options.maxFiles || MAX_FILES;
  const files = [];

  async function visit(dir, relPrefix) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        await visit(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        files.push({ path: rel });
      }
    }
  }

  await visit(root, '');
  return files;
}

/**
 * Counts lines in a text blob. A trailing newline does not create an extra line.
 */
function countLines(text) {
  if (!text) return 0;
  const lines = text.split('\n');
  return text.endsWith('\n') ? lines.length - 1 : lines.length;
}

/**
 * Heuristic binary detection: a NUL byte in the first chunk means binary.
 */
function isProbablyBinary(buffer) {
  const len = Math.min(buffer.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

module.exports = { walkFiles, countLines, isProbablyBinary, SKIP_DIRS };
