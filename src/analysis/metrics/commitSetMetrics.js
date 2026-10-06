/**
 * Commit Set Metrics - aggregates over the filtered commit set.
 * `commits` must be sorted newest-first (git log order).
 */
function computeCommitSetMetrics(commits, resolver) {
  const authorAgg = new Map();
  const dayAgg = new Map();
  const fileSet = new Set();

  let insertions = 0;
  let deletions = 0;
  let mergeCommits = 0;
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
    if (commit.parents.length > 1) mergeCommits++;
    totalFilesTouched += commit.fileCount;

    for (const file of commit.files) fileSet.add(file.path);

    const day = (commit.dateISO || '').slice(0, 10);
    if (day) dayAgg.set(day, (dayAgg.get(day) || 0) + 1);
  }

  const authors = [...authorAgg.values()].sort((a, b) => b.commitCount - a.commitCount);
  const commitsByDay = [...dayAgg.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const newest = commits[0] || null;
  const oldest = commits[commits.length - 1] || null;

  return {
    commitCount: commits.length,
    authorCount: authors.length,
    authors,
    totalInsertions: insertions,
    totalDeletions: deletions,
    netChange: insertions - deletions,
    filesTouched: fileSet.size,
    avgFilesPerCommit:
      commits.length > 0 ? Math.round((totalFilesTouched / commits.length) * 100) / 100 : 0,
    mergeCommits,
    firstCommit: oldest ? { hash: oldest.hash, date: oldest.dateISO, subject: oldest.subject } : null,
    lastCommit: newest ? { hash: newest.hash, date: newest.dateISO, subject: newest.subject } : null,
    commitsByDay,
  };
}

module.exports = { computeCommitSetMetrics };
