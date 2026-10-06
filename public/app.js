/* RAT dashboard - vanilla JS frontend. */
'use strict';

const state = {
  repos: [],
  currentRepoId: null,
  authors: [],
  mailmap: [],
  manualMerges: [],
  commits: [],
  commitCount: 0,
  tree: { files: [], dirs: [] },
  filters: { authorIds: [], path: '', from: '', to: '', hashes: [] },
  picker: { selected: new Set(), search: '' },
  pickerOffset: 0,
  pickerTotal: 0,
  pickerHasMore: false,
  mergeSelection: new Set(),
  metrics: null,
  fileSort: { key: null, asc: true },
  dirSort: { key: null, asc: true },
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

function parseHash() {
  const hash = location.hash.slice(1);
  const params = new URLSearchParams(hash);
  return { repoId: params.get('repo') || null, tab: params.get('tab') || 'dashboard' };
}

function updateHash() {
  if (state.currentRepoId) {
    const tab = $('#tab-dashboard').hidden ? 'authors' : 'dashboard';
    const nextHash = `repo=${state.currentRepoId}&tab=${tab}`;
    if (location.hash.slice(1) !== nextHash) location.hash = nextHash;
  }
}

function setupSortableTable(tableId, getSortState, getDataArray, renderBodyFn) {
  const table = $(`#${tableId}`);
  if (!table) return;
  table.querySelector('thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sortable]');
    if (!th) return;
    const key = th.dataset.sortable;
    const sortState = getSortState();
    if (sortState.key === key) {
      sortState.asc = !sortState.asc;
    } else {
      sortState.key = key;
      sortState.asc = false; // default descending for numbers
    }
    const data = getDataArray();
    if (!data) return;
    data.sort((a, b) => {
      let va = a[key] ?? 0, vb = b[key] ?? 0;
      if (typeof va === 'string') return sortState.asc ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortState.asc ? va - vb : vb - va;
    });
    renderBodyFn(data);
    // Update header classes
    table.querySelectorAll('th[data-sortable]').forEach((h) => {
      h.classList.remove('asc', 'desc');
      if (h.dataset.sortable === key) h.classList.add(sortState.asc ? 'asc' : 'desc');
    });
  });
}

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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const open = document.querySelector('.modal-backdrop:not([hidden])');
    if (open) open.hidden = true;
  }
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
  state.commitCount = 0;
  state.commits = [];
  state.filters = { authorIds: [], path: '', from: '', to: '', hashes: [] };
  state.mergeSelection = new Set();
  $('#placeholder').hidden = true;
  $('#repo-view').hidden = false;
  renderRepoList();
  switchTab('dashboard');
  $('#metrics-status').style.color = '';

  $('#metrics-status').textContent = 'Loading authors…';
  const authorsData = await api(`/api/repos/${id}/authors`);
  if (state.currentRepoId !== id) return;

  $('#metrics-status').textContent = 'Loading file tree…';
  const treeData = await api(`/api/repos/${id}/tree`);
  if (state.currentRepoId !== id) return;

  state.authors = authorsData.authors || [];
  state.mailmap = authorsData.mailmap || [];
  state.manualMerges = authorsData.manualMerges || [];
  state.tree = treeData || { files: [], dirs: [] };

  renderRepoHeader();
  renderSkeleton();
  resetFilterInputs();
  renderAuthorFilter();
  renderPathOptions();
  renderAuthorsTab();
  await loadMetrics();
  updateHash();
}

function renderRepoHeader() {
  const repo = state.repos.find((r) => r.id === state.currentRepoId);
  if (!repo) return;
  $('#repo-name').textContent = repo.name;
  $('#repo-meta').innerHTML = `
    <span class="chip">${repo.sourceType === 'zip' ? 'ZIP upload' : 'clone URL'}</span>
    <span class="chip" title="${escapeHtml(repo.sourceValue)}">${escapeHtml(shortSource(repo.sourceValue))}</span>
    <span class="chip">added ${fmtDay(repo.addedAt)}</span>
    <span class="chip">${state.commitCount ? fmtInt(state.commitCount) : '…'} commits</span>
    <span class="chip">${fmtInt(state.authors.length)} authors</span>
  `;
}

