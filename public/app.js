/* RAT dashboard - vanilla JS frontend. */
'use strict';

const state = {
  repos: [],
  currentRepoId: null,
  authors: [],
  mailmap: [],
  manualMerges: [],
  commits: [],
  tree: { files: [], dirs: [] },
  filters: { authorIds: [], path: '', from: '', to: '', hashes: [] },
  picker: { selected: new Set(), search: '' },
  mergeSelection: new Set(),
  metrics: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));

const fmtInt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');
const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};
const fmtDay = (iso) => (iso ? String(iso).slice(0, 10) : '—');

async function api(url, options = {}) {
  const opts = { ...options };
  if (opts.body && !(opts.body instanceof FormData) && !opts.headers) {
    opts.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(url, opts);
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

/* ---------------------------------------------------------------- modals */

function openModal(id) { $(`#${id}`).hidden = false; }
function closeModal(id) { $(`#${id}`).hidden = true; }

$$('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
});
$$('.modal-backdrop').forEach((backdrop) => {
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.hidden = true;
  });
});

/* ---------------------------------------------------------------- repo list */

function renderRepoList() {
  const list = $('#repo-list');
  list.innerHTML = state.repos.map((repo) => `
    <li class="repo-item ${repo.id === state.currentRepoId ? 'active' : ''}" data-repo-id="${escapeHtml(repo.id)}">
      <div>
        <div class="name">${escapeHtml(repo.name)}</div>
        <div class="meta">${repo.sourceType === 'zip' ? 'ZIP upload' : 'clone URL'}</div>
      </div>
      <button class="delete-btn" data-delete-repo="${escapeHtml(repo.id)}" title="Delete repository">✕</button>
    </li>
  `).join('');
  $('#repo-list-empty').hidden = state.repos.length > 0;
  $('#topbar-meta').textContent = state.repos.length
    ? `${state.repos.length} repositor${state.repos.length === 1 ? 'y' : 'ies'}`
    : '';
}

async function loadRepos() {
  const data = await api('/api/repos');
  state.repos = data.repos || [];
  renderRepoList();
}

$('#repo-list').addEventListener('click', async (e) => {
  const deleteBtn = e.target.closest('[data-delete-repo]');
  if (deleteBtn) {
    const id = deleteBtn.dataset.deleteRepo;
    const repo = state.repos.find((r) => r.id === id);
    if (!repo) return;
    if (!window.confirm(`Delete repository "${repo.name}"? This removes the local copy.`)) return;
    await api(`/api/repos/${id}`, { method: 'DELETE' });
    if (state.currentRepoId === id) {
      state.currentRepoId = null;
      $('#repo-view').hidden = true;
      $('#placeholder').hidden = false;
    }
    await loadRepos();
    return;
  }
  const item = e.target.closest('[data-repo-id]');
  if (item && item.dataset.repoId !== state.currentRepoId) {
    selectRepo(item.dataset.repoId).catch(showGlobalError);
  }
});

/* ---------------------------------------------------------------- add repo modal */

$('#add-repo-btn').addEventListener('click', () => {
  $('#add-repo-status').textContent = '';
  $('#add-repo-status').className = 'status';
  openModal('add-repo-modal');
});

$$('.modal-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.modal-tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('#clone-form').hidden = tab.dataset.addtab !== 'url';
    $('#zip-form').hidden = tab.dataset.addtab !== 'zip';
  });
});

function setAddStatus(message, kind = '') {
  const el = $('#add-repo-status');
  el.textContent = message;
  el.className = `status ${kind}`;
}

async function afterRepoAdded(repo) {
  closeModal('add-repo-modal');
  await loadRepos();
  await selectRepo(repo.id);
}

$('#clone-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('#clone-url').value.trim();
  const name = $('#clone-name').value.trim();
  if (!url) return;
  setAddStatus('Cloning (deep clone, this may take a while)…');
  try {
    const data = await api('/api/repos/clone', { method: 'POST', body: JSON.stringify({ url, name }) });
    $('#clone-form').reset();
    setAddStatus('Clone complete.', 'success');
    await afterRepoAdded(data.repo);
  } catch (err) {
    setAddStatus(err.message, 'error');
  }
});

