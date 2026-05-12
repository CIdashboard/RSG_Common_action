// ── state ─────────────────────────────────────────────────────────────────
let allRepos     = [];
let sortKey      = 'group';
let sortDir      = 1;
let filterStatus = '';
let filterGroup  = '';
let filterSearch = '';
let currentPage  = 1;

const REPOS_PER_PAGE = 25;
const detailCache    = {};

// ── bootstrap ─────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const resp = await fetch('data/index.json?t=' + Date.now());
    const data = await resp.json();
    allRepos = data.repos || [];
    renderSummary(data.summary, data.org, data.synced_at);
    populateGroups();
    renderCharts(data.summary, allRepos);
    renderTable();
  } catch (e) {
    document.getElementById('repo-tbody').innerHTML =
      `<tr><td colspan="7" class="state-msg">Failed to load data/index.json — ${e.message}</td></tr>`;
  }
}

// ── summary cards ─────────────────────────────────────────────────────────
function renderSummary(s, org, syncedAt) {
  document.getElementById('org-name').textContent  = org || '—';
  document.getElementById('sync-time').textContent =
    syncedAt ? `Synced ${fmtDateTime(syncedAt)} IST` : 'Never synced';

  const reposWithOpenPrs = allRepos.filter(r => (r.open_prs || 0) > 0).length;
  const rClass    = s.pass_rate >= 50 ? 'c-green' : 'c-amber';

  document.getElementById('summary-grid').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Org pass rate</div>
      <div class="stat-value ${rClass}">${fmtRate(s.pass_rate)}</div>
      <div class="stat-sub">${s.passing || 0} of ${s.total_repos || 0} repos healthy</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Avg build time</div>
      <div class="stat-value">${fmtDuration(s.avg_duration_seconds)}</div>
      <div class="stat-sub">across all CI repos</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Open PRs</div>
      <div class="stat-value">${(s.open_prs || 0).toLocaleString()}</div>
      <div class="stat-sub">across ${s.total_repos || 0} repos</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Repos with PRs</div>
      <div class="stat-value c-green">${reposWithOpenPrs || '—'}</div>
      <div class="stat-sub">repositories with at least one open PR</div>
    </div>
  `;
}

// ── groups dropdown ───────────────────────────────────────────────────────
function populateGroups() {
  const groups = [...new Set(allRepos.map(r => r.group).filter(Boolean))].sort();
  const sel    = document.getElementById('group-select');
  sel.innerHTML = '<option value="">All groups</option>';
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = g;
    sel.appendChild(opt);
  });
}

// ── render homepage charts ────────────────────────────────────────────────
function renderCharts(summary, repos) {
  renderOrgDonut('chart-donut', summary);
  renderPassDistribution('chart-pass-dist', repos);
  renderDurationDistribution('chart-dur-dist', repos);

}

// ── filter + sort ─────────────────────────────────────────────────────────
function filteredRepos() {
  let list = allRepos;
  if (filterSearch) list = list.filter(r => r.name.toLowerCase().includes(filterSearch.toLowerCase()));
  if (filterGroup)  list = list.filter(r => r.group === filterGroup);
  if (filterStatus) list = list.filter(r => r.status === filterStatus);

  return [...list].sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (va == null) return 1;
    if (vb == null) return -1;
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * sortDir;
  });
}

// ── render table ──────────────────────────────────────────────────────────
function renderTable() {
  const repos      = filteredRepos();
  const totalPages = Math.max(1, Math.ceil(repos.length / REPOS_PER_PAGE));
  currentPage      = Math.min(currentPage, totalPages);

  const start      = (currentPage - 1) * REPOS_PER_PAGE;
  const pageRepos  = repos.slice(start, start + REPOS_PER_PAGE);

  document.getElementById('repo-count').textContent =
    `${repos.length} repo${repos.length !== 1 ? 's' : ''}`;

  const tbody = document.getElementById('repo-tbody');

  if (!repos.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="state-msg">No repos match the current filters.</td></tr>`;
    renderPagination(0, 1);
    return;
  }

  tbody.innerHTML = '';
  pageRepos.forEach(repo => {
    const barW       = repo.pass_rate != null ? Math.max(2, repo.pass_rate) : 0;

    const tr = document.createElement('tr');
    tr.className = 'repo-row';
    tr.dataset.repo = repo.name;
    tr.title = 'Click to view detailed repo information';
    tr.setAttribute('aria-label', `${repo.name} repository. Click for details.`);
    tr.onclick = () => window.location.href = `repo.html?repo=${encodeURIComponent(repo.name)}`;
    tr.innerHTML = `
      <td>
        <div class="repo-name">
          <a class="repo-link"
             href="repo.html?repo=${encodeURIComponent(repo.name)}"
             onclick="event.stopPropagation()">${repo.name}</a>
        </div>
      </td>
      <td class="mono">${repo.group || '—'}</td>
      <td class="right mono ${rateColorClass(repo.pass_rate)}">${fmtRate(repo.pass_rate)}</td>
      <td class="right mono">${fmtDuration(repo.avg_duration_seconds)}</td>
      <td class="right mono">${repo.open_prs ?? '—'}</td>
      <td class="right mono" style="font-size:11px;color:var(--text-3);">${fmtRelative(repo.last_run_at)}</td>
      <td>
        <div class="bar-wrap">
          <div class="bar-fill" style="width:${barW}%;background:${barColor(repo.pass_rate)};"></div>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination(repos.length, totalPages);
}

// ── pagination ────────────────────────────────────────────────────────────
function renderPagination(total, totalPages) {
  const el = document.getElementById('pagination');
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const pages = [];
  // always show first, last, current ±1
  const show = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]
    .filter(p => p >= 1 && p <= totalPages));
  const sorted = [...show].sort((a, b) => a - b);

  const btn = (p, label, active, disabled) =>
    `<button class="page-btn${active ? ' active' : ''}" ${disabled ? 'disabled' : ''}
      onclick="goToPage(${p})">${label}</button>`;

  pages.push(btn(currentPage - 1, '← Prev', false, currentPage === 1));

  let prev = 0;
  sorted.forEach(p => {
    if (prev && p - prev > 1) pages.push(`<span class="page-ellipsis">…</span>`);
    pages.push(btn(p, p, p === currentPage, false));
    prev = p;
  });

  pages.push(btn(currentPage + 1, 'Next →', false, currentPage === totalPages));
  el.innerHTML = pages.join('');
}

function goToPage(page) {
  currentPage  = page;
  renderTable();
  document.getElementById('repo-table-section').scrollIntoView({ behavior: 'smooth' });
}

// ── sort ──────────────────────────────────────────────────────────────────
document.querySelectorAll('th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    sortDir  = sortKey === key ? sortDir * -1 : (key === 'status' ? 1 : -1);
    sortKey  = key;
    currentPage = 1;
    document.querySelectorAll('th').forEach(t => t.classList.remove('sort-asc', 'sort-desc'));
    th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
    renderTable();
  });
});

// ── filters ───────────────────────────────────────────────────────────────
document.getElementById('search').addEventListener('input', e => {
  filterSearch = e.target.value.trim();
  currentPage  = 1;
  renderTable();
});

document.getElementById('group-select').addEventListener('change', e => {
  filterGroup = e.target.value;
  currentPage  = 1;
  renderTable();
});

document.querySelectorAll('.pill').forEach(pill => {
  pill.addEventListener('click', () => {
    filterStatus = pill.dataset.status;
    currentPage  = 1;
    document.querySelectorAll('.pill').forEach(p => p.className = 'pill');
    const cls = { '': 'active-all', passing: 'active-pass', degraded: 'active-deg' }[filterStatus] || 'active-all';
    pill.classList.add(cls);
    renderTable();
  });
});

// ── init ──────────────────────────────────────────────────────────────────
loadData();