function renderSkeleton() {
  const shimmer = '<div class="skeleton-line"></div>';
  const statPlaceholder = '<div class="stat skeleton-stat"><div class="skeleton-line" style="width:60%;height:12px"></div><div class="skeleton-line" style="width:40%;height:18px;margin-top:4px"></div></div>';
  const statGrid = `<div class="stat-grid">${statPlaceholder.repeat(6)}</div>`;
  $('#repo-stats').innerHTML = statGrid;
  $('#repo-languages').innerHTML = shimmer;
  $('#commitset-stats').innerHTML = statGrid;
  $('#commitset-authors').innerHTML = shimmer.repeat(3);
  $('#commitset-timeline').innerHTML = shimmer;
  $('#files-table tbody').innerHTML = '<tr><td colspan="11">' + shimmer + '</td></tr>';
  $('#dirs-table tbody').innerHTML = '<tr><td colspan="11">' + shimmer + '</td></tr>';
  $('#author-metrics-content').innerHTML = shimmer;
}

function shortSource(value) {
  const s = String(value || '');
  return s.length > 48 ? `${s.slice(0, 45)}…` : s;
}

function switchTab(name) {
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
  $('#tab-dashboard').hidden = name !== 'dashboard';
  $('#tab-authors').hidden = name !== 'authors';
  updateHash();
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
  datalist.innerHTML = options.slice(0, 500).map((o) => `<option value="${escapeHtml(o)}"></option>`).join('');
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
let metricsAbort = null;
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
  if (metricsAbort) metricsAbort.abort();
  metricsAbort = new AbortController();
  const signal = metricsAbort.signal;
  const cardsEl = $('.cards');
  let shimmerTimer = setTimeout(() => { if (cardsEl) cardsEl.classList.add('loading-shimmer'); }, 150);
  try {
    $('#metrics-status').textContent = 'Analysing…';
    $('#metrics-status').style.color = '';
    const data = await api(`/api/repos/${id}/metrics`, {
      method: 'POST',
      body: JSON.stringify(state.filters),
      signal,
    });
    if (state.currentRepoId !== id) {
      clearTimeout(shimmerTimer);
      if (cardsEl) cardsEl.classList.remove('loading-shimmer');
      return;
    }
    state.metrics = data;
    clearTimeout(shimmerTimer);
    if (cardsEl) cardsEl.classList.remove('loading-shimmer');
    state.fileSort = { key: null, asc: true };
    state.dirSort = { key: null, asc: true };
    // Clear sort indicators
    $$('#files-table th[data-sortable], #dirs-table th[data-sortable]').forEach((th) => th.classList.remove('asc', 'desc'));
    renderMetrics(data);
    state.commitCount = data.repository.totalCommits || 0;
    renderRepoHeader();
    const filtered = data.filters.matchedCommits;
    $('#metrics-status').textContent =
      `Analysed ${fmtInt(filtered)} commit${filtered === 1 ? '' : 's'} matching the current filters · generated ${fmtDateTime(data.generatedAt)}`;
  } catch (err) {
    clearTimeout(shimmerTimer);
    if (cardsEl) cardsEl.classList.remove('loading-shimmer');
    if (err.name === 'AbortError') return; // superseded by newer request
    throw err;
  }
}

function stat(label, value, cls = '', highlight = false) {
  return `<div class="stat${highlight ? ' stat--highlight' : ''}"><span class="label">${label}</span><span class="value ${cls}">${value}</span></div>`;
}

function renderMetrics(data) {
  renderRepositoryCard(data.repository);
  renderCommitSetCard(data.commitSet, data.filters);
  renderFilesTable(data.files);
  renderDirsTable(data.directories);
  renderAuthorMetrics(data.commitSet.authorFileMetrics);
}

const DONUT_COLORS = ['#4f8cff', '#35c58f', '#e5534b', '#f0a840', '#a371f7', '#3fb950', '#e06c75', '#56d4dd'];