$('#zip-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = $('#zip-file');
  if (!fileInput.files.length) return;
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  setAddStatus('Uploading and extracting…');
  try {
    const data = await api('/api/repos/upload', { method: 'POST', body: formData });
    $('#zip-form').reset();
    setAddStatus('Upload complete.', 'success');
    await afterRepoAdded(data.repo);
  } catch (err) {
    setAddStatus(err.message, 'error');
  }
});

function showGlobalError(err) {
  console.error(err);
  const el = $('#metrics-status');
  if (el) {
    el.textContent = `Error: ${err.message}`;
    el.style.color = 'var(--danger)';
  }
}

/* ---------------------------------------------------------------- repo selection */

async function selectRepo(id) {
  state.currentRepoId = id;
  state.filters = { authorIds: [], path: '', from: '', to: '', hashes: [] };
  state.mergeSelection = new Set();
  $('#placeholder').hidden = true;
  $('#repo-view').hidden = false;
  renderRepoList();
  switchTab('dashboard');
  $('#metrics-status').textContent = 'Loading repository data…';
  $('#metrics-status').style.color = '';

  const [authorsData, commitsData, treeData] = await Promise.all([
    api(`/api/repos/${id}/authors`),
    api(`/api/repos/${id}/commits`),
    api(`/api/repos/${id}/tree`),
  ]);
  if (state.currentRepoId !== id) return; // user switched while loading

  state.authors = authorsData.authors || [];
  state.mailmap = authorsData.mailmap || [];
  state.manualMerges = authorsData.manualMerges || [];
  state.commits = commitsData.commits || [];
  state.tree = treeData || { files: [], dirs: [] };

  renderRepoHeader();
  resetFilterInputs();
  renderAuthorFilter();
  renderPathOptions();
  renderAuthorsTab();
  await loadMetrics();
}

function renderRepoHeader() {
  const repo = state.repos.find((r) => r.id === state.currentRepoId);
  if (!repo) return;
  $('#repo-name').textContent = repo.name;
  $('#repo-meta').innerHTML = `
    <span class="chip">${repo.sourceType === 'zip' ? 'ZIP upload' : 'clone URL'}</span>
    <span class="chip" title="${escapeHtml(repo.sourceValue)}">${escapeHtml(shortSource(repo.sourceValue))}</span>
    <span class="chip">added ${fmtDay(repo.addedAt)}</span>
    <span class="chip">${fmtInt(state.commits.length)} commits</span>
    <span class="chip">${fmtInt(state.authors.length)} authors</span>
  `;
}

function shortSource(value) {
  const s = String(value || '');
  return s.length > 48 ? `${s.slice(0, 45)}…` : s;
}

function switchTab(name) {
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
  $('#tab-dashboard').hidden = name !== 'dashboard';
  $('#tab-authors').hidden = name !== 'authors';
}
$$('.tab').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

/* ---------------------------------------------------------------- filters UI */

function resetFilterInputs() {
  state.filters = { authorIds: [], path: '', from: '', to: '', hashes: [] };
  $('#path-input').value = '';
  $('#date-from').value = '';
  $('#date-to').value = '';
  renderAuthorFilter();
  renderCommitFilterStatus();
}

function renderAuthorFilter() {
  const panel = $('#author-options');
  if (!state.authors.length) {
    panel.innerHTML = '<p class="muted small">No authors in this repository.</p>';
  } else {
    panel.innerHTML = state.authors.map((author) => `
      <label>
        <input type="checkbox" value="${escapeHtml(author.id)}" ${state.filters.authorIds.includes(author.id) ? 'checked' : ''} />
        <span>${escapeHtml(author.name)}</span>
        <span class="commits">${fmtInt(author.commitCount)}</span>
      </label>
    `).join('');
  }
  const count = state.filters.authorIds.length;
  $('#author-dropdown-summary').textContent = count
    ? `${count} author${count === 1 ? '' : 's'} selected`
    : 'All authors';
}

$('#author-options').addEventListener('change', () => {
  state.filters.authorIds = $$('#author-options input:checked').map((cb) => cb.value);
  renderAuthorFilter();
  scheduleMetrics();
});

