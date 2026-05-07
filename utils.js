// ── formatting helpers ────────────────────────────────────────────────────

function fmtDuration(s) {
  if (s == null) return '—';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

function fmtRate(r) {
  if (r == null) return '—';
  return r.toFixed(1) + '%';
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60)    return `${Math.round(diff)}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short'
  });
}

// ── status helpers ────────────────────────────────────────────────────────

function statusOrder(s) {
  return { failing: 0, degraded: 1, unknown: 2, passing: 3 }[s] ?? 4;
}

function barColor(r) {
  if (r == null) return '#888';
  if (r >= 90)   return 'var(--green)';
  if (r >= 80)   return 'var(--amber)';
  return 'var(--red)';
}

function dotClass(s) {
  return { passing: 'dot-pass', degraded: 'dot-deg', failing: 'dot-fail' }[s] || 'dot-unknown';
}

function badgeClass(s) {
  return { passing: 'badge-pass', degraded: 'badge-deg', failing: 'badge-fail' }[s] || 'badge-unk';
}

function rateColorClass(r) {
  if (r == null)  return '';
  if (r < 80)     return 'c-red';
  if (r < 90)     return 'c-amber';
  return 'c-green';
}

// ── dark mode detection ───────────────────────────────────────────────────

function isDarkMode() {
  return false;
}

function chartColors() {
  return {
    text:    '#2f455f',
    grid:    'rgba(16, 34, 55, 0.10)',
    bg:      '#ffffff',
    green:   '#1f7a4a',
    amber:   '#995b03',
    red:     '#b73b33',
    blue:    '#1768bd',
    neutral: '#75879a',
  };
}
