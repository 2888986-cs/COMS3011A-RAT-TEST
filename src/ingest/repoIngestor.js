const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const AdmZip = require('adm-zip');
const { simpleGit } = require('simple-git');
const { REPOS_DIR } = require('../config');
const { addRepo } = require('../storage/registry');
const { invalidateRepoCache } = require('../git/gitRepository');
const { badRequest } = require('../util/http');

function deriveName(value, fallback = 'repository') {
  if (!value) return fallback;
  const cleaned = String(value).replace(/[\\/]+$/, '');
  const base = path.basename(cleaned).replace(/\.git$/i, '').replace(/\.zip$/i, '');
  return base || fallback;
}

/**
 * Searches the extracted tree (up to 3 levels deep) for a .git directory
 * or a .git file pointing at an external git directory.
 */
function findGitRoot(rootDir) {
  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    const dotGit = path.join(dir, '.git');

    let stat = null;
    try {
      stat = fs.statSync(dotGit);
    } catch {
      // keep searching
    }

    if (stat) {
      if (stat.isDirectory()) {
        return { root: dir, externalGitDir: null };
      }
      const content = fs.readFileSync(dotGit, 'utf8');
      const match = content.match(/^gitdir:\s*(.+)$/m);
      if (match) {
        let gitDir = match[1].trim();
        if (!path.isAbsolute(gitDir)) gitDir = path.resolve(dir, gitDir);
        if (fs.existsSync(gitDir)) {
          return { root: dir, externalGitDir: gitDir };
        }
        throw badRequest(
          'The .git file points to an external git directory that is not inside the ZIP. ' +
            'Re-export the repository including its real .git directory.'
        );
      }
      throw badRequest('Unsupported .git file format.');
    }

    if (depth < 3) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== '.git') {
          queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        }
      }
    }
  }
  return null;
}

/**
 * Ensures the working tree matches HEAD (some ZIP exports only contain .git).
 */
async function materializeWorkingTree(root, externalGitDir) {
  const git = externalGitDir
    ? simpleGit(root).env({ GIT_DIR: externalGitDir, GIT_WORK_TREE: root })
    : simpleGit(root);
  try {
    await git.raw(['checkout', '-f', 'HEAD']);
  } catch {
    // Empty repository (unborn HEAD) - nothing to check out.
  }
}

async function ingestFromZip(zipPath, originalName) {
  const id = randomUUID();
  const dir = path.join(REPOS_DIR, id);
  await fsp.mkdir(dir, { recursive: true });

  try {
    new AdmZip(zipPath).extractAllTo(dir, true);
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw badRequest(`Could not extract the ZIP archive: ${err.message}`);
  }

  const found = findGitRoot(dir);
  if (!found) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw badRequest('No .git directory or .git file was found in the ZIP (searched up to 3 levels deep).');
  }

  await materializeWorkingTree(found.root, found.externalGitDir);

  const entry = {
    id,
    name: deriveName(originalName),
    sourceType: 'zip',
    sourceValue: String(originalName || 'upload.zip'),
    dir: found.root,
    gitDir: found.externalGitDir,
    addedAt: new Date().toISOString(),
    manualMerges: [],
  };
  addRepo(entry);
  invalidateRepoCache(id);
  return entry;
}

async function ingestFromUrl(url, name) {
  const trimmed = String(url || '').trim();
  if (!/^(https?:\/\/|ssh:\/\/|git@|\/|file:\/\/|\.\/|\.\.\/)/.test(trimmed)) {
    throw badRequest('Provide a valid git clone URL (https://, ssh://, git@...) or an absolute local path.');
  }

  const id = randomUUID();
  const dir = path.join(REPOS_DIR, id);
  try {
    // Full ("deep") clone - the complete history is required for metrics.
    await simpleGit().clone(trimmed, dir, ['--quiet']);
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw badRequest(`Clone failed: ${err.message}`);
  }

  const entry = {
    id,
    name: name && String(name).trim() ? String(name).trim() : deriveName(trimmed),
    sourceType: 'url',
    sourceValue: trimmed,
    dir,
    gitDir: null,
    addedAt: new Date().toISOString(),
    manualMerges: [],
  };
  addRepo(entry);
  invalidateRepoCache(id);
  return entry;
}

module.exports = { ingestFromZip, ingestFromUrl, deriveName };
