// chart instance registry — destroy before recreating
const _charts = {};

function _destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

// ── HOMEPAGE CHARTS ───────────────────────────────────────────────────────

/**
 * Donut: passing / degraded / failing / unknown counts
 */
function renderOrgDonut(canvasId, summary) {
  _destroyChart(canvasId);
  const c = chartColors();
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  _charts[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Passing', 'Degraded', 'Failing', 'Unknown'],
      datasets: [{
        data: [summary.passing, summary.degraded, summary.failing, summary.unknown],
        backgroundColor: [c.green, c.amber, c.red, c.neutral],
        borderWidth: 0,
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'right',
          labels: { color: c.text, font: { size: 11 }, padding: 12, boxWidth: 10 },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.parsed} repos`,
          },
        },
      },
    },
  });
}

/**
 * Bar: how many repos fall in each pass-rate bucket
 */
function renderPassDistribution(canvasId, repos) {
  _destroyChart(canvasId);
  const c = chartColors();
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const buckets  = ['0–60%', '60–70%', '70–80%', '80–90%', '90–100%'];
  const counts   = [0, 0, 0, 0, 0];
  const bgColors = [c.red, c.red, c.amber, c.amber, c.green];

  repos.forEach(r => {
    const p = r.pass_rate;
    if (p == null) return;
    if (p < 60)       counts[0]++;
    else if (p < 70)  counts[1]++;
    else if (p < 80)  counts[2]++;
    else if (p < 90)  counts[3]++;
    else              counts[4]++;
  });

  _charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: buckets,
      datasets: [{
        label: 'Repos',
        data: counts,
        backgroundColor: bgColors,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.parsed.y} repos` } },
      },
      scales: {
        x: { ticks: { color: c.text, font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: c.text, font: { size: 11 }, stepSize: 1 }, grid: { color: c.grid }, beginAtZero: true },
      },
    },
  });
}

/**
 * Bar: how many repos fall in each avg build duration bucket
 */
function renderDurationDistribution(canvasId, repos) {
  _destroyChart(canvasId);
  const c = chartColors();
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const buckets = ['0–2m', '2–5m', '5–10m', '10–20m', '20m+'];
  const counts  = [0, 0, 0, 0, 0];

  repos.forEach(r => {
    const d = r.avg_duration_seconds;
    if (d == null) return;
    if (d < 120)       counts[0]++;
    else if (d < 300)  counts[1]++;
    else if (d < 600)  counts[2]++;
    else if (d < 1200) counts[3]++;
    else               counts[4]++;
  });

  _charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: buckets,
      datasets: [{
        label: 'Repos',
        data: counts,
        backgroundColor: c.blue,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.parsed.y} repos` } },
      },
      scales: {
        x: { ticks: { color: c.text, font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: c.text, font: { size: 11 }, stepSize: 1 }, grid: { color: c.grid }, beginAtZero: true },
      },
    },
  });
}




// ── REPO PAGE CHARTS ──────────────────────────────────────────────────────

/**
 * Line chart: success (1) / failure (0) for each run — oldest → newest
 */
function renderRunsTrend(canvasId, runs) {
  _destroyChart(canvasId);
  const c = chartColors();
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const ordered = [...runs].reverse().slice(-30); // oldest first, max 30
  const labels  = ordered.map((_, i) => `#${i + 1}`);
  const data    = ordered.map(r => r.conclusion === 'success' ? 1 : 0);

  _charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Result',
        data,
        borderColor: c.blue,
        backgroundColor: isDarkMode() ? 'rgba(133,183,235,0.08)' : 'rgba(24,95,165,0.06)',
        pointBackgroundColor: data.map(v => v === 1 ? c.green : c.red),
        pointRadius: 4,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ctx.parsed.y === 1 ? ' success' : ' failure',
          },
        },
      },
      scales: {
        x: { ticks: { color: c.text, font: { size: 10 }, maxTicksLimit: 10 }, grid: { display: false } },
        y: {
          min: -0.1, max: 1.1,
          ticks: { color: c.text, font: { size: 11 }, callback: v => v === 1 ? 'pass' : v === 0 ? 'fail' : '' },
          grid: { color: c.grid },
        },
      },
    },
  });
}

/**
 * Line chart: build duration per run — oldest → newest
 */
function renderDurationTrend(canvasId, runs) {
  _destroyChart(canvasId);
  const c = chartColors();
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const ordered = [...runs].reverse().slice(-30);
  const labels  = ordered.map((_, i) => `#${i + 1}`);
  const data    = ordered.map(r => r.duration_seconds);

  _charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Duration',
        data,
        borderColor: c.amber,
        backgroundColor: isDarkMode() ? 'rgba(239,159,39,0.08)' : 'rgba(133,79,11,0.06)',
        pointBackgroundColor: c.amber,
        pointRadius: 3,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${fmtDuration(ctx.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: c.text, font: { size: 10 }, maxTicksLimit: 10 }, grid: { display: false } },
        y: {
          ticks: { color: c.text, font: { size: 11 }, callback: v => fmtDuration(v) },
          grid: { color: c.grid },
          beginAtZero: true,
        },
      },
    },
  });
}

/**
 * Donut: success / failure / other result breakdown
 */
function renderResultBreakdown(canvasId, runs) {
  _destroyChart(canvasId);
  const c = chartColors();
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const counts = { success: 0, failure: 0, other: 0 };
  runs.forEach(r => {
    if (r.conclusion === 'success')      counts.success++;
    else if (r.conclusion === 'failure') counts.failure++;
    else                                  counts.other++;
  });

  _charts[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Success', 'Failure', 'Other'],
      datasets: [{
        data: [counts.success, counts.failure, counts.other],
        backgroundColor: [c.green, c.red, c.neutral],
        borderWidth: 0,
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: { color: c.text, font: { size: 11 }, padding: 12, boxWidth: 10 },
        },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } },
      },
    },
  });
}

/**
 * Horizontal bar: days_open per open PR (red if > 7 days)
 */
function renderPRAge(canvasId, prs) {
  _destroyChart(canvasId);
  const c = chartColors();
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  if (!prs.length) {
    // clear canvas with a message — handled in HTML, just return
    return;
  }

  const labels = prs.map(p => `#${p.number}`);
  const data   = prs.map(p => p.days_open);
  const colors = prs.map(p => p.days_open > 7 ? c.red : c.green);

  _charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Days open',
        data,
        backgroundColor: colors,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const pr = prs[items[0].dataIndex];
              return `#${pr.number}: ${pr.title.slice(0, 40)}`;
            },
            label: ctx => ` Open ${ctx.parsed.x} day${ctx.parsed.x !== 1 ? 's' : ''}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: c.text, font: { size: 11 }, stepSize: 1 },
          grid: { color: c.grid },
          beginAtZero: true,
        },
        y: { ticks: { color: c.text, font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}
