/**
 * Filter normalisation and commit-set filtering.
 *
 * Supported filters (all optional, combinable):
 *   - authorIds : resolved author ids (from the author resolver)
 *   - path      : file or directory prefix (POSIX, no leading/trailing slash)
 *   - from / to : date boundaries (YYYY-MM-DD is interpreted in local time)
 *   - hashes    : manually selected commit hashes (full or abbreviated).
 *                 When present, the manual selection replaces the date range.
 */

function parseDateBoundary(value, endOfDay) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    if (endOfDay) date.setHours(23, 59, 59, 999);
    return date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeFilters(input = {}) {
  const safe = input && typeof input === 'object' ? input : {};
  return {
    authorIds: Array.isArray(safe.authorIds)
      ? [...new Set(safe.authorIds.map((v) => String(v)).filter(Boolean))]
      : [],
    path:
      typeof safe.path === 'string'
        ? safe.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim()
        : '',
    from: parseDateBoundary(safe.from, false),
    to: parseDateBoundary(safe.to, true),
    hashes: Array.isArray(safe.hashes)
      ? [...new Set(safe.hashes.map((h) => String(h).trim()).filter(Boolean))]
      : [],
  };
}

/**
 * A file matches when it is exactly the filter path or lives underneath it.
 */
function matchesPath(filePath, filterPath) {
  if (!filterPath) return true;
  return filePath === filterPath || filePath.startsWith(`${filterPath}/`);
}

/**
 * Returns the subset of commits matching the filters.
 * `resolveCommitAuthor(commit)` returns the resolved author id of a commit.
 */
function applyFilters(commits, filters, resolveCommitAuthor) {
  const hashSet = filters.hashes.length ? new Set(filters.hashes) : null;
  const shortHashes = filters.hashes.filter((h) => h.length < 40);
  const authorSet = filters.authorIds.length ? new Set(filters.authorIds) : null;

  return commits.filter((commit) => {
    if (commit.parents.length > 1) return false;

    if (hashSet) {
      let inSelection = hashSet.has(commit.hash);
      if (!inSelection) {
        inSelection = shortHashes.some((shortHash) => commit.hash.startsWith(shortHash));
      }
      if (!inSelection) return false;
    } else {
      if (filters.from && commit.time < filters.from.getTime()) return false;
      if (filters.to && commit.time > filters.to.getTime()) return false;
    }

    if (authorSet && !authorSet.has(resolveCommitAuthor(commit))) return false;

    if (filters.path && !commit.files.some((file) => matchesPath(file.path, filters.path))) {
      return false;
    }

    return true;
  });
}

module.exports = { normalizeFilters, matchesPath, applyFilters, parseDateBoundary };