function renderPathOptions() {
  const datalist = $('#path-options');
  const options = [
    ...state.tree.dirs.map((d) => `${d}/`),
    ...state.tree.files,
  ];
  datalist.innerHTML = options.map((o) => `<option value="${escapeHtml(o)}"></option>`).join('');
}

function renderCommitFilterStatus() {
  const status = $('#commit-filter-status');
  const clearBtn = $('#clear-commits-btn');
  const count = state.filters.hashes.length;
  if (count) {
    status.textContent = `${fmtInt(count)} commit${count === 1 ? '' : 's'} manually selected (period ignored)`;
    clearBtn.hidden = false;
  } else {
    status.textContent = 'Period of time';
    clearBtn.hidden = true;
  }
}

let metricsTimer = null;
function scheduleMetrics() {
  clearTimeout(metricsTimer);
  metricsTimer = setTimeout(() => loadMetrics().catch(showGlobalError), 250);
}

$('#path-input').addEventListener('input', () => {
  state.filters.path = $('#path-input').value.trim();
  scheduleMetrics();
});
$('#date-from').addEventListener('change', () => {
  state.filters.from = $('#date-from').value;
  scheduleMetrics();
});
$('#date-to').addEventListener('change', () => {
  state.filters.to = $('#date-to').value;
  scheduleMetrics();
});
$('#reset-filters-btn').addEventListener('click', () => {
  resetFilterInputs();
  loadMetrics().catch(showGlobalError);
});
$('#clear-commits-btn').addEventListener('click', () => {
  state.filters.hashes = [];
  renderCommitFilterStatus();
  loadMetrics().catch(showGlobalError);
});

/* ---------------------------------------------------------------- metrics */

async function loadMetrics() {
  const id = state.currentRepoId;
  if (!id) return;
  $('#metrics-status').textContent = 'Analysing…';
  $('#metrics-status').style.color = '';
  const data = await api(`/api/repos/${id}/metrics`, {
    method: 'POST',
    body: JSON.stringify(state.filters),
  });
  if (state.currentRepoId !== id) return;
  state.metrics = data;
  renderMetrics(data);
  const filtered = data.filters.matchedCommits;
  $('#metrics-status').textContent =
    `Analysed ${fmtInt(filtered)} commit${filtered === 1 ? '' : 's'} matching the current filters · generated ${fmtDateTime(data.generatedAt)}`;
}

function stat(label, value, cls = '') {
  return `<div class="stat"><span class="label">${label}</span><span class="value ${cls}">${value}</span></div>`;
}

function renderMetrics(data) {
  renderRepositoryCard(data.repository);
  renderCommitSetCard(data.commitSet, data.filters);
  renderFilesTable(data.files);
  renderDirsTable(data.directories);
}

function renderRepositoryCard(repo) {
  const ws = repo.workingTree || {};
  $('#repo-stats').innerHTML = [
    stat('Commits (all)', fmtInt(repo.totalCommits)),
    stat('Authors (all)', fmtInt(repo.totalAuthors)),
    stat('Branch', escapeHtml(repo.defaultBranch || '—')),
    stat('Repo age', `${fmtInt(repo.ageDays)} days`),
    stat('Files (working tree)', fmtInt(ws.fileCount)),
    stat('Lines (working tree)', fmtInt(ws.totalLoc)),
    stat('Insertions (all)', fmtInt(repo.totalInsertions), 'pos'),
    stat('Deletions (all)', fmtInt(repo.totalDeletions), 'neg'),
    stat('First commit', repo.firstCommit ? fmtDay(repo.firstCommit.date) : '—'),
    stat('Last commit', repo.lastCommit ? fmtDay(repo.lastCommit.date) : '—'),
  ].join('');

  const languages = (ws.byExtension || []).filter((l) => l.loc > 0).slice(0, 12);
  $('#repo-languages').innerHTML = languages.length
    ? `<div class="chart-block"><h4>Lines per file extension (working tree)</h4>${renderHBars(
        languages.map((l) => ({ label: l.extension, value: l.loc, display: fmtInt(l.loc) }))
      )}</div>`
    : '';
}

