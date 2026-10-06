/**
 * Repository Metrics - whole-history facts about the repository itself.
 * These are intentionally NOT affected by the dashboard filters: they
 * describe the repository as a whole plus its current working tree.
 */
const fsp = require('fs/promises');
const path = require('path');
const { walkFiles, countLines, isProbablyBinary } = require('../../util/fsWalk');

const EXT_BATCH = 64;

/**
 * Scans the working tree once: file count, total LOC, per-extension stats.
 */
async function scanWorkingTree(root) {
  const files = await walkFiles(root);
  const queue = [...files];

  async function worker() {
    while (queue.length) {
      const file = queue.shift();
      let loc = null;
      try {
        const buffer = await fsp.readFile(path.join(root, file.path));
        if (!isProbablyBinary(buffer)) loc = countLines(buffer.toString('utf8'));
      } catch {
        // Unreadable files (permissions, broken symlinks) are skipped.
      }
      file.loc = loc;
    }
  }
  await Promise.all(Array.from({ length: Math.min(EXT_BATCH, files.length) }, worker));

  const byExtension = new Map();
  let totalLoc = 0;
  let locKnown = 0;
  for (const file of files) {
    const extMatch = path.posix.basename(file.path).match(/(\.[a-z0-9]+)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : '(no extension)';
    let bucket = byExtension.get(ext);
    if (!bucket) {
      bucket = { extension: ext, files: 0, loc: 0 };
      byExtension.set(ext, bucket);
    }
    bucket.files++;
    if (typeof file.loc === 'number') {
      bucket.loc += file.loc;
      totalLoc += file.loc;
      locKnown++;
    }
  }

  const languages = [...byExtension.values()].sort((a, b) => b.loc - a.loc || b.files - a.files);

  return { fileCount: files.length, totalLoc, locKnown, byExtension: languages };
}

async function computeRepositoryMetrics(entry, repoData, resolver) {
  if (!repoData.fsStats) {
    repoData.fsStats = await scanWorkingTree(entry.dir);
  }
  const commits = repoData.commits;
  const newest = commits[0] || null;
  const oldest = commits[commits.length - 1] || null;

  let totalInsertions = 0;
  let totalDeletions = 0;
  for (const commit of commits) {
    totalInsertions += commit.insertions;
    totalDeletions += commit.deletions;
  }

  return {
    name: entry.name,
    sourceType: entry.sourceType,
    sourceValue: entry.sourceValue,
    addedAt: entry.addedAt,
    defaultBranch: repoData.defaultBranch,
    totalCommits: commits.length,
    totalAuthors: resolver.authors.length,
    firstCommit: oldest ? { hash: oldest.hash, date: oldest.dateISO, subject: oldest.subject } : null,
    lastCommit: newest ? { hash: newest.hash, date: newest.dateISO, subject: newest.subject } : null,
    ageDays: oldest && newest ? Math.max(0, Math.round((newest.time - oldest.time) / 86400000)) : 0,
    totalInsertions,
    totalDeletions,
    workingTree: repoData.fsStats,
  };
}

module.exports = { computeRepositoryMetrics, scanWorkingTree };
