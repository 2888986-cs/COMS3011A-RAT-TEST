const fs = require('fs');
const { REGISTRY_FILE, ensureDataDirs } = require('../config');

/**
 * Simple JSON-file backed registry of ingested repositories.
 * The registry only stores metadata; repository contents live in data/repos/<id>.
 */
function loadRegistry() {
  ensureDataDirs();
  try {
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { repos: Array.isArray(parsed.repos) ? parsed.repos : [] };
  } catch {
    return { repos: [] };
  }
}

function saveRegistry(registry) {
  ensureDataDirs();
  const tmpFile = `${REGISTRY_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(registry, null, 2));
  fs.renameSync(tmpFile, REGISTRY_FILE);
}

function listRepos() {
  return loadRegistry().repos;
}

function getRepo(id) {
  return loadRegistry().repos.find((repo) => repo.id === id) || null;
}

function addRepo(repo) {
  const registry = loadRegistry();
  registry.repos.push(repo);
  saveRegistry(registry);
  return repo;
}

function updateRepo(id, patch) {
  const registry = loadRegistry();
  const repo = registry.repos.find((r) => r.id === id);
  if (!repo) return null;
  Object.assign(repo, patch);
  saveRegistry(registry);
  return repo;
}

function removeRepo(id) {
  const registry = loadRegistry();
  const index = registry.repos.findIndex((r) => r.id === id);
  if (index === -1) return null;
  const [removed] = registry.repos.splice(index, 1);
  saveRegistry(registry);
  return removed;
}

module.exports = { loadRegistry, saveRegistry, listRepos, getRepo, addRepo, updateRepo, removeRepo };
