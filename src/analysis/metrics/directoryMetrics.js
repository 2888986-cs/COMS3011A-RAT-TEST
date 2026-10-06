/**
 * Directory Metrics - directory-level roll-ups over the filtered commit set.
 *
 * A commit is counted once per directory even if it touches several files in
 * that directory (hash sets deduplicate). Every ancestor directory of a
 * changed file receives the churn of that file, so deep directories reflect
 * the full subtree activity. LOC sums the current LOC of the files touched in
 * the selection (unknown LOC for deleted files is skipped). Binary files are
 * excluded from all directory roll-ups. A synthetic root entry (path '')
 * aggregates the activity of the whole filtered set.
 */
const { matchesPath } = require('../filters');

function computeDirectoryMetrics(commits, filters, resolver, locByPath) {
  const dirs = new Map();
  const totalCommits = commits.length;
  const rootDir = {
    path: '',
    commitHashes: new Set(),
    files: new Set(),
    insertions: 0,
    deletions: 0,
    authors: new Set(),
  };

  for (const commit of commits) {
    const authorId = resolver.resolveCommit(commit);
    for (const file of commit.files) {
      if (file.binary) continue;
      if (!matchesPath(file.path, filters.path)) continue;

      rootDir.commitHashes.add(commit.hash);
      rootDir.files.add(file.path);
      rootDir.insertions += file.insertions;
      rootDir.deletions += file.deletions;
      rootDir.authors.add(authorId);

      const segments = file.path.split('/');
      for (let i = 1; i < segments.length; i++) {
        const dirPath = segments.slice(0, i).join('/');
        let dir = dirs.get(dirPath);
        if (!dir) {
          dir = {
            path: dirPath,
            commitHashes: new Set(),
            files: new Set(),
            insertions: 0,
            deletions: 0,
            authors: new Set(),
          };
          dirs.set(dirPath, dir);
        }
        dir.commitHashes.add(commit.hash);
        dir.files.add(file.path);
        dir.insertions += file.insertions;
        dir.deletions += file.deletions;
        dir.authors.add(authorId);
      }
    }
  }

  const directories = [rootDir, ...dirs.values()]
    .map((dir) => {
      let loc = 0;
      let locKnown = 0;
      for (const filePath of dir.files) {
        const value = locByPath.get(filePath);
        if (typeof value === 'number') {
          loc += value;
          locKnown++;
        }
      }
      return {
        path: dir.path,
        fileCount: dir.files.size,
        commitCount: dir.commitHashes.size,
        insertions: dir.insertions,
        deletions: dir.deletions,
        churn: dir.insertions + dir.deletions,
        growth: dir.insertions - dir.deletions,
        authorCount: dir.authors.size,
        loc,
        locKnown,
        modificationFrequency:
          totalCommits > 0 ? +(dir.commitHashes.size / totalCommits).toFixed(4) : 0,
        churnRate:
          totalCommits > 0 ? +((dir.insertions + dir.deletions) / totalCommits).toFixed(4) : 0,
      };
    })
    .sort(
      (a, b) =>
        b.commitCount - a.commitCount || b.churn - a.churn || a.path.localeCompare(b.path)
    );

  return { directoryCount: directories.length, directories };
}

module.exports = { computeDirectoryMetrics };