function renderCommitSetCard(set, filters) {
  const hint = filters.manualCommitSelection
    ? `${fmtInt(filters.hashes.length)} manually selected commits`
    : 'matching current filters';
  $('#commitset-hint').textContent = hint;

  $('#commitset-stats').innerHTML = [
    stat('Commits', fmtInt(set.commitCount)),
    stat('Authors', fmtInt(set.authorCount)),
    stat('Files touched', fmtInt(set.filesTouched)),
    stat('Insertions', fmtInt(set.totalInsertions), 'pos'),
    stat('Deletions', fmtInt(set.totalDeletions), 'neg'),
    stat('Net change', fmtInt(set.netChange), set.netChange >= 0 ? 'pos' : 'neg'),
    stat('Avg files / commit', set.avgFilesPerCommit),
    stat('Merge commits', fmtInt(set.mergeCommits)),
  ].join('');

  const authors = set.authors.slice(0, 12);
  $('#commitset-authors').innerHTML = authors.length
    ? renderHBars(authors.map((a) => ({ label: a.name, value: a.commitCount, display: fmtInt(a.commitCount) })))
    : '<p class="muted small">No commits in the selection.</p>';

  renderTimeline(set.commitsByDay);
}

function renderHBars(items) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return items.map((item) => `
    <div class="hbar">
      <span class="hbar-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(1, Math.round((item.value / max) * 100))}%"></div></div>
      <span class="hbar-value">${item.display ?? fmtInt(item.value)}</span>
    </div>
  `).join('');
}

function renderTimeline(commitsByDay) {
  const container = $('#commitset-timeline');
  const labels = $('#commitset-timeline-labels');
  const days = commitsByDay || [];
  if (!days.length) {
    container.innerHTML = '<p class="muted small" style="align-self:center;margin:auto">No commits in the selection.</p>';
    labels.innerHTML = '';
    return;
  }
  const shown = days.slice(-70);
  const max = Math.max(...shown.map((d) => d.count), 1);
  container.innerHTML = shown.map((d) => `
    <div class="tl-col" title="${d.date}: ${d.count} commit(s)">
      <div class="tl-bar" style="height:${Math.max(4, Math.round((d.count / max) * 100))}%"></div>
    </div>
  `).join('');
  labels.innerHTML = `<span>${shown[0].date}</span><span>${shown[shown.length - 1].date}</span>`;
}

const FILE_ROWS_LIMIT = 100;
function renderFilesTable(files) {
  const tbody = $('#files-table tbody');
  const rows = (files.files || []).slice(0, FILE_ROWS_LIMIT);
  tbody.innerHTML = rows.map((f) => `
    <tr>
      <td class="path">${escapeHtml(f.path)}</td>
      <td class="num">${fmtInt(f.commits)}</td>
      <td class="num"><span class="pos">+${fmtInt(f.insertions)}</span></td>
      <td class="num"><span class="neg">−${fmtInt(f.deletions)}</span></td>
      <td class="num">${fmtInt(f.churn)}</td>
      <td class="num">${fmtInt(f.authorCount)}</td>
      <td class="num">${f.currentLoc === null || f.currentLoc === undefined ? '<span class="muted">—</span>' : fmtInt(f.currentLoc)}</td>
      <td>${fmtDay(f.lastDate)}</td>
    </tr>
  `).join('');
  $('#files-empty').hidden = rows.length > 0;
  $('#files-hint').textContent = files.fileCount
    ? `${fmtInt(files.fileCount)} file${files.fileCount === 1 ? '' : 's'} in selection — top ${Math.min(FILE_ROWS_LIMIT, files.fileCount)} shown · LOC in selection: ${fmtInt(files.totalLoc)}`
    : 'no files match';
}

function renderDirsTable(dirs) {
  const tbody = $('#dirs-table tbody');
  const rows = (dirs.directories || []).slice(0, 200);
  tbody.innerHTML = rows.map((d) => `
    <tr>
      <td class="path">${escapeHtml(d.path)}/</td>
      <td class="num">${fmtInt(d.fileCount)}</td>
      <td class="num">${fmtInt(d.commitCount)}</td>
      <td class="num"><span class="pos">+${fmtInt(d.insertions)}</span></td>
      <td class="num"><span class="neg">−${fmtInt(d.deletions)}</span></td>
      <td class="num">${fmtInt(d.churn)}</td>
      <td class="num">${fmtInt(d.authorCount)}</td>
      <td class="num">${fmtInt(d.loc)}</td>
    </tr>
  `).join('');
  $('#dirs-empty').hidden = rows.length > 0;
  $('#dirs-hint').textContent = dirs.directoryCount
    ? `${fmtInt(dirs.directoryCount)} director${dirs.directoryCount === 1 ? 'y' : 'ies'} in selection`
    : 'no directories match';
}