function renderDonut(items, size = 120) {
  if (!items.length) return '';
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return '';
  const r = size / 2 - 10;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const circles = items.map((item, idx) => {
    const fraction = item.value / total;
    const dash = fraction * circumference;
    const circle = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${DONUT_COLORS[idx % DONUT_COLORS.length]}" stroke-width="18" stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size / 2} ${size / 2})" />`;
    offset += dash;
    return circle;
  });
  const legend = items.map((item, idx) => `
    <div class="donut-legend-item">
      <span class="donut-swatch" style="background:${DONUT_COLORS[idx % DONUT_COLORS.length]}"></span>
      <span>${escapeHtml(item.label)}</span>
      <span class="muted small">${fmtInt(item.value)} (${(item.value / total * 100).toFixed(1)}%)</span>
    </div>
  `).join('');
  return `<div class="donut-wrap">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${circles.join('')}</svg>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

function renderRepositoryCard(repo) {
  const ws = repo.workingTree || {};
  $('#repo-stats').innerHTML = [
    stat('Commits (all)', fmtInt(repo.totalCommits), '', true),
    stat('Authors (all)', fmtInt(repo.totalAuthors)),
    stat('Branch', escapeHtml(repo.defaultBranch || '—')),
    stat('Repo age', `${fmtInt(repo.ageDays)} days`),
    stat('Files (working tree)', fmtInt(ws.fileCount)),
    stat('Lines (working tree)', fmtInt(ws.totalLoc)),
    stat('Insertions (all)', fmtInt(repo.totalInsertions), 'pos'),
    stat('Deletions (all)', fmtInt(repo.totalDeletions), 'neg'),
    stat('Total churn (all)', fmtInt(repo.totalChurn), '', true),
    stat('Growth (all)', fmtInt(repo.growth), repo.growth >= 0 ? 'pos' : 'neg'),
    stat('First commit', repo.firstCommit ? fmtDay(repo.firstCommit.date) : '—'),
    stat('Last commit', repo.lastCommit ? fmtDay(repo.lastCommit.date) : '—'),
  ].join('');

  const languages = (ws.byExtension || []).filter((l) => l.loc > 0).slice(0, 12);
  if (languages.length) {
    const donutItems = languages.slice(0, 8).map((l) => ({ label: l.extension, value: l.loc }));
    const donut = renderDonut(donutItems);
    const bars = renderHBars(languages.map((l) => ({ label: l.extension, value: l.loc, display: fmtInt(l.loc) })));
    $('#repo-languages').innerHTML = `<div class="chart-block"><h4>Lines per file extension (working tree)</h4>${donut}${bars}</div>`;
  } else {
    $('#repo-languages').innerHTML = '';
  }
}

function renderCommitSetCard(set, filters) {
  const hint = filters.manualCommitSelection
    ? `${fmtInt(filters.hashes.length)} manually selected commits`
    : 'matching current filters';
  $('#commitset-hint').textContent = hint;

  $('#commitset-stats').innerHTML = [
    stat('Commits', fmtInt(set.commitCount), '', true),
    stat('Authors', fmtInt(set.authorCount)),
    stat('Files touched', fmtInt(set.filesTouched)),
    stat('Insertions', fmtInt(set.totalInsertions), 'pos'),
    stat('Deletions', fmtInt(set.totalDeletions), 'neg'),
    stat('Net change', fmtInt(set.netChange), set.netChange >= 0 ? 'pos' : 'neg'),
    stat('Total churn', fmtInt(set.totalChurn), '', true),
    stat('Avg files / commit', set.avgFilesPerCommit),
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

  const tooltip = $('#tl-tooltip');
  if (tooltip && !container._tooltipAttached) {
    container.addEventListener('mousemove', (e) => {
      const col = e.target.closest('.tl-col');
      if (!col) { tooltip.classList.remove('visible'); return; }
      const title = col.getAttribute('title') || '';
      tooltip.textContent = title;
      const rect = container.getBoundingClientRect();
      const colRect = col.getBoundingClientRect();
      tooltip.style.left = `${colRect.left - rect.left + colRect.width / 2}px`;
      tooltip.style.top = '-28px';
      tooltip.classList.add('visible');
    });
    container.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });
    container._tooltipAttached = true;
  }
}

const FILE_ROWS_LIMIT = 100;
function renderFileRow(f) {
  return `<tr>
    <td class="path">${escapeHtml(f.path)}</td>
    <td class="num">${fmtInt(f.commits)}</td>
    <td class="num"><span class="pos">+${fmtInt(f.insertions)}</span></td>
    <td class="num"><span class="neg">−${fmtInt(f.deletions)}</span></td>
    <td class="num">${fmtInt(f.churn)}</td>
    <td class="num"><span class="${(f.growth ?? 0) >= 0 ? 'pos' : 'neg'}">${fmtInt(f.growth)}</span></td>
    <td class="num">${f.modificationFrequency?.toFixed(4) ?? '—'}</td>
    <td class="num">${f.churnRate?.toFixed(2) ?? '—'}</td>
    <td class="num">${fmtInt(f.authorCount)}</td>
    <td class="num">${f.currentLoc === null || f.currentLoc === undefined ? '<span class="muted">—</span>' : fmtInt(f.currentLoc)}</td>
    <td>${fmtDay(f.lastDate)}</td>
  </tr>`;
}

function renderFilesTable(files) {
  const tbody = $('#files-table tbody');
  const rows = (files.files || []).slice(0, FILE_ROWS_LIMIT);
  const churnValues = rows.map((f) => f.churn).sort((a, b) => a - b);
  const modFreqValues = rows.map((f) => f.modificationFrequency ?? 0).sort((a, b) => a - b);
  const churnP90 = churnValues[Math.floor(churnValues.length * 0.9)] || Infinity;
  const modFreqP90 = modFreqValues[Math.floor(modFreqValues.length * 0.9)] || Infinity;
  tbody.innerHTML = rows.map((f) => `<tr>
    <td class="path">${escapeHtml(f.path)}</td>
    <td class="num">${fmtInt(f.commits)}</td>
    <td class="num"><span class="pos">+${fmtInt(f.insertions)}</span></td>
    <td class="num"><span class="neg">−${fmtInt(f.deletions)}</span></td>
    <td class="num${f.churn >= churnP90 ? ' hotspot' : ''}">${fmtInt(f.churn)}</td>
    <td class="num"><span class="${(f.growth ?? 0) >= 0 ? 'pos' : 'neg'}">${fmtInt(f.growth)}</span></td>
    <td class="num${(f.modificationFrequency ?? 0) >= modFreqP90 ? ' warm' : ''}">${f.modificationFrequency?.toFixed(4) ?? '—'}</td>
    <td class="num">${f.churnRate?.toFixed(2) ?? '—'}</td>
    <td class="num">${fmtInt(f.authorCount)}</td>
    <td class="num">${f.currentLoc === null || f.currentLoc === undefined ? '<span class="muted">—</span>' : fmtInt(f.currentLoc)}</td>
    <td>${fmtDay(f.lastDate)}</td>
  </tr>`).join('');
  $('#files-empty').hidden = rows.length > 0;
  $('#files-hint').textContent = files.fileCount
    ? `${fmtInt(files.fileCount)} file${files.fileCount === 1 ? '' : 's'} in selection — top ${Math.min(FILE_ROWS_LIMIT, files.fileCount)} shown · LOC in selection: ${fmtInt(files.totalLoc)}`
    : 'no files match';
}

function renderDirRow(d) {
  return `<tr>
    <td class="path">${escapeHtml(d.path)}/</td>
    <td class="num">${fmtInt(d.fileCount)}</td>
    <td class="num">${fmtInt(d.commitCount)}</td>
    <td class="num"><span class="pos">+${fmtInt(d.insertions)}</span></td>
    <td class="num"><span class="neg">−${fmtInt(d.deletions)}</span></td>
    <td class="num">${fmtInt(d.churn)}</td>
    <td class="num"><span class="${(d.growth ?? 0) >= 0 ? 'pos' : 'neg'}">${fmtInt(d.growth)}</span></td>
    <td class="num">${d.modificationFrequency?.toFixed(4) ?? '—'}</td>
    <td class="num">${d.churnRate?.toFixed(2) ?? '—'}</td>
    <td class="num">${fmtInt(d.authorCount)}</td>
    <td class="num">${fmtInt(d.loc)}</td>
  </tr>`;
}

function renderDirsTable(dirs) {
  const tbody = $('#dirs-table tbody');
  const rows = (dirs.directories || []).slice(0, 200);
  tbody.innerHTML = rows.map((d) => renderDirRow(d)).join('');
  $('#dirs-empty').hidden = rows.length > 0;
  $('#dirs-hint').textContent = dirs.directoryCount
    ? `${fmtInt(dirs.directoryCount)} director${dirs.directoryCount === 1 ? 'y' : 'ies'} in selection`
    : 'no directories match';
}

const AUTHOR_FILES_LIMIT = 20;
function renderAuthorMetrics(authorFileMetrics) {
  const content = $('#author-metrics-content');
  const hint = $('#author-metrics-hint');
  const authors = Array.isArray(authorFileMetrics) ? authorFileMetrics : [];
  if (!authors.length) {
    hint.textContent = '';
    content.innerHTML = '<p class="muted small">No author metrics available</p>';
    return;
  }
  hint.textContent =
    `Per-author file activity in the current selection — ${fmtInt(authors.length)} author${authors.length === 1 ? '' : 's'}`;

  content.innerHTML = authors.map((a, idx) => `
    <details class="author-block" data-author-idx="${idx}" ${idx === 0 ? 'open' : ''}>
      <summary style="display:flex;gap:10px;align-items:baseline;cursor:pointer;padding:6px 2px">
        <span class="author-name">${escapeHtml(a.authorName)}</span>
        <span class="muted small">${fmtInt(a.totalModifications)} modification${a.totalModifications === 1 ? '' : 's'} · ${fmtInt(a.totalChurn)} churn</span>
      </summary>
      <div class="author-detail"></div>
    </details>
  `).join('');

  // Render the first (open) author's detail immediately
  renderAuthorDetail(content.querySelector('details[open] .author-detail'), authors[0]);
  content.querySelector('details[open]').setAttribute('data-rendered', 'true');

  // Lazy-render others on toggle
  content.addEventListener('toggle', (e) => {
    const details = e.target.closest('details.author-block');
    if (!details || details.dataset.rendered === 'true') return;
    const idx = parseInt(details.dataset.authorIdx, 10);
    const author = authors[idx];
    if (!author) return;
    renderAuthorDetail(details.querySelector('.author-detail'), author);
    details.dataset.rendered = 'true';
  }, true); // useCapture for toggle events on details
}

function renderAuthorDetail(container, author) {
  if (!container || !author) return;
  const files = author.files || [];
  const topFiles = files.slice(0, AUTHOR_FILES_LIMIT);
  const rows = topFiles.map((f) => `
    <tr>
      <td class="path">${escapeHtml(f.path)}</td>
      <td class="num">${fmtInt(f.modifications)}</td>
      <td class="num">${fmtInt(f.churn)}</td>
      <td class="num">${((f.ownership ?? 0) * 100).toFixed(2)}%</td>
    </tr>
  `).join('');
  const totalFileCount = author.totalFiles || files.length;
  const truncated = totalFileCount > topFiles.length
    ? `<p class="muted small">Showing top ${AUTHOR_FILES_LIMIT} of ${fmtInt(totalFileCount)} file${totalFileCount === 1 ? '' : 's'} by churn.</p>`
    : '';
  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Path</th><th class="num">Modifications</th><th class="num">Churn</th><th class="num">Ownership</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${truncated}
  `;
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

let pickerAbort = null;

async function fetchPickerPage(append = false) {
  const id = state.currentRepoId;
  if (!id) return;
  if (pickerAbort) pickerAbort.abort();
  pickerAbort = new AbortController();

  const list = $('#commit-list');
  if (!append) {
    list.innerHTML = '<p class="muted small" style="padding:12px">Loading commits…</p>';
  }

  try {
    const params = new URLSearchParams();
    const q = state.picker.search;
    if (q) params.set('q', q);
    params.set('offset', String(state.pickerOffset));
    params.set('limit', '200');

    const data = await api(`/api/repos/${id}/commits?${params}`, { signal: pickerAbort.signal });

    if (append) {
      state.commits = state.commits.concat(data.commits || []);
    } else {
      state.commits = data.commits || [];
    }
    state.pickerTotal = data.total || 0;
    state.pickerHasMore = data.hasMore || false;
    state.pickerOffset = (data.offset || 0) + (data.commits || []).length;

    renderCommitList();
  } catch (err) {
    if (err.name === 'AbortError') return;
    list.innerHTML = '<p class="muted small" style="padding:12px">Failed to load commits.</p>';
  }
}

$('#pick-commits-btn').addEventListener('click', async () => {
  state.picker.selected = new Set(state.filters.hashes);
  state.picker.search = '';
  state.pickerOffset = 0;
  state.pickerTotal = 0;
  state.pickerHasMore = false;
  $('#commit-search').value = '';
  openModal('commits-modal');
  await fetchPickerPage();
});

let pickerSearchTimer = null;
$('#commit-search').addEventListener('input', () => {
  state.picker.search = $('#commit-search').value.trim().toLowerCase();
  clearTimeout(pickerSearchTimer);
  pickerSearchTimer = setTimeout(() => {
    state.pickerOffset = 0;
    fetchPickerPage();
  }, 300);
});

function filteredCommits() {
  return state.commits;
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
  if (state.pickerHasMore) {
    list.insertAdjacentHTML('beforeend',
      '<button class="btn small load-more-btn" style="margin:8px auto;display:block">Load more commits…</button>');
  }
  updatePickerCount();
}

function updatePickerCount() {
  const total = state.pickerTotal || state.commits.length;
  const shown = Math.min(state.commits.length, COMMIT_ROWS_LIMIT);
  const moreInfo = state.pickerHasMore ? ' (load more below)' : '';
  $('#commit-picker-count').textContent =
    `${state.picker.selected.size} selected · ${shown} of ${total} shown${moreInfo}`;
}

$('#commit-list').addEventListener('change', (e) => {
  const cb = e.target.closest('[data-commit-hash]');
  if (!cb) return;
  if (cb.checked) state.picker.selected.add(cb.dataset.commitHash);
  else state.picker.selected.delete(cb.dataset.commitHash);
  updatePickerCount();
});

$('#commit-list').addEventListener('click', (e) => {
  if (e.target.closest('.load-more-btn')) {
    fetchPickerPage(true);
  }
});

$('#select-all-commits').addEventListener('click', () => {
  state.commits.slice(0, COMMIT_ROWS_LIMIT).forEach((c) => state.picker.selected.add(c.hash));
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

setupSortableTable('files-table',
  () => state.fileSort,
  () => state.metrics?.files?.files,
  (sorted) => {
    const tbody = $('#files-table tbody');
    tbody.innerHTML = sorted.slice(0, FILE_ROWS_LIMIT).map((f) => renderFileRow(f)).join('');
  }
);
setupSortableTable('dirs-table',
  () => state.dirSort,
  () => state.metrics?.directories?.directories,
  (sorted) => {
    const tbody = $('#dirs-table tbody');
    tbody.innerHTML = sorted.slice(0, 200).map((d) => renderDirRow(d)).join('');
  }
);

window.addEventListener('hashchange', () => {
  const { repoId, tab } = parseHash();
  if (!repoId) return;
  const navigate = async () => {
    if (repoId !== state.currentRepoId) await selectRepo(repoId);
    if (state.currentRepoId === repoId) switchTab(tab);
  };
  navigate().catch(showGlobalError);
});

async function init() {
  await loadRepos();
  const { repoId, tab } = parseHash();
  if (repoId) {
    await selectRepo(repoId);
    switchTab(tab);
  }
}

init().catch(showGlobalError);
