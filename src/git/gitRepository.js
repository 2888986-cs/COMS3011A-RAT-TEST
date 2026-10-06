const { simpleGit } = require('simple-git');
const { loadCommits } = require('./commitStore');
const { loadMailmap } = require('./mailmap');

/**
 * In-memory cache of parsed repository data, keyed by repository id.
 * Loading commits from a large history is expensive, so it happens once per
 * repository per server run. Manual merges are NOT baked in here - they are
 * applied per request from the freshest registry entry.
 */
const cache = new Map();

function createGitClient(entry) {
  const git = simpleGit(entry.dir);
  // A .git *file* (e.g. re-zipped worktrees) points at an external git dir.
  if (entry.gitDir) {
    return git.env({ GIT_DIR: entry.gitDir, GIT_WORK_TREE: entry.dir });
  }
  return git;
}

async function getRepoData(entry) {
  const cached = cache.get(entry.id);
  if (cached) return cached;

  const promise = (async () => {
    const git = createGitClient(entry);
    const commits = await loadCommits(git);

    let defaultBranch = null;
    try {
      defaultBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
      if (defaultBranch === 'HEAD') defaultBranch = null; // detached HEAD
    } catch {
      // Empty repository - no branch yet.
    }

    const mailmapEntries = loadMailmap(entry.dir);
    return {
      entry,
      git,
      commits,
      mailmapEntries,
      defaultBranch,
      locCache: new Map(), // path -> line count (or null when unreadable/binary)
      fsStats: null, // lazily computed working-tree scan
      fileList: null, // lazily computed file list for the path filter
    };
  })();

  cache.set(entry.id, promise);
  try {
    return await promise;
  } catch (err) {
    cache.delete(entry.id);
    throw err;
  }
}

function invalidateRepoCache(id) {
  cache.delete(id);
}

module.exports = { getRepoData, invalidateRepoCache, createGitClient };
