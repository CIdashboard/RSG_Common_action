// ── get repo name from URL ─────────────────────────────────────────────────
const repoName = new URLSearchParams(window.location.search).get('repo');

const pageState = {
  repo: null,
  allRuns: [],
  allPrs: [],
  totalMergedPrs: 0,
  filteredRuns: [],
  filteredPrs: [],
  activeView: 'runs',
  from: '',
  to: '',
  quickRange: '',
  branchQuery: '',
  resultFilter: 'all',
  workflowFilter: 'all',
};

if (!repoName) {
  document.body.innerHTML = '<div class="main"><p class="state-msg">No repo specified. <a href="index.html">Go back</a></p></div>';
}

// ── load all data for this repo ────────────────────────────────────────────
async function loadRepoPage() {
  if (!repoName) return;

  document.title = `${repoName} — CI Dashboard`;
  document.getElementById('repo-title').textContent = repoName;

  try {
    const [indexResp, runsResp, prsResp] = await Promise.all([
      fetch(`data/index.json?t=`           + Date.now()),
      fetch(`data/runs/${repoName}.json?t=` + Date.now()),
      fetch(`data/prs/${repoName}.json?t=`  + Date.now()),
    ]);

    const indexData = indexResp.ok ? await indexResp.json() : null;
    const runsData  = runsResp.ok  ? await runsResp.json()  : { runs: [] };
    const prsData   = prsResp.ok   ? await prsResp.json()   : { open_prs: [], merged_prs_total: 0 };

    const repo = indexData?.repos?.find(r => r.name === repoName) || null;
    const runs = runsData.runs     || [];
    const prs  = prsData.open_prs  || [];

    pageState.repo = repo;
    pageState.allRuns = runs;
    pageState.allPrs = prs;
    pageState.totalMergedPrs = Number(prsData.merged_prs_total || 0);

    // header org name + sync time
    if (indexData) {
      document.getElementById('org-name').textContent  = indexData.org || '—';
      document.getElementById('sync-time').textContent =
        indexData.synced_at ? `Synced ${fmtDateTime(indexData.synced_at)} IST` : 'Never synced';
    }

    wireControls();
    applyFiltersAndRender();

  } catch (e) {
    document.getElementById('repo-hero').innerHTML =
      `<p class="state-msg">Failed to load data — ${e.message}</p>`;
  }
}

// ── hero section ───────────────────────────────────────────────────────────
function renderHero(repo, runs, prs, activeView) {
  const lastRunAt  = repo?.last_run_at ?? null;
  const fullName   = repo?.full_name || repoName;
  const group      = repo?.group ?? '—';

  const runSuccessCount = runs.filter(r => r.conclusion === 'success').length;
  const runPassRate = runs.length > 0 ? (runSuccessCount / runs.length) * 100 : null;
  const runAvgDuration = runs.length > 0
    ? runs.reduce((sum, r) => sum + (r.duration_seconds || 0), 0) / runs.length
    : null;

  const stalePrs = prs.filter(pr => (pr.days_open || 0) > 7).length;
  const avgPrAge = prs.length > 0
    ? prs.reduce((sum, pr) => sum + (pr.days_open || 0), 0) / prs.length
    : null;

  const statsHtml = activeView === 'runs'
    ? `
      <div class="repo-stat">
        <div class="repo-stat-label">Pass rate (range)</div>
        <div class="repo-stat-value ${rateColorClass(runPassRate)}">${fmtRate(runPassRate)}</div>
      </div>
      <div class="repo-stat">
        <div class="repo-stat-label">Avg build (range)</div>
        <div class="repo-stat-value">${fmtDuration(runAvgDuration)}</div>
      </div>
      <div class="repo-stat">
        <div class="repo-stat-label">Successful runs</div>
        <div class="repo-stat-value c-green">${runSuccessCount}</div>
      </div>
      <div class="repo-stat">
        <div class="repo-stat-label">Total Workflow Runs</div>
        <div class="repo-stat-value">${runs.length}</div>
      </div>
    `
    : `
      <div class="repo-stat">
        <div class="repo-stat-label">Avg PR age</div>
        <div class="repo-stat-value">${avgPrAge == null ? '—' : `${avgPrAge.toFixed(1)}d`}</div>
      </div>
      <div class="repo-stat">
        <div class="repo-stat-label">Stale PRs (&gt; 7d)</div>
        <div class="repo-stat-value ${stalePrs > 0 ? 'c-red' : 'c-green'}">${stalePrs}</div>
      </div>
      <div class="repo-stat">
        <div class="repo-stat-label">Total Merged PRs</div>
        <div class="repo-stat-value c-green">${pageState.totalMergedPrs}</div>
      </div>
      <div class="repo-stat">
        <div class="repo-stat-label">Total Open PRs</div>
        <div class="repo-stat-value ${stalePrs > 0 ? 'c-amber' : ''}">${prs.length}</div>
      </div>
    `;

  const heroSub = document.getElementById('repo-hero-sub');
  if (heroSub) {
    heroSub.innerHTML = `
      <span>Last workflow run: <strong>${fmtRelative(lastRunAt)}</strong></span>
      <a href="https://github.com/${escapeHtml(fullName)}/actions" target="_blank" rel="noopener">GitHub Actions ↗</a>
    `;
  }

  const groupEl = document.getElementById('repo-group-text');
  if (groupEl) {
    groupEl.textContent = `group: ${group}`;
  }

  const statsContainer = document.getElementById('repo-stats-container');
  if (statsContainer) {
    statsContainer.innerHTML = statsHtml;
  }
}

