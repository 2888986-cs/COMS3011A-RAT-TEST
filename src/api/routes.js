const express = require('express');
const multer = require('multer');
const path = require('path');
const fsp = require('fs/promises');
const { randomUUID } = require('crypto');
const { UPLOADS_DIR, REPOS_DIR } = require('../config');
const { listRepos, getRepo, updateRepo, removeRepo } = require('../storage/registry');
const { getRepoData, invalidateRepoCache } = require('../git/gitRepository');
const { createAuthorResolver } = require('../git/authorResolver');
const { ingestFromUrl, ingestFromZip } = require('../ingest/repoIngestor');
const { computeMetrics } = require('../analysis/engine');
const { walkFiles } = require('../util/fsWalk');
const { asyncHandler, badRequest, notFound } = require('../util/http');

const router = express.Router();
const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 512 * 1024 * 1024 } });

const publicRepo = (repo) => ({
  id: repo.id,
  name: repo.name,
  sourceType: repo.sourceType,
  sourceValue: repo.sourceValue,
  addedAt: repo.addedAt,
  manualMergeCount: (repo.manualMerges || []).length,
});

function mustGetRepo(id) {
  const entry = getRepo(id);
  if (!entry) throw notFound('Repository not found');
  return entry;
}

async function buildAuthorsPayload(entry, repoData) {
  const resolver = createAuthorResolver({
    commits: repoData.commits,
    mailmapEntries: repoData.mailmapEntries,
    manualMerges: entry.manualMerges || [],
  });
  return {
    authors: resolver.authors,
    mailmap: repoData.mailmapEntries,
    manualMerges: entry.manualMerges || [],
  };
}

// ---------------------------------------------------------------- repositories

router.get('/repos', (req, res) => {
  res.json({ repos: listRepos().map(publicRepo) });
});

router.post(
  '/repos/clone',
  asyncHandler(async (req, res) => {
    const { url, name } = req.body || {};
    if (!url) throw badRequest('url is required');
    const entry = await ingestFromUrl(url, name);
    res.status(201).json({ repo: publicRepo(entry) });
  })
);

router.post(
  '/repos/upload',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('ZIP file is required (multipart field "file")');
    let entry;
    try {
      entry = await ingestFromZip(req.file.path, req.file.originalname);
    } finally {
      fsp.unlink(req.file.path).catch(() => {});
    }
    res.status(201).json({ repo: publicRepo(entry) });
  })
);

router.delete(
  '/repos/:id',
  asyncHandler(async (req, res) => {
    const entry = mustGetRepo(req.params.id);
    removeRepo(entry.id);
    invalidateRepoCache(entry.id);
    // Safety: only delete directories that live inside the managed repos dir.
    if (typeof entry.dir === 'string' && entry.dir.startsWith(REPOS_DIR + path.sep)) {
      await fsp.rm(entry.dir, { recursive: true, force: true });
    }
    res.status(204).end();
  })
);

// ---------------------------------------------------------------- authors

router.get(
  '/repos/:id/authors',
  asyncHandler(async (req, res) => {
    const entry = mustGetRepo(req.params.id);
    const repoData = await getRepoData(entry);
    res.json(await buildAuthorsPayload(entry, repoData));
  })
);

router.post(
  '/repos/:id/authors/merge',
  asyncHandler(async (req, res) => {
    const entry = mustGetRepo(req.params.id);
    const { emails, name } = req.body || {};
    if (!Array.isArray(emails) || emails.length === 0) {
      throw badRequest('emails[] is required (the author emails to merge)');
    }
    const repoData = await getRepoData(entry);

    const cleaned = [...new Set(emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
    const merges = entry.manualMerges || [];
    // Pull in any existing groups that already contain one of these emails.
    const involved = merges.filter((group) => (group.emails || []).some((e) => cleaned.includes(e)));
    const allEmails = [...new Set([...cleaned, ...involved.flatMap((g) => g.emails || [])])];

    let mergeName = typeof name === 'string' && name.trim() ? name.trim() : null;
    if (!mergeName) {
      if (involved.length === 1 && involved[0].name) {
        mergeName = involved[0].name;
      } else {
        const resolver = createAuthorResolver({
          commits: repoData.commits,
          mailmapEntries: repoData.mailmapEntries,
          manualMerges: merges,
        });
        const match = resolver.authors.find((a) => a.emails.some((e) => cleaned.includes(e)));
        mergeName = (match && match.name) || cleaned[0];
      }
    }

    const next = [
      ...merges.filter((group) => !involved.includes(group)),
      { id: randomUUID(), name: mergeName, emails: allEmails, createdAt: new Date().toISOString() },
    ];
    updateRepo(entry.id, { manualMerges: next });
    res.json(await buildAuthorsPayload({ ...entry, manualMerges: next }, repoData));
  })
);

router.post(
  '/repos/:id/authors/reset-merges',
  asyncHandler(async (req, res) => {
    const entry = mustGetRepo(req.params.id);
    const repoData = await getRepoData(entry);
    updateRepo(entry.id, { manualMerges: [] });
    res.json(await buildAuthorsPayload({ ...entry, manualMerges: [] }, repoData));
  })
);

// ---------------------------------------------------------------- commits & tree

router.get(
  '/repos/:id/commits',
  asyncHandler(async (req, res) => {
    const entry = mustGetRepo(req.params.id);
    const repoData = await getRepoData(entry);
    const resolver = createAuthorResolver({
      commits: repoData.commits,
      mailmapEntries: repoData.mailmapEntries,
      manualMerges: entry.manualMerges || [],
    });
    const commits = repoData.commits.map((commit) => {
      const authorId = resolver.resolveCommit(commit);
      return {
        hash: commit.hash,
        shortHash: commit.hash.slice(0, 8),
        subject: commit.subject,
        date: commit.dateISO,
        authorId,
        authorName: resolver.authorName(authorId),
        insertions: commit.insertions,
        deletions: commit.deletions,
        fileCount: commit.fileCount,
      };
    });
    res.json({ commits, total: commits.length });
  })
);

router.get(
  '/repos/:id/tree',
  asyncHandler(async (req, res) => {
    const entry = mustGetRepo(req.params.id);
    const repoData = await getRepoData(entry);
    if (!repoData.fileList) repoData.fileList = await walkFiles(entry.dir);
    const files = repoData.fileList.map((f) => f.path);
    const dirs = [
      ...new Set(
        files.flatMap((p) => {
          const segments = p.split('/');
          const out = [];
          for (let i = 1; i < segments.length; i++) out.push(segments.slice(0, i).join('/'));
          return out;
        })
      ),
    ].sort();
    res.json({ files, dirs });
  })
);

// ---------------------------------------------------------------- metrics

router.post(
  '/repos/:id/metrics',
  asyncHandler(async (req, res) => {
    const entry = mustGetRepo(req.params.id);
    const repoData = await getRepoData(entry);
    res.json(await computeMetrics(entry, repoData, req.body || {}));
  })
);

module.exports = { router, publicRepo };
