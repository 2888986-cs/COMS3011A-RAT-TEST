const NUMSTAT_RE = /^(\d+|-)\t(\d+|-)\t(.*)$/;

const META_FORMAT = '%x1E%H%x1F%an%x1F%ae%x1F%cI%x1F%P%x1F%s';
const NUMSTAT_FORMAT = '%x1E%H';

/**
 * Parses a numstat path column that may carry rename notation.
 *
 * With rename detection enabled git prints renamed paths either as
 * `old => new` or with brace shorthand such as `prefix/{old => new}/suffix`
 * (possibly with several brace groups). Plain paths come back untouched with
 * a null oldPath; renamed paths return both the previous and current path.
 */
function parseRenamePath(raw) {
  if (!raw.includes(' => ')) {
    return { path: raw, oldPath: null };
  }
  if (/\{[^{}]* => [^{}]*\}/.test(raw)) {
    const braceRe = /\{([^{}]*) => ([^{}]*)\}/g;
    return {
      path: raw.replace(braceRe, '$2'),
      oldPath: raw.replace(braceRe, '$1'),
    };
  }
  const sep = raw.indexOf(' => ');
  return { path: raw.slice(sep + 4), oldPath: raw.slice(0, sep) };
}

/**
 * Loads the full commit history of a repository.
 *
 * Two passes are used for robust parsing:
 *  1. metadata pass  - hash, author name/email, committer date, parents, subject
 *  2. numstat pass   - per-commit file change statistics
 * Records are delimited with \x1E and fields with \x1F.
 *
 * Returns commits newest-first with:
 *   { hash, authorName, authorEmail, dateISO, date, time, parents, subject,
 *     insertions, deletions, files: [{ path, oldPath, insertions, deletions, binary }], fileCount }
 */
async function loadCommits(git) {
  let metaOutput = '';
  try {
    metaOutput = await git.raw(['log', `--pretty=format:${META_FORMAT}`]);
  } catch (err) {
    // An empty repository has no commits yet; treat it as an empty history.
    if (/does not have any commits|bad default revision|unknown revision/i.test(String(err.message))) {
      return [];
    }
    throw err;
  }

  const commits = [];
  const byHash = new Map();

  for (const chunk of metaOutput.split('\x1E')) {
    const text = chunk.replace(/^\n+/, '');
    if (!text) continue;
    const headerLine = text.split('\n')[0];
    const [hash, authorName, authorEmail, dateISO, parentsRaw, subject] = headerLine.split('\x1F');
    if (!hash) continue;
    const date = new Date(dateISO);
    const commit = {
      hash,
      authorName: authorName || '',
      authorEmail: (authorEmail || '').toLowerCase(),
      dateISO,
      date,
      time: Number.isNaN(date.getTime()) ? 0 : date.getTime(),
      parents: parentsRaw ? parentsRaw.split(' ').filter(Boolean) : [],
      subject: subject || '',
      insertions: 0,
      deletions: 0,
      files: [],
      fileCount: 0,
    };
    commits.push(commit);
    byHash.set(hash, commit);
  }

  if (commits.length === 0) return commits;

  let statsOutput = '';
  try {
    statsOutput = await git.raw(['log', '--numstat', '-M50%', `--pretty=format:${NUMSTAT_FORMAT}`]);
  } catch {
    // Stats are optional; metadata already captured.
    return commits;
  }

  for (const chunk of statsOutput.split('\x1E')) {
    if (!chunk.trim()) continue;
    const lines = chunk.split('\n');
    const hash = lines[0].trim();
    const commit = byHash.get(hash);
    if (!commit) continue;
    for (let i = 1; i < lines.length; i++) {
      const match = lines[i].match(NUMSTAT_RE);
      if (!match) continue;
      const insertions = match[1] === '-' ? 0 : parseInt(match[1], 10);
      const deletions = match[2] === '-' ? 0 : parseInt(match[2], 10);
      const binary = match[1] === '-' && match[2] === '-';
      const { path, oldPath } = parseRenamePath(match[3]);
      commit.files.push({ path, oldPath, insertions, deletions, binary });
      if (!binary) {
        commit.insertions += insertions;
        commit.deletions += deletions;
      }
    }
    commit.fileCount = commit.files.length;
  }

  return commits;
}

module.exports = { loadCommits };
