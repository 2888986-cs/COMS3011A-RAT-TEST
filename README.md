# COMS3011A — Repository Analysis Tool (RAT)

A web dashboard that measures metrics of one or more Git repositories. Repositories can be
added as **ZIP uploads** (with their `.git` directory) or **deep-cloned from a URL**, and all
metrics can be filtered by **repository, author, file/directory, and commit sets** (a period of
time, or a manually selected list of commits). Author identities are merged automatically via
`.mailmap` when present, or manually through the UI.

## Features

- **Repository upload** — ZIP archive (must contain `.git`) or remote clone URL (full history)
- **Multiple repository support** — each ingested repository is analysed independently
- **Author merging**
  - automatic `.mailmap` resolution (parsed from the repository root)
  - manual merging of authors in the dashboard (useful when no `.mailmap` exists)
- **Metric categories**
  - **Repository metrics** — all-time commits/authors/churn, age, branch, working-tree LOC and language breakdown
  - **Commit set metrics** — commits, authors, files touched, insertions/deletions, merge commits, commits-per-author and commits-over-time charts
  - **File metrics** — per-file commits, churn, contributors, current LOC, first/last change
  - **Directory metrics** — directory roll-ups (files, deduplicated commits, churn, contributors, LOC)
- **Filtering** — by author(s), file or directory (path prefix), date range, or a hand-picked commit list

## Quick start

```bash
npm install
npm start            # http://localhost:3000
npm run dev          # same, with file watching (node --watch)
```

Requirements: Node.js >= 18 and `git` on the PATH.

## Using the dashboard

1. Click **+ Add** in the sidebar.
   - **Clone URL** tab: paste a git URL (https, ssh, git@) or a local path — a *deep* clone
     (full history) is performed.
   - **Upload ZIP** tab: upload a `.zip` containing the repository **including its `.git`
     directory**. The archive is extracted, the `.git` root is located (up to 3 levels deep),
     and the working tree is restored with `git checkout -f HEAD`.
2. Select a repository in the sidebar.
3. Use the filter bar:
   - **Authors** — multi-select from resolved identities
   - **File / directory** — type a path with autocomplete (`src/` or `src/app.js`)
   - **From / To** — limit to a date range
   - **Select commits…** — pick commits manually; this *replaces* the date range
4. Explore the four metric cards; they refresh automatically as filters change.
5. The **Authors** tab shows raw git identities, `.mailmap` entries, and manual merge groups.
   Select two or more authors and merge them (the merge unions their email addresses).

## Architecture

```
server.js                  entry point (Express app on PORT, default 3000)
src/
  app.js                   express app wiring (json, static, api router, error handler)
  config.js                paths (data dir), port, constants
  storage/registry.js      JSON-file registry of ingested repositories
  ingest/repoIngestor.js   ZIP extraction / deep clone, .git detection, working-tree restore
  git/
    commitStore.js         parses `git log` (metadata pass + numstat pass) into commit objects
    mailmap.js             .mailmap parser (all 4 gitmailmap line formats)
    authorResolver.js      identity resolution: mailmap -> manual merges -> stable author ids
    gitRepository.js       per-repository cache of parsed history, mailmap, branch, LOC cache
  analysis/
    engine.js              orchestrates resolver + filters + the four metric modules
    filters.js             filter normalisation and commit-set filtering (incl. path matching)
    metrics/               repositoryMetrics, commitSetMetrics, fileMetrics, directoryMetrics
  api/routes.js            REST endpoints
  util/                    fs walking + LOC helpers, HTTP error helpers
public/                    dashboard (vanilla HTML/CSS/JS, no build step)
data/                      runtime data (gitignored): registry.json + repos/<id>/ + uploads/
```

Design notes:

- Every metric category is an independent module consuming the same filtered commit set, so
  filters behave consistently across all four categories (repository metrics are documented as
  whole-history and labelled "not filtered" in the UI).
- Manual merges are stored per repository in the registry and applied at request time — merging
  never requires re-reading git history.
- Complexities beyond MVP scope (e.g. rename detection, truncated binary paths, per-language
  parsers) are deliberately simplified; renames currently count as delete+add (`--no-renames`).

## API reference

| Method | Path | Description |
|---|---|---|
| GET | `/api/repos` | List ingested repositories |
| POST | `/api/repos/clone` | `{ url, name? }` — deep clone and register |
| POST | `/api/repos/upload` | multipart `file` (ZIP) — extract and register |
| DELETE | `/api/repos/:id` | Remove a repository and its local copy |
| GET | `/api/repos/:id/authors` | Resolved authors, mailmap entries, manual merges |
| POST | `/api/repos/:id/authors/merge` | `{ emails: [], name? }` — create a manual merge group |
| POST | `/api/repos/:id/authors/reset-merges` | Remove all manual merge groups |
| GET | `/api/repos/:id/commits` | Full commit list (hash, subject, author, stats) |
| GET | `/api/repos/:id/tree` | Files and directories (for the path filter) |
| POST | `/api/repos/:id/metrics` | `{ authorIds?, path?, from?, to?, hashes? }` — all four metric categories |

## Data storage

All runtime state lives under `data/` (gitignored):

- `data/registry.json` — repository registry (metadata + manual merge groups)
- `data/repos/<id>/` — cloned/extracted repository contents
- `data/uploads/` — temporary ZIP upload staging (files are deleted after ingestion)

Set `RAT_DATA_DIR` to relocate, or `PORT` to change the port.

## Roadmap (post-MVP polish)

- Pagination / virtual scrolling for very large commit lists and file tables
- Rename detection (`--find-renames`) for more accurate churn
- Optional authentication for remote clones; clone progress reporting
- Chart library for richer visualisations; export to CSV/JSON
- Unit tests with small fixture repositories
