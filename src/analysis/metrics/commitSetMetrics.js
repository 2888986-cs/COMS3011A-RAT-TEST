/**
 * Commit Set Metrics - aggregates over the filtered commit set.
 * `commits` must be sorted newest-first (git log order).
 */
function computeCommitSetMetrics(commits, resolver) {
  const authorAgg = new Map();
  const dayAgg = new Map();
  const fileSet = new Set();
  const authorFileMap = new Map(); // authorId -> (filePath -> { modifications, churn })
  const fileTotalChurn = new Map(); // filePath -> total churn across all authors (ownership denominator)

  let insertions = 0;
  let deletions = 0;
  let totalFilesTouched = 0;

  for (const commit of commits) {
    const authorId = resolver.resolveCommit(commit);
    let bucket = authorAgg.get(authorId);
    if (!bucket) {
      bucket = { id: authorId, name: resolver.authorName(authorId), commitCount: 0 };
      authorAgg.set(authorId, bucket);
    }
    bucket.commitCount++;

    insertions += commit.insertions;
    deletions += commit.deletions;

    for (const file of commit.files) {
      if (file.binary) continue;
      totalFilesTouched++;
      fileSet.add(file.path);

      const churn = file.insertions + file.deletions;
      let fileMap = authorFileMap.get(authorId);
      if (!fileMap) {
        fileMap = new Map();
        authorFileMap.set(authorId, fileMap);
      }
      let stats = fileMap.get(file.path);
      if (!stats) {
        stats = { modifications: 0, churn: 0 };
        fileMap.set(file.path, stats);
      }
      if (churn > 0) stats.modifications++;
      stats.churn += churn;
      fileTotalChurn.set(file.path, (fileTotalChurn.get(file.path) || 0) + churn);
    }

    const day = (commit.dateISO || '').slice(0, 10);
    if (day) dayAgg.set(day, (dayAgg.get(day) || 0) + 1);
  }

  const authors = [...authorAgg.values()].sort((a, b) => b.commitCount - a.commitCount);
  const commitsByDay = [...dayAgg.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const authorFileMetrics = [];
  for (const [authorId, fileMap] of authorFileMap) {
    const files = [];
    for (const [filePath, stats] of fileMap) {
      const totalChurn = fileTotalChurn.get(filePath) || 0;
      files.push({
        path: filePath,
        modifications: stats.modifications,
        churn: stats.churn,
        ownership: totalChurn > 0 ? +(stats.churn / totalChurn).toFixed(4) : 0,
      });
    }
    files.sort((a, b) => b.churn - a.churn || a.path.localeCompare(b.path));
    authorFileMetrics.push({
      authorId,
      authorName: resolver.authorName(authorId),
      totalModifications: files.reduce((s, f) => s + f.modifications, 0),
      totalChurn: files.reduce((s, f) => s + f.churn, 0),
      files,
    });
  }
  authorFileMetrics.sort((a, b) => b.totalChurn - a.totalChurn);

  const newest = commits[0] || null;
  const oldest = commits[commits.length - 1] || null;

  return {
    commitCount: commits.length,
    authorCount: authors.length,
    authors,
    totalInsertions: insertions,
    totalDeletions: deletions,
    totalChurn: insertions + deletions,
    netChange: insertions - deletions,
    filesTouched: fileSet.size,
    avgFilesPerCommit:
      commits.length > 0 ? Math.round((totalFilesTouched / commits.length) * 100) / 100 : 0,
    firstCommit: oldest ? { hash: oldest.hash, date: oldest.dateISO, subject: oldest.subject } : null,
    lastCommit: newest ? { hash: newest.hash, date: newest.dateISO, subject: newest.subject } : null,
    commitsByDay,
    authorFileMetrics,
  };
}

module.exports = { computeCommitSetMetrics };
