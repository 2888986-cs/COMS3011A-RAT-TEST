/**
 * File Metrics - per-file aggregates over the filtered commit set, restricted
 * to files under the path filter. Current LOC is read from the working tree
 * (cached per repository); files deleted from the working tree show null LOC.
 */
const fsp = require('fs/promises');
const path = require('path');
const { countLines, isProbablyBinary } = require('../../util/fsWalk');
const { matchesPath } = require('../filters');

const LOC_CONCURRENCY = 32;

async function attachCurrentLoc(files, repoData) {
  const { locCache } = repoData;
  const queue = [...files];

  async function worker() {
    while (queue.length) {
      const file = queue.shift();
      if (locCache.has(file.path)) {
        file.loc = locCache.get(file.path);
        continue;
      }
      let loc = null;
      try {
        const buffer = await fsp.readFile(path.join(repoData.entry.dir, file.path));
        if (!isProbablyBinary(buffer)) loc = countLines(buffer.toString('utf8'));
      } catch {
        // Deleted or unreadable - keep null.
      }
      locCache.set(file.path, loc);
      file.loc = loc;
    }
  }

  await Promise.all(Array.from({ length: Math.min(LOC_CONCURRENCY, files.length) }, worker));
}

async function computeFileMetrics(commits, filters, repoData, resolver) {
  const map = new Map();

  for (const commit of commits) {
    const authorId = resolver.resolveCommit(commit);
    for (const file of commit.files) {
      if (file.binary) continue;
      if (!matchesPath(file.path, filters.path)) continue;

      let entry = map.get(file.path);
      if (!entry) {
        entry = {
          path: file.path,
          commits: 0,
          insertions: 0,
          deletions: 0,
          authors: new Set(),
          firstTime: commit.time,
          lastTime: commit.time,
          firstDate: commit.dateISO,
          lastDate: commit.dateISO,
        };
        map.set(file.path, entry);
      }
      entry.commits++;
      entry.insertions += file.insertions;
      entry.deletions += file.deletions;
      entry.authors.add(authorId);
      if (commit.time < entry.firstTime) {
        entry.firstTime = commit.time;
        entry.firstDate = commit.dateISO;
      }
      if (commit.time > entry.lastTime) {
        entry.lastTime = commit.time;
        entry.lastDate = commit.dateISO;
      }
    }
  }

  const files = [...map.values()];
  await attachCurrentLoc(files, repoData);
  files.sort(
    (a, b) =>
      b.commits - a.commits ||
      (b.insertions + b.deletions) - (a.insertions + a.deletions) ||
      a.path.localeCompare(b.path)
  );

  let totalInsertions = 0;
  let totalDeletions = 0;
  let totalLoc = 0;
  let locKnown = 0;

  const output = files.map((file) => {
    totalInsertions += file.insertions;
    totalDeletions += file.deletions;
    const hasLoc = typeof file.loc === 'number';
    if (hasLoc) {
      totalLoc += file.loc;
      locKnown++;
    }
    return {
      path: file.path,
      commits: file.commits,
      insertions: file.insertions,
      deletions: file.deletions,
      churn: file.insertions + file.deletions,
      growth: file.insertions - file.deletions,
      modificationFrequency: commits.length > 0 ? +(file.commits / commits.length).toFixed(4) : 0,
      churnRate: commits.length > 0 ? +((file.insertions + file.deletions) / commits.length).toFixed(4) : 0,
      authorCount: file.authors.size,
      currentLoc: hasLoc ? file.loc : null,
      firstDate: file.firstDate,
      lastDate: file.lastDate,
    };
  });

  return {
    fileCount: output.length,
    totalInsertions,
    totalDeletions,
    totalChurn: totalInsertions + totalDeletions,
    totalLoc,
    locKnown,
    files: output,
  };
}

module.exports = { computeFileMetrics };
