const fs = require('fs');
const path = require('path');

/**
 * Parser for git .mailmap files.
 * Supported line formats (see gitmailmap docs):
 *   1. Proper Name <commit@email>
 *   2. <proper@email> <commit@email>
 *   3. Proper Name <proper@email> <commit@email>
 *   4. Proper Name <proper@email> Commit Name <commit@email>
 *
 * Each entry is normalised to:
 *   { targetName, targetEmail, sourceName, sourceEmail }
 * where a null target means "keep the original value" and a null sourceName
 * means "match on email only".
 */
function parseMailmap(text) {
  const entries = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const segments = [];
    const segmentRe = /(?:\s*([^<>]*?)\s*)?<([^<>]*)>/g;
    let match;
    while ((match = segmentRe.exec(line)) !== null) {
      segments.push({
        name: match[1] ? match[1].trim() : null,
        email: match[2].trim().toLowerCase(),
      });
      if (segments.length >= 2) break;
    }

    if (segments.length === 1) {
      // "Proper Name <commit@email>" - rename only, email stays as-is.
      if (!segments[0].name) continue;
      entries.push({
        targetName: segments[0].name,
        targetEmail: null,
        sourceName: null,
        sourceEmail: segments[0].email,
      });
    } else if (segments.length === 2) {
      entries.push({
        targetName: segments[0].name,
        targetEmail: segments[0].email,
        sourceName: segments[1].name,
        sourceEmail: segments[1].email,
      });
    }
  }
  return entries;
}

/**
 * Loads and parses the .mailmap file at the repository root, if present.
 */
function loadMailmap(repoDir) {
  try {
    const content = fs.readFileSync(path.join(repoDir, '.mailmap'), 'utf8');
    return parseMailmap(content);
  } catch {
    return [];
  }
}

module.exports = { parseMailmap, loadMailmap };