// ── view + filters ─────────────────────────────────────────────────────────
function wireControls() {
  const applyBtn = document.getElementById('filter-apply');
  const resetBtn = document.getElementById('filter-reset');
  const fromInput = document.getElementById('filter-from');
  const toInput = document.getElementById('filter-to');
  const quick7Btn = document.getElementById('quick-7');
  const quick14Btn = document.getElementById('quick-14');
  const quick30Btn = document.getElementById('quick-30');
  const runsChip = document.getElementById('chip-runs');
  const prsChip = document.getElementById('chip-prs');
  const branchSearchInput = document.getElementById('workflow-branch-search');
  const resultFilterSelect = document.getElementById('workflow-result-filter');
  const workflowTypeSelect = document.getElementById('workflow-type-filter');

  const applyQuickRange = (days) => {
    const { from, to } = getLastNDaysRange(days);
    pageState.from = from;
    pageState.to = to;
    pageState.quickRange = String(days);
    if (fromInput) fromInput.value = from;
    if (toInput) toInput.value = to;
    applyFiltersAndRender();
  };

  quick7Btn?.addEventListener('click', () => applyQuickRange(7));
  quick14Btn?.addEventListener('click', () => applyQuickRange(14));
  quick30Btn?.addEventListener('click', () => applyQuickRange(30));

  fromInput?.addEventListener('input', () => {
    pageState.quickRange = '';
    updateQuickRangeActiveState();
  });

  toInput?.addEventListener('input', () => {
    pageState.quickRange = '';
    updateQuickRangeActiveState();
  });

  applyBtn?.addEventListener('click', () => {
    pageState.from = fromInput?.value || '';
    pageState.to = toInput?.value || '';
    pageState.quickRange = '';
    updateQuickRangeActiveState();

    if (pageState.from && pageState.to && pageState.from > pageState.to) {
      const summary = document.getElementById('filter-summary');
      if (summary) {
        summary.textContent = 'Invalid range: From date is after To date';
        summary.classList.add('invalid');
      }
      return;
    }

    applyFiltersAndRender();
  });

  resetBtn?.addEventListener('click', () => {
    pageState.from = '';
    pageState.to = '';
    pageState.quickRange = '';
    pageState.branchQuery = '';
    pageState.resultFilter = 'all';
    pageState.workflowFilter = 'all';
    if (fromInput) fromInput.value = '';
    if (toInput) toInput.value = '';
    if (branchSearchInput) branchSearchInput.value = '';
    if (resultFilterSelect) resultFilterSelect.value = 'all';
    if (workflowTypeSelect) workflowTypeSelect.value = 'all';
    updateQuickRangeActiveState();
    applyFiltersAndRender();
  });

  branchSearchInput?.addEventListener('input', () => {
    pageState.branchQuery = branchSearchInput.value || '';
    applyFiltersAndRender();
  });

  resultFilterSelect?.addEventListener('change', () => {
    pageState.resultFilter = resultFilterSelect.value || 'all';
    applyFiltersAndRender();
  });

  workflowTypeSelect?.addEventListener('change', () => {
    pageState.workflowFilter = workflowTypeSelect.value || 'all';
    applyFiltersAndRender();
  });

  runsChip?.addEventListener('click', () => {
    pageState.activeView = 'runs';
    renderVisibleView();
  });

  prsChip?.addEventListener('click', () => {
    pageState.activeView = 'prs';
    renderVisibleView();
  });
}