/* ---------------------------------------------------------------- authors tab */

function renderAuthorsTab() {
  // Mailmap info
  const mailmapEl = $('#mailmap-info');
  if (state.mailmap.length) {
    mailmapEl.innerHTML = `<span class="tag">.mailmap active — ${state.mailmap.length} entr${state.mailmap.length === 1 ? 'y' : 'ies'}</span>` +
      state.mailmap.slice(0, 8).map((e) =>
        `<span class="tag" title="${escapeHtml(`${e.sourceName || ''} <${e.sourceEmail}> → ${e.targetName || ''} <${e.targetEmail || e.sourceEmail}>`)}">${escapeHtml(e.sourceEmail)} → ${escapeHtml(e.targetEmail || e.sourceEmail)}</span>`
      ).join('');
  } else {
    mailmapEl.innerHTML = '<span class="muted small">No .mailmap found in this repository — use manual merging below when one person committed under several emails.</span>';
  }

  if (state.manualMerges.length) {
    mailmapEl.insertAdjacentHTML('beforeend',
      state.manualMerges.map((g) =>
        `<span class="tag" style="border-color:rgba(53,197,143,.6);color:var(--accent-2)">manual: ${escapeHtml(g.name)} (${g.emails.length} email${g.emails.length === 1 ? '' : 's'})</span>`
      ).join(''));
  }

  const tbody = $('#authors-table tbody');
  tbody.innerHTML = state.authors.map((author) => {
    const rawVariants = (author.raw || []).map((r) => `
      <div class="raw-variant">
        <span>${escapeHtml(r.name)} &lt;${escapeHtml(r.email)}&gt; · ${fmtInt(r.commitCount)} commit${r.commitCount === 1 ? '' : 's'}</span>
        ${r.mailmapApplied ? '<span class="badge mailmap">mailmap</span>' : ''}
      </div>
    `).join('');
    const isManualGroup = state.manualMerges.some((g) => g.id === author.id);
    return `
      <tr>
        <td class="check"><input type="checkbox" data-merge-author="${escapeHtml(author.id)}" ${state.mergeSelection.has(author.id) ? 'checked' : ''} /></td>
        <td>${escapeHtml(author.name)} ${isManualGroup ? '<span class="badge manual">merged</span>' : ''}</td>
        <td>${author.emails.map((e) => `<code>${escapeHtml(e)}</code>`).join(' ')}</td>
        <td>${rawVariants || '<span class="muted">—</span>'}</td>
        <td class="num">${fmtInt(author.commitCount)}</td>
      </tr>
    `;
  }).join('');

  updateMergeBar();
}

function updateMergeBar() {
  const selectedAuthors = state.authors.filter((a) => state.mergeSelection.has(a.id));
  const emailCount = new Set(selectedAuthors.flatMap((a) => a.emails)).size;
  $('#merge-selection-info').textContent =
    `${selectedAuthors.length} author${selectedAuthors.length === 1 ? '' : 's'} selected (${emailCount} email${emailCount === 1 ? '' : 's'})`;
  $('#merge-authors-btn').disabled = emailCount < 2;
}

$('#authors-table').addEventListener('change', (e) => {
  const cb = e.target.closest('[data-merge-author]');
  if (!cb) return;
  if (cb.checked) state.mergeSelection.add(cb.dataset.mergeAuthor);
  else state.mergeSelection.delete(cb.dataset.mergeAuthor);
  updateMergeBar();
});

$('#merge-authors-btn').addEventListener('click', async () => {
  const selectedAuthors = state.authors.filter((a) => state.mergeSelection.has(a.id));
  const emails = [...new Set(selectedAuthors.flatMap((a) => a.emails))];
  if (emails.length < 2) return;
  const name = $('#merge-name-input').value.trim();
  try {
    const data = await api(`/api/repos/${state.currentRepoId}/authors/merge`, {
      method: 'POST',
      body: JSON.stringify({ emails, name }),
    });
    applyAuthorsPayload(data);
    $('#merge-name-input').value = '';
    // Author ids may have changed - clear the author filter to avoid stale ids.
    state.filters.authorIds = [];
    renderAuthorFilter();
    renderCommitFilterStatus();
    renderRepoHeader();
    await loadMetrics();
  } catch (err) {
    showGlobalError(err);
  }
});

