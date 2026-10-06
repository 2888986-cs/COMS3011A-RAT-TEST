/**
 * Analysis engine - orchestrates author resolution, commit filtering and the
 * four metric categories (repository, commit set, file, directory).
 */
const { normalizeFilters, applyFilters } = require('./filters');
const { createAuthorResolver } = require('../git/authorResolver');
const { computeRepositoryMetrics } = require('./metrics/repositoryMetrics');
const { computeCommitSetMetrics } = require('./metrics/commitSetMetrics');
const { computeFileMetrics } = require('./metrics/fileMetrics');
const { computeDirectoryMetrics } = require('./metrics/directoryMetrics');

/**
 * @param {object} entry    fresh registry entry (manual merges included)
 * @param {object} repoData cached repository data (commits, mailmap, git)
 * @param {object} filtersInput raw filter payload from the dashboard
 */
async function computeMetrics(entry, repoData, filtersInput) {
  const filters = normalizeFilters(filtersInput);
  const resolver = createAuthorResolver({
    commits: repoData.commits,
    mailmapEntries: repoData.mailmapEntries,
    manualMerges: entry.manualMerges || [],
  });

  const filteredCommits = applyFilters(repoData.commits, filters, resolver.resolveCommit);

  const files = await computeFileMetrics(filteredCommits, filters, repoData, resolver);
  const locByPath = new Map(files.files.map((file) => [file.path, file.currentLoc]));

  const commitSet = computeCommitSetMetrics(filteredCommits, resolver);
  const directories = computeDirectoryMetrics(filteredCommits, filters, resolver, locByPath);
  const repository = await computeRepositoryMetrics(entry, repoData, resolver);

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      authorIds: filters.authorIds,
      path: filters.path,
      from: filters.from ? filters.from.toISOString() : null,
      to: filters.to ? filters.to.toISOString() : null,
      manualCommitSelection: filters.hashes.length > 0,
      hashes: filters.hashes,
      matchedCommits: filteredCommits.length,
    },
    repository,
    commitSet,
    files,
    directories,
  };
}

module.exports = { computeMetrics };