function applyFiltersAndRender() {
  const runsInDateRange = filterByDateRange(pageState.allRuns, pageState.from, pageState.to);
  pageState.filteredRuns = filterRuns(runsInDateRange, {
    branchQuery: pageState.branchQuery,
    resultFilter: pageState.resultFilter,
    workflowFilter: pageState.workflowFilter,
  });
  pageState.filteredPrs = filterByDateRange(pageState.allPrs, pageState.from, pageState.to);

  renderRunsTable(pageState.filteredRuns);
  renderPRsTable(pageState.filteredPrs);
  renderVisibleView();
  renderFilterSummary();
}

function filterRuns(runs, filters) {
  const branchNeedle = (filters.branchQuery || '').trim().toLowerCase();
  const selectedWorkflow = normalizeWorkflowFilter(filters.workflowFilter);

  return (runs || []).filter(run => {
    if (filters.resultFilter && filters.resultFilter !== 'all') {
      if ((run?.conclusion || '') !== filters.resultFilter) return false;
    }

    if (branchNeedle) {
      const branch = (run?.branch || '').toLowerCase();
      if (!branch.includes(branchNeedle)) return false;
    }

    if (selectedWorkflow && selectedWorkflow !== 'all') {
      const workflowFile = getWorkflowFileKey(run);
      if (workflowFile !== selectedWorkflow) return false;
    }

    return true;
  });
}

function normalizeWorkflowFilter(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'all') return 'all';

  if (raw === 'pr_pipeline.yml' || raw === 'pr_pipeline' || raw === 'pr pipeline') return 'pr_pipeline';
  if (raw === 'day_pipeline.yml' || raw === 'day_pipeline' || raw === 'day pipeline') return 'day_pipeline';
  if (raw === 'codeql.yml' || raw === 'codeql' || raw === 'ghas') return 'codeql';
  if (raw === 'ci_automation.yml' || raw === 'ci_automation' || raw === 'ci automation') return 'ci_automation';

  return raw;
}

function getWorkflowFileKey(run) {
  const raw = String(
    run?.workflow_file ||
    run?.workflow ||
    run?.path ||
    run?.name ||
    ''
  ).toLowerCase();

  // PR Pipeline (handles PR_pipeline, pr_pipeline, PR Pipeline, pr pipeline, etc.)
  if (raw.includes('pr_pipeline') || raw.includes('pr pipeline') || raw.includes('prpipeline')) {
    return 'pr_pipeline';
  }
  
  // Day Pipeline (handles DAY_pipeline, day_pipeline, DAY Pipeline, day pipeline, etc.)
  if (raw.includes('day_pipeline') || raw.includes('day pipeline') || raw.includes('daypipeline')) {
    return 'day_pipeline';
  }
  
  // CodeQL/GHAS
  if (raw.includes('codeql') || raw.includes('ghas')) {
    return 'codeql';
  }
  
  // CI Automation
  if (raw.includes('ci_automation') || raw.includes('ci automation') || raw.includes('ciautomation')) {
    return 'ci_automation';
  }

  return '';
}

function getLastNDaysRange(days) {
  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - (days - 1));

  return {
    from: dateToInputValue(fromDate),
    to: dateToInputValue(toDate),
  };
}

function dateToInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function updateQuickRangeActiveState() {
  document.querySelectorAll('.quick-range-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  if (!pageState.quickRange) return;

  const activeBtn = document.getElementById(`quick-${pageState.quickRange}`);
  activeBtn?.classList.add('active');
}

function filterByDateRange(items, from, to) {
  const fromTs = from ? Date.parse(`${from}T00:00:00`) : null;
  const toTs = to ? Date.parse(`${to}T23:59:59.999`) : null;

  return (items || []).filter(item => {
    if (!item?.created_at) return true;
    const ts = Date.parse(item.created_at);
    if (Number.isNaN(ts)) return true;
    if (fromTs != null && ts < fromTs) return false;
    if (toTs != null && ts > toTs) return false;
    return true;
  });
}

function renderVisibleView() {
  const isRuns = pageState.activeView === 'runs';

  const runsTab = document.getElementById('tab-runs');
  const prsTab = document.getElementById('tab-prs');
  const runsChip = document.getElementById('chip-runs');
  const prsChip = document.getElementById('chip-prs');
  const chipWrap = document.getElementById('repo-view-chip');
  const analyticsTitle = document.getElementById('repo-analytics-title');
  const workflowFilterRow = document.getElementById('workflow-filter-row');

  runsTab?.classList.toggle('active', isRuns);
  prsTab?.classList.toggle('active', !isRuns);

  runsChip?.classList.toggle('active', isRuns);
  prsChip?.classList.toggle('active', !isRuns);
  if (chipWrap) {
    chipWrap.style.setProperty('--chip-offset', isRuns ? '0%' : '100%');
  }
  if (runsChip) runsChip.setAttribute('aria-selected', String(isRuns));
  if (prsChip) prsChip.setAttribute('aria-selected', String(!isRuns));

  if (analyticsTitle) {
    analyticsTitle.textContent = isRuns ? 'Workflow Analytics' : 'PR Analytics';
  }

  if (workflowFilterRow) {
    workflowFilterRow.classList.toggle('is-hidden', !isRuns);
  }

  document.querySelectorAll('.analytics-card').forEach(card => {
    const view = card.getAttribute('data-view');
    const shouldShow = view === pageState.activeView;
    card.classList.toggle('is-hidden', !shouldShow);
  });

  renderHero(pageState.repo, pageState.filteredRuns, pageState.filteredPrs, pageState.activeView);
  renderRepoCharts(pageState.filteredRuns, pageState.filteredPrs, pageState.activeView);
  renderFilterSummary();
}

function renderFilterSummary() {
  const summary = document.getElementById('filter-summary');
  if (!summary) return;

  updateQuickRangeActiveState();
  summary.classList.remove('invalid');

  if (!pageState.from && !pageState.to) {
    if (pageState.activeView === 'runs') {
      const runClauses = [];
      if (pageState.branchQuery.trim()) runClauses.push(`branch contains "${pageState.branchQuery.trim()}"`);
      if (pageState.resultFilter !== 'all') runClauses.push(`result: ${pageState.resultFilter}`);
      if (pageState.workflowFilter !== 'all') runClauses.push(`workflow: ${pageState.workflowFilter}`);

      summary.textContent = runClauses.length > 0
        ? `All dates · ${runClauses.join(' · ')}`
        : 'All dates';
      return;
    }

    summary.textContent = 'All dates';
    return;
  }

  const from = pageState.from ? new Date(`${pageState.from}T00:00:00`).toLocaleDateString('en-IN') : 'start';
  const to = pageState.to ? new Date(`${pageState.to}T00:00:00`).toLocaleDateString('en-IN') : 'today';

  if (pageState.activeView === 'runs') {
    const runClauses = [];
    if (pageState.branchQuery.trim()) runClauses.push(`branch contains "${pageState.branchQuery.trim()}"`);
    if (pageState.resultFilter !== 'all') runClauses.push(`result: ${pageState.resultFilter}`);
    if (pageState.workflowFilter !== 'all') runClauses.push(`workflow: ${pageState.workflowFilter}`);

    const extra = runClauses.length > 0 ? ` · ${runClauses.join(' · ')}` : '';
    summary.textContent = `Showing runs from ${from} to ${to}${extra}`;
    return;
  }

  summary.textContent = `Showing PRs from ${from} to ${to}`;
}

// ── repo charts ────────────────────────────────────────────────────────────
function renderRepoCharts(runs, prs, activeView) {
  if (activeView === 'runs') {
    renderRunsTrend('chart-runs-trend', runs);
    renderDurationTrend('chart-dur-trend', runs);
    renderResultBreakdown('chart-breakdown', runs);
    return;
  }

  renderRunsTrend('chart-runs-trend', runs);
  renderDurationTrend('chart-dur-trend', runs);
  renderResultBreakdown('chart-breakdown', runs);

  const prCanvas = document.getElementById('chart-pr-age');
  const prEmpty = document.getElementById('pr-empty-state');

  if (prs.length > 0) {
    const prChartWrap = document.getElementById('chart-pr-wrap');
    if (prChartWrap) {
      // dynamic height based on PR count
      const h = Math.max(120, Math.min(prs.length * 28 + 30, 320));
      prChartWrap.style.height = h + 'px';
    }
    if (prCanvas) prCanvas.style.display = 'block';
    if (prEmpty) prEmpty.style.display = 'none';
    renderPRAge('chart-pr-age', prs);
  } else {
    renderPRAge('chart-pr-age', prs);
    if (prCanvas) prCanvas.style.display = 'none';
    if (prEmpty) prEmpty.style.display = 'block';
  }
}

// ── runs table ─────────────────────────────────────────────────────────────
function renderRunsTable(runs) {
  const el = document.getElementById('tab-runs');
  if (!el) return;

  el.innerHTML = runs.length === 0
    ? '<p class="state-msg">No completed runs found.</p>'
    : `<div class="data-table-wrap"><table class="data-table">
        <thead><tr>
          <th>Run ID</th><th>Workflow</th><th>Branch</th>
          <th>Result</th><th>Duration</th><th>Actor</th><th>Started</th>
        </tr></thead>
        <tbody>
          ${runs.map(r => `
            <tr>
              <td><a href="https://github.com/CIDashboard/${repoName}/actions/runs/${r.id}" target="_blank" rel="noopener">#${r.id}</a></td>
              <td>${escapeHtml(r.name || '—')}</td>
              <td>${escapeHtml(r.branch || '—')}</td>
              <td class="${r.conclusion === 'success' ? 'conclusion-pass' : r.conclusion === 'failure' ? 'conclusion-fail' : ''}">${escapeHtml(r.conclusion || '—')}</td>
              <td>${fmtDuration(r.duration_seconds)}</td>
              <td>${escapeHtml(r.actor || '—')}</td>
              <td>${fmtRelative(r.created_at)}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;
}

// ── PRs table ──────────────────────────────────────────────────────────────
function renderPRsTable(prs) {
  const el = document.getElementById('tab-prs');
  if (!el) return;

  el.innerHTML = prs.length === 0
    ? '<p class="state-msg">No open PRs.</p>'
    : `<div class="data-table-wrap"><table class="data-table">
        <thead><tr>
          <th>#</th><th>Title</th><th>Author</th><th>Base Branch</th><th>PR Branch</th><th class="right">Days open</th>
        </tr></thead>
        <tbody>
          ${prs.map(pr => `
            <tr class="${pr.days_open > 7 ? 'pr-stale' : ''}">
              <td><a href="${pr.url}" target="_blank" rel="noopener">#${pr.number}</a></td>
              <td>${escapeHtml(pr.title || '—')}${pr.days_open > 7 ? '<span class="stale-badge">stale</span>' : ''}</td>
              <td>${escapeHtml(pr.author || '—')}</td>
              <td class="branch-cell"><span class="truncate-inline" title="${escapeHtml(pr.base_branch || '—')}">${escapeHtml(pr.base_branch || '—')}</span></td>
              <td class="branch-cell"><span class="truncate-inline" title="${escapeHtml(pr.pr_branch || '—')}">${escapeHtml(pr.pr_branch || '—')}</span></td>
              <td class="right ${pr.days_open > 7 ? 'c-red' : ''}">${pr.days_open}d</td>
            </tr>`).join('')}
        </tbody>
      </table></div>
      <div style="font-size:11px;color:var(--text-3);margin-top:10px;">
        PRs open more than 7 days are highlighted red.
      </div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ── init ───────────────────────────────────────────────────────────────────
loadRepoPage();