$('#reset-merges-btn').addEventListener('click', async () => {
  try {
    const data = await api(`/api/repos/${state.currentRepoId}/authors/reset-merges`, { method: 'POST' });
    applyAuthorsPayload(data);
    state.filters.authorIds = [];
    renderAuthorFilter();
    renderRepoHeader();
    await loadMetrics();
  } catch (err) {
    showGlobalError(err);
  }
});

function applyAuthorsPayload(data) {
  state.authors = data.authors || [];
  state.manualMerges = data.manualMerges || [];
  state.mailmap = data.mailmap || [];
  state.mergeSelection = new Set();
  renderAuthorsTab();
}

/* ---------------------------------------------------------------- commit picker */

$('#pick-commits-btn').addEventListener('click', () => {
  state.picker.selected = new Set(state.filters.hashes);
  state.picker.search = '';
  $('#commit-search').value = '';
  renderCommitList();
  openModal('commits-modal');
});

$('#commit-search').addEventListener('input', () => {
  state.picker.search = $('#commit-search').value.trim().toLowerCase();
  renderCommitList();
});

function filteredCommits() {
  const q = state.picker.search;
  if (!q) return state.commits;
  return state.commits.filter((c) =>
    c.subject.toLowerCase().includes(q) ||
    c.authorName.toLowerCase().includes(q) ||
    c.hash.toLowerCase().startsWith(q) ||
    c.shortHash.startsWith(q)
  );
}

const COMMIT_ROWS_LIMIT = 800;
function renderCommitList() {
  const list = $('#commit-list');
  const commits = filteredCommits();
  const rows = commits.slice(0, COMMIT_ROWS_LIMIT);
  list.innerHTML = rows.length
    ? rows.map((c) => `
      <label class="commit-row">
        <input type="checkbox" data-commit-hash="${escapeHtml(c.hash)}" ${state.picker.selected.has(c.hash) ? 'checked' : ''} />
        <span class="hash">${escapeHtml(c.shortHash)}</span>
        <span class="subject" title="${escapeHtml(c.subject)}">${escapeHtml(c.subject)}</span>
        <span class="author">${escapeHtml(c.authorName)}</span>
        <span class="when">${fmtDay(c.date)}</span>
      </label>
    `).join('')
    : '<p class="muted small" style="padding:12px">No commits match the search.</p>';
  updatePickerCount(commits.length);
}

function updatePickerCount(visibleCount) {
  const total = state.commits.length;
  const shown = Math.min(visibleCount ?? filteredCommits().length, COMMIT_ROWS_LIMIT);
  const truncated = (visibleCount ?? total) > COMMIT_ROWS_LIMIT ? ` (showing first ${COMMIT_ROWS_LIMIT})` : '';
  $('#commit-picker-count').textContent =
    `${state.picker.selected.size} selected · ${shown} of ${visibleCount ?? total} shown${truncated}`;
}

$('#commit-list').addEventListener('change', (e) => {
  const cb = e.target.closest('[data-commit-hash]');
  if (!cb) return;
  if (cb.checked) state.picker.selected.add(cb.dataset.commitHash);
  else state.picker.selected.delete(cb.dataset.commitHash);
  updatePickerCount();
});

$('#select-all-commits').addEventListener('click', () => {
  filteredCommits().slice(0, COMMIT_ROWS_LIMIT).forEach((c) => state.picker.selected.add(c.hash));
  renderCommitList();
});

$('#clear-commit-selection').addEventListener('click', () => {
  state.picker.selected = new Set();
  renderCommitList();
});

$('#apply-commits-btn').addEventListener('click', () => {
  state.filters.hashes = [...state.picker.selected];
  renderCommitFilterStatus();
  closeModal('commits-modal');
  loadMetrics().catch(showGlobalError);
});

/* ---------------------------------------------------------------- init */

loadRepos().catch(showGlobalError);
