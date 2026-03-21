// ══════════════════════════════════════════════════════
// State
// ══════════════════════════════════════════════════════
let selectedFile = null;
let currentTimestamps = [];
let pollingInterval = null;
let adminAllJobs = [];
let allUserJobs = [];
let prevJobStatuses = {};
let notifications = [];
let currentHistFilter = 'all';
let currentHistSearch = '';
let currentDetailJob = null;
let avatarColor = '#7c3aed';

// ══════════════════════════════════════════════════════
// Auth helpers
// ══════════════════════════════════════════════════════
function getUser() {
  try { return JSON.parse(localStorage.getItem('ts_user') || 'null'); } catch { return null; }
}
function setUser(u) { localStorage.setItem('ts_user', JSON.stringify(u)); }
function clearUser() { localStorage.removeItem('ts_user'); }

function getAdminKey() { return sessionStorage.getItem('ts_admin_key') || ''; }
function setAdminKey(k) { sessionStorage.setItem('ts_admin_key', k); }
function clearAdminKey() { sessionStorage.removeItem('ts_admin_key'); }
function isAdmin() { return !!getAdminKey(); }

// ══════════════════════════════════════════════════════
// Navigation — separate HTML pages
// ══════════════════════════════════════════════════════
const CURRENT_PAGE = document.body.dataset.page || 'home';

const PAGE_URLS = {
  'page-home':        './',
  'page-login':       '/login',
  'page-admin-login': '/admin-login',
  'page-user':        '/dashboard',
  'page-admin':       '/admin',
  'page-pricing':     '/pricing',
  'page-privacy':     '/privacy',
  'page-terms':       '/terms',
  'page-contact':     '/contact',
};

function goto(page) {
  window.location.href = PAGE_URLS[page] || './';
}

// ── Global nav-link handler (data-page="page-xxx") ──
document.addEventListener('click', e => {
  const btn = e.target.closest('.nav-link-page');
  if (!btn) return;
  e.preventDefault();
  const target = btn.dataset.page;
  if (target) goto(target);
});

// ══════════════════════════════════════════════════════
// HOMEPAGE
// ══════════════════════════════════════════════════════
document.getElementById('home-start-btn')?.addEventListener('click', () => goto('page-login'));
document.getElementById('home-signin-btn')?.addEventListener('click', () => goto('page-login'));
document.getElementById('home-cta-btn')?.addEventListener('click', () => goto('page-login'));
document.getElementById('home-admin-btn')?.addEventListener('click', () => goto('page-admin-login'));
document.getElementById('final-cta-start-btn')?.addEventListener('click', () => goto('page-login'));

// ══════════════════════════════════════════════════════
// PUBLIC PRICING PAGE
// ══════════════════════════════════════════════════════
document.getElementById('pricing-signin-btn')?.addEventListener('click', () => goto('page-login'));

// Plan buy buttons on the public pricing page — redirect to login if not signed in
document.querySelectorAll('.plan-buy-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const user = getUser();
    if (!user) { goto('page-login'); return; }
    const plan = btn.dataset.plan;
    const provider = btn.dataset.provider;
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Loading…';
    try {
      const endpoint = provider === 'lemonsqueezy'
        ? `/api/payments/lemon/checkout`
        : `/api/payments/crypto/checkout`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, userEmail: user.email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Checkout failed');
      window.open(data.url, '_blank');
    } catch (err) {
      showToast('Error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
});

// ══════════════════════════════════════════════════════
// LOGIN PAGE
// ══════════════════════════════════════════════════════
document.getElementById('login-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('login-name').value.trim();
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const err = document.getElementById('login-error');
  err.classList.add('hidden');

  if (!name) { err.textContent = 'Please enter your name.'; err.classList.remove('hidden'); return; }
  if (!email || !email.includes('@')) { err.textContent = 'Please enter a valid email address.'; err.classList.remove('hidden'); return; }

  setUser({ name, email });
  goto('page-user');
});

document.getElementById('go-admin-login')?.addEventListener('click', () => goto('page-admin-login'));
document.getElementById('login-back-home')?.addEventListener('click', () => goto('page-home'));

// ══════════════════════════════════════════════════════
// ADMIN LOGIN PAGE
// ══════════════════════════════════════════════════════
document.getElementById('admin-login-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const key = document.getElementById('admin-key-input').value;
  const errEl = document.getElementById('admin-login-error');
  const btn = document.getElementById('adm-login-submit-btn');
  const btnText = document.getElementById('adm-login-btn-text');
  const btnSpinner = document.getElementById('adm-login-btn-spinner');
  const btnArrow = document.getElementById('adm-login-btn-arrow');
  errEl.classList.add('hidden');

  if (btn) btn.disabled = true;
  if (btnText) btnText.classList.add('hidden');
  if (btnSpinner) btnSpinner.classList.remove('hidden');
  if (btnArrow) btnArrow.classList.add('hidden');

  try {
    await adminApi('GET', '/api/admin/stats', key);
    setAdminKey(key);
    document.getElementById('admin-key-input').value = '';
    goto('page-admin');
  } catch {
    errEl.classList.remove('hidden');
    if (btn) btn.disabled = false;
    if (btnText) btnText.classList.remove('hidden');
    if (btnSpinner) btnSpinner.classList.add('hidden');
    if (btnArrow) btnArrow.classList.remove('hidden');
  }
});

document.getElementById('go-user-login')?.addEventListener('click', () => goto('page-login'));
document.getElementById('admin-back-home')?.addEventListener('click', () => goto('page-home'));

// ══════════════════════════════════════════════════════
// USER PANEL
// ══════════════════════════════════════════════════════
function initUser(user) {
  applyDarkMode();
  loadNotifications();
  loadAvatarColor();
  updateUserUI(user);
  loadUserJobs();
  loadCredits();

  // Read section from URL path e.g. /dashboard/history → history
  const pathSec = window.location.pathname.split('/').filter(Boolean).pop();
  const startView = DASH_URL_VIEWS.includes(pathSec) ? pathSec : 'generate';
  if (startView !== 'generate') switchDashView(startView, false);
}

function updateUserUI(user) {
  const initials = user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
  document.getElementById('user-avatar').textContent = initials;
  document.getElementById('user-avatar').style.background = avatarColor;
  document.getElementById('header-name').textContent = user.name;
  document.getElementById('header-email').textContent = user.email;
  const sa = document.getElementById('settings-avatar');
  if (sa) { sa.textContent = initials; sa.style.background = avatarColor; }
  const sn = document.getElementById('settings-name');
  const se = document.getElementById('settings-email');
  if (sn) sn.value = user.name;
  if (se) se.value = user.email;
}

document.getElementById('user-logout-btn')?.addEventListener('click', () => {
  clearUser();
  stopPolling();
  goto('page-home');
});

// ── Sidebar navigation ──
const VIEW_META = {
  generate:     { title: 'Generate Timestamps', sub: 'Paste a YouTube URL or upload a video file' },
  history:      { title: 'My History',           sub: 'All your timestamp jobs' },
  stats:        { title: 'Usage Stats',           sub: 'Your activity and job breakdown' },
  pricing:      { title: 'Buy Credits',           sub: 'Choose a plan to power your jobs' },
  settings:     { title: 'Settings',             sub: 'Manage your profile and preferences' },
  'job-detail': { title: 'Job Detail',           sub: 'View timestamps for this job' },
};

const DASH_URL_VIEWS = ['generate','history','stats','pricing','settings'];

function switchDashView(view, pushState = true) {
  document.querySelectorAll('.dash-nav-item').forEach(b => b.classList.remove('active'));
  const navBtn = document.querySelector(`.dash-nav-item[data-dash-view="${view}"]`);
  if (navBtn) navBtn.classList.add('active');

  document.querySelectorAll('.dash-view').forEach(v => v.classList.add('hidden'));
  const el = document.getElementById('dash-view-' + view);
  if (el) el.classList.remove('hidden');
  const meta = VIEW_META[view] || {};
  document.getElementById('dash-page-title').textContent = meta.title || '';
  document.getElementById('dash-page-sub').textContent   = meta.sub   || '';

  if (view === 'stats') renderStatsView(allUserJobs);
  if (view === 'settings') refreshSettingsView();
  if (view === 'history') applyHistFilter();
  if (view === 'pricing') loadAndShowCredits();

  if (pushState && DASH_URL_VIEWS.includes(view)) {
    const base = (window.BASE_PATH || '').replace(/\/+$/, '');
    history.pushState({ dashView: view }, '', `${base}/dashboard/${view}`);
  }
}

document.querySelectorAll('.dash-nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchDashView(btn.dataset.dashView));
});

window.addEventListener('popstate', e => {
  if (e.state && e.state.dashView) switchDashView(e.state.dashView, false);
});

// Click user card → go to settings
document.getElementById('dash-user-card-btn')?.addEventListener('click', () => switchDashView('settings'));

// ── Source tabs ──
document.querySelectorAll('.dash-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.getElementById('tab-yt').classList.toggle('active', tab === 'youtube');
    document.getElementById('tab-up').classList.toggle('active', tab === 'upload');
    document.getElementById('panel-youtube').classList.toggle('hidden', tab !== 'youtube');
    document.getElementById('panel-upload').classList.toggle('hidden', tab !== 'upload');
  });
});

// ── YouTube submit ──
document.getElementById('btn-youtube')?.addEventListener('click', submitYoutube);
document.getElementById('youtube-url')?.addEventListener('keydown', e => { if (e.key === 'Enter') submitYoutube(); });

async function submitYoutube() {
  const url = document.getElementById('youtube-url').value.trim();
  const errEl = document.getElementById('youtube-error');
  errEl.classList.add('hidden');

  if (!url) { showErr(errEl, 'Please enter a YouTube URL.'); return; }
  if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
    showErr(errEl, 'Please enter a valid YouTube URL.'); return;
  }

  setLoading('youtube', true);
  try {
    await userApi('POST', '/api/jobs/submit-youtube', { youtubeUrl: url });
    document.getElementById('youtube-url').value = '';
    showToast('✓ Job submitted! Generating timestamps…');
    await loadUserJobs();
    startPolling();
  } catch (err) {
    showErr(errEl, err.message || 'Failed to submit. Please try again.');
  } finally {
    setLoading('youtube', false);
  }
}

// ── File Upload ──
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone?.addEventListener('click', () => fileInput.click());
dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone?.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) setSelectedFile(f);
});
fileInput?.addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) setSelectedFile(f);
});
document.getElementById('clear-file-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  clearFile();
});

function setSelectedFile(file) {
  selectedFile = file;
  document.getElementById('selected-filename').textContent = file.name;
  document.getElementById('selected-filesize').textContent = formatBytes(file.size);
  document.getElementById('drop-zone-empty').classList.add('hidden');
  document.getElementById('drop-zone-selected').classList.remove('hidden');
}

function clearFile() {
  selectedFile = null;
  fileInput.value = '';
  document.getElementById('drop-zone-empty').classList.remove('hidden');
  document.getElementById('drop-zone-selected').classList.add('hidden');
}

document.getElementById('btn-upload')?.addEventListener('click', submitUpload);

async function submitUpload() {
  const errEl = document.getElementById('upload-error');
  errEl.classList.add('hidden');
  if (!selectedFile) { showErr(errEl, 'Please select a video file first.'); return; }

  const title = document.getElementById('upload-title').value.trim() || null;
  const progressWrap = document.getElementById('upload-progress-wrap');
  const progressBar = document.getElementById('progress-bar');
  const labelText = document.getElementById('progress-label-text');
  const pctEl = document.getElementById('progress-pct');

  setLoading('upload', true);
  progressWrap.classList.remove('hidden');

  try {
    labelText.textContent = 'Computing checksum…';
    setProgress(progressBar, pctEl, 0);

    const contentMd5 = await computeFileMD5(selectedFile, pct => setProgress(progressBar, pctEl, Math.round(pct * 0.3)));

    labelText.textContent = 'Initializing upload…';
    setProgress(progressBar, pctEl, 30);
    const initRes = await userApi('POST', '/api/jobs/upload-init', {
      filename: selectedFile.name,
      contentType: selectedFile.type || 'video/mp4',
      contentMd5,
      fileSizeBytes: selectedFile.size,
    });

    labelText.textContent = 'Uploading to storage…';
    setProgress(progressBar, pctEl, 35);
    await uploadToS3(initRes.presignedUrl, selectedFile, initRes.requiredHeaders, pct => {
      setProgress(progressBar, pctEl, 35 + Math.round(pct * 0.6));
    });

    labelText.textContent = 'Starting processing…';
    setProgress(progressBar, pctEl, 95);
    await userApi('POST', '/api/jobs/upload-complete', { videoId: initRes.videoId, title });

    setProgress(progressBar, pctEl, 100);
    labelText.textContent = 'Done!';
    document.getElementById('upload-title').value = '';
    clearFile();
    showToast('✓ Upload complete! Generating timestamps…');
    await loadUserJobs();
    startPolling();
  } catch (err) {
    showErr(errEl, err.message || 'Upload failed. Please try again.');
  } finally {
    setLoading('upload', false);
    setTimeout(() => progressWrap.classList.add('hidden'), 2000);
  }
}

// ── User Jobs ──
document.getElementById('user-refresh-btn')?.addEventListener('click', loadUserJobs);

async function loadUserJobs() {
  try {
    const jobs = await userApi('GET', '/api/jobs');
    renderUserJobs(jobs);
    const needsPoll = jobs.some(j => j.status === 'pending' || j.status === 'processing');
    if (needsPoll) startPolling(); else stopPolling();
  } catch (err) {
    console.error('Failed to load jobs:', err);
  }
}

function renderUserJobs(jobs) {
  allUserJobs = jobs || [];

  // Detect status changes → notifications
  detectJobNotifications(allUserJobs);

  // Update mini stats
  const total   = allUserJobs.length;
  const done    = allUserJobs.filter(j => j.status === 'finished').length;
  const running = allUserJobs.filter(j => j.status === 'pending' || j.status === 'processing').length;
  document.getElementById('user-stat-total').textContent   = total   || '0';
  document.getElementById('user-stat-done').textContent    = done    || '0';
  document.getElementById('user-stat-running').textContent = running || '0';

  const emptyHtml = `<div class="empty-state">
    <div class="empty-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
    <p>No jobs yet — submit a URL or upload a video above to get started.</p>
  </div>`;

  // Render to generate view (recent 5)
  const el = document.getElementById('user-jobs-list');
  if (!allUserJobs.length) {
    el.innerHTML = emptyHtml;
  } else {
    el.innerHTML = allUserJobs.slice(0, 5).map(job => jobCardHtml(job, false)).join('');
    attachJobCardListeners(el);
  }

  // Render history view (filtered)
  applyHistFilter();
}

function attachJobCardListeners(container) {
  container.querySelectorAll('.job-card.clickable').forEach(card => {
    card.addEventListener('click', () => {
      const job = allUserJobs.find(j => j.id === parseInt(card.dataset.id, 10));
      if (job) openJobDetail(job);
    });
  });
}

function applyHistFilter() {
  const hist = document.getElementById('user-history-list');
  if (!hist) return;

  let filtered = allUserJobs;
  if (currentHistFilter !== 'all') {
    filtered = filtered.filter(j => j.status === currentHistFilter);
  }
  if (currentHistSearch) {
    const q = currentHistSearch.toLowerCase();
    filtered = filtered.filter(j =>
      (j.title || '').toLowerCase().includes(q) ||
      (j.sourceUrl || '').toLowerCase().includes(q)
    );
  }

  if (!filtered.length) {
    const msg = allUserJobs.length ? 'No jobs match your filter.' : 'No history yet.';
    hist.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><p>${msg}</p></div>`;
  } else {
    hist.innerHTML = filtered.map(job => jobCardHtml(job, false)).join('');
    attachJobCardListeners(hist);
  }
}

function jobCardHtml(job, showUser = false) {
  const title = job.title || (job.sourceType === 'youtube' ? job.sourceUrl : 'Uploaded video') || 'Untitled';
  const date = new Date(job.createdAt).toLocaleString();
  const isFinished = job.status === 'finished';
  const sourceLabel = job.sourceType === 'youtube' ? '🎬 YouTube' : '📁 Upload';
  const arrow = isFinished ? `<svg class="job-arrow" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>` : '';
  const userLine = showUser && job.userName ? `<div class="job-user">👤 ${esc(job.userName)} &lt;${esc(job.userEmail || '')}&gt;</div>` : '';

  return `<div class="job-card${isFinished ? ' clickable' : ''}" data-id="${job.id}" data-title="${esc(title)}">
    <div class="job-status-dot status-${job.status}"></div>
    <div class="job-info">
      <div class="job-title">${esc(title)}</div>
      <div class="job-meta">${sourceLabel} · ${date}</div>
      ${userLine}
    </div>
    <span class="job-badge badge-${job.status}">${job.status}</span>
    ${arrow}
  </div>`;
}

// ── Polling ──
function startPolling() {
  if (pollingInterval) return;
  pollingInterval = setInterval(async () => {
    if (isAdmin()) { stopPolling(); return; }
    const jobs = await userApi('GET', '/api/jobs').catch(() => []);
    renderUserJobs(jobs);
    const needs = jobs.some(j => j.status === 'pending' || j.status === 'processing');
    if (!needs) stopPolling();
  }, 5000);
}
function stopPolling() {
  if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
}

// ══════════════════════════════════════════════════════
// 1. DARK MODE
// ══════════════════════════════════════════════════════
function applyDarkMode() {
  const dark = localStorage.getItem('ts_dark') === '1';
  setDarkMode(dark);
}

function setDarkMode(on) {
  document.documentElement.setAttribute('data-theme', on ? 'dark' : '');
  localStorage.setItem('ts_dark', on ? '1' : '0');
  const moon = document.getElementById('icon-moon');
  const sun  = document.getElementById('icon-sun');
  const toggle = document.getElementById('settings-dark-toggle');
  if (moon) moon.classList.toggle('hidden', on);
  if (sun)  sun.classList.toggle('hidden', !on);
  if (toggle) toggle.classList.toggle('on', on);
}

document.getElementById('dark-mode-toggle')?.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  setDarkMode(!isDark);
});

document.getElementById('settings-dark-toggle')?.addEventListener('click', function() {
  const isDark = this.classList.contains('on');
  setDarkMode(!isDark);
});

// ══════════════════════════════════════════════════════
// 2. NOTIFICATIONS
// ══════════════════════════════════════════════════════
function loadNotifications() {
  try { notifications = JSON.parse(localStorage.getItem('ts_notifs') || '[]'); } catch { notifications = []; }
  renderNotifications();
}

function saveNotifications() {
  localStorage.setItem('ts_notifs', JSON.stringify(notifications.slice(0, 20)));
}

function addNotification(msg, color) {
  notifications.unshift({ msg, color, time: Date.now() });
  saveNotifications();
  renderNotifications();
}

function detectJobNotifications(jobs) {
  jobs.forEach(j => {
    const prev = prevJobStatuses[j.id];
    if (prev && prev !== j.status) {
      if (j.status === 'finished') {
        const title = j.title || j.sourceUrl || 'Job';
        addNotification(`✅ "${esc(title)}" finished — timestamps ready!`, '#10b981');
      } else if (j.status === 'failed') {
        const title = j.title || j.sourceUrl || 'Job';
        addNotification(`❌ "${esc(title)}" failed to process.`, '#ef4444');
      }
    }
    prevJobStatuses[j.id] = j.status;
  });
}

function renderNotifications() {
  const badge = document.getElementById('notif-badge');
  const list  = document.getElementById('notif-list');
  if (!badge || !list) return;

  const unread = notifications.length;
  badge.textContent = unread > 9 ? '9+' : unread;
  badge.classList.toggle('hidden', unread === 0);

  if (!notifications.length) {
    list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
    return;
  }

  list.innerHTML = notifications.map(n => {
    const mins = Math.round((Date.now() - n.time) / 60000);
    const ago  = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.round(mins/60)}h ago`;
    return `<div class="notif-item">
      <div class="notif-dot" style="background:${n.color || '#8b5cf6'}"></div>
      <div class="notif-item-body">
        <div class="notif-item-msg">${n.msg}</div>
        <div class="notif-item-time">${ago}</div>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('notif-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('notif-dropdown').classList.toggle('hidden');
});

document.getElementById('notif-clear-btn')?.addEventListener('click', () => {
  notifications = [];
  saveNotifications();
  renderNotifications();
});

document.addEventListener('click', e => {
  const wrap = document.querySelector('.notif-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('notif-dropdown').classList.add('hidden');
  }
});

// ══════════════════════════════════════════════════════
// 3. HISTORY SEARCH + FILTER
// ══════════════════════════════════════════════════════
document.getElementById('hist-search')?.addEventListener('input', e => {
  currentHistSearch = e.target.value.trim();
  applyHistFilter();
});

document.querySelectorAll('.hist-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.hist-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentHistFilter = pill.dataset.filter;
    applyHistFilter();
  });
});

// ══════════════════════════════════════════════════════
// 4. JOB DETAIL VIEW
// ══════════════════════════════════════════════════════
async function openJobDetail(job) {
  currentDetailJob = job;
  const title = job.title || (job.sourceType === 'youtube' ? job.sourceUrl : 'Uploaded video') || 'Untitled';

  document.getElementById('detail-title').textContent = title;
  const badge = document.getElementById('detail-status-badge');
  badge.textContent = job.status;
  badge.className = `job-badge badge-${job.status}`;
  const sourceLabel = job.sourceType === 'youtube' ? '🎬 YouTube' : '📁 Upload';
  document.getElementById('detail-meta').textContent =
    `${sourceLabel} · ${new Date(job.createdAt).toLocaleString()}`;

  const list = document.getElementById('detail-ts-list');
  list.innerHTML = '<div class="empty-state"><div class="spinner" style="border-color:rgba(99,102,241,0.3);border-top-color:var(--accent)"></div></div>';

  switchDashView('job-detail', true);

  if (job.status !== 'finished') {
    list.innerHTML = '<div class="empty-state"><p>Timestamps are available once the job is finished.</p></div>';
    return;
  }

  try {
    const data = await userApi('GET', `/api/jobs/${job.id}/timestamps`);
    currentTimestamps = data.timestamps || [];
    if (!currentTimestamps.length) {
      list.innerHTML = '<div class="empty-state"><p>No timestamps available.</p></div>';
      return;
    }
    list.innerHTML = currentTimestamps.map((ts, i) => `
      ${i > 0 ? '<div class="ts-divider"></div>' : ''}
      <div class="timestamp-row">
        <span class="ts-time">${esc(ts.time)}</span>
        <span class="ts-label">${esc(ts.label)}</span>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p style="color:var(--danger)">${esc(err.message)}</p></div>`;
  }
}

document.getElementById('detail-back-btn')?.addEventListener('click', () => {
  switchDashView('history');
});

document.getElementById('detail-copy-btn')?.addEventListener('click', () => {
  if (!currentTimestamps.length) return;
  const text = currentTimestamps.map(ts => `${ts.time} ${ts.label}`).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('detail-copy-btn');
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy All'; }, 2000);
  });
});

document.getElementById('detail-download-btn')?.addEventListener('click', () => {
  if (!currentTimestamps.length) return;
  downloadTimestampsAsTxt(currentDetailJob);
});

// ══════════════════════════════════════════════════════
// 5. COPY / EXPORT
// ══════════════════════════════════════════════════════
function downloadTimestampsAsTxt(job) {
  const title = (job && (job.title || job.sourceUrl)) || 'timestamps';
  const text = currentTimestamps.map(ts => `${ts.time} ${ts.label}`).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = title.replace(/[^a-z0-9]/gi, '_').slice(0, 50) + '_timestamps.txt';
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('modal-download-btn')?.addEventListener('click', () => {
  if (!currentTimestamps.length) return;
  downloadTimestampsAsTxt({ title: document.getElementById('modal-title').textContent });
});

// ══════════════════════════════════════════════════════
// 6. USAGE STATS
// ══════════════════════════════════════════════════════
function renderStatsView(jobs) {
  const total      = jobs.length;
  const done       = jobs.filter(j => j.status === 'finished').length;
  const processing = jobs.filter(j => j.status === 'processing' || j.status === 'pending').length;
  const failed     = jobs.filter(j => j.status === 'failed').length;

  document.getElementById('kpi-total').textContent      = total;
  document.getElementById('kpi-done').textContent       = done;
  document.getElementById('kpi-processing').textContent = processing;
  document.getElementById('kpi-failed').textContent     = failed;

  // Source breakdown bars
  const ytCount  = jobs.filter(j => j.sourceType === 'youtube').length;
  const upCount  = jobs.filter(j => j.sourceType !== 'youtube').length;
  const ytPct    = total ? Math.round(ytCount / total * 100) : 0;
  const upPct    = total ? Math.round(upCount / total * 100) : 0;
  document.getElementById('bar-youtube').style.width = ytPct + '%';
  document.getElementById('bar-upload').style.width  = upPct + '%';
  document.getElementById('pct-youtube').textContent = ytCount;
  document.getElementById('pct-upload').textContent  = upCount;

  // Bar chart — last 7 days
  const days = 7;
  const buckets = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    d.setHours(0, 0, 0, 0);
    return { date: d, count: 0, label: d.toLocaleDateString('en', { weekday: 'short' }) };
  });

  jobs.forEach(j => {
    const d = new Date(j.createdAt);
    d.setHours(0, 0, 0, 0);
    const bucket = buckets.find(b => b.date.getTime() === d.getTime());
    if (bucket) bucket.count++;
  });

  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  const W = 560, H = 160, pad = 30, barW = (W - pad * 2) / days * 0.55;
  const gap = (W - pad * 2) / days;

  const bars = buckets.map((b, i) => {
    const barH = b.count === 0 ? 2 : Math.max(4, (b.count / maxCount) * (H - 20));
    const x = pad + i * gap + (gap - barW) / 2;
    const y = H - barH;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}"
              rx="4" fill="${b.count === 0 ? 'rgba(124,58,237,0.12)' : '#7c3aed'}" />
            ${b.count > 0 ? `<text x="${(x + barW/2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--muted)">${b.count}</text>` : ''}`;
  }).join('');

  document.getElementById('stats-chart').innerHTML = bars;

  const labelsEl = document.getElementById('chart-labels');
  labelsEl.innerHTML = buckets.map(b => `<span class="chart-label">${b.label}</span>`).join('');
}

// ══════════════════════════════════════════════════════
// 7. SETTINGS
// ══════════════════════════════════════════════════════
function loadAvatarColor() {
  avatarColor = localStorage.getItem('ts_avatar_color') || '#7c3aed';
  const active = document.querySelector(`.avatar-swatch[data-color="${avatarColor}"]`);
  document.querySelectorAll('.avatar-swatch').forEach(s => s.classList.remove('active'));
  if (active) active.classList.add('active');
}

function refreshSettingsView() {
  const user = getUser();
  if (!user) return;
  const sn = document.getElementById('settings-name');
  const se = document.getElementById('settings-email');
  if (sn) sn.value = user.name;
  if (se) se.value = user.email;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const toggle = document.getElementById('settings-dark-toggle');
  if (toggle) toggle.classList.toggle('on', isDark);
  document.querySelectorAll('.avatar-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === avatarColor);
  });
  updateUserUI(user);
}

document.getElementById('settings-save-btn')?.addEventListener('click', () => {
  const name  = document.getElementById('settings-name').value.trim();
  const email = document.getElementById('settings-email').value.trim().toLowerCase();
  if (!name || !email || !email.includes('@')) {
    showToast('Please enter a valid name and email.');
    return;
  }
  setUser({ name, email });
  updateUserUI({ name, email });
  const msg = document.getElementById('settings-saved-msg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2500);
});

document.querySelectorAll('.avatar-swatch').forEach(swatch => {
  swatch.addEventListener('click', () => {
    document.querySelectorAll('.avatar-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    avatarColor = swatch.dataset.color;
    localStorage.setItem('ts_avatar_color', avatarColor);
    const user = getUser();
    if (user) updateUserUI(user);
  });
});

document.getElementById('settings-logout-btn')?.addEventListener('click', () => {
  clearUser();
  stopPolling();
  goto('page-home');
});

// ══════════════════════════════════════════════════════
// CREDITS & PAYMENTS
// ══════════════════════════════════════════════════════
let cachedCredits = null;

async function loadCredits() {
  try {
    const data = await userApi('GET', '/api/payments/credits');
    cachedCredits = data.credits ?? 0;
    updateCreditDisplays(cachedCredits);
  } catch {
    cachedCredits = 0;
    updateCreditDisplays(0);
  }
}

function updateCreditDisplays(credits) {
  const sc = document.getElementById('sidebar-credits');
  const pc = document.getElementById('pricing-credits-count');
  const fmt = credits === null ? '—' : String(credits);
  if (sc) sc.textContent = fmt;
  if (pc) pc.textContent = fmt;
}

async function loadAndShowCredits() {
  updateCreditDisplays(cachedCredits);
  await loadCredits();
}

// Payment button clicks
document.querySelectorAll('.btn-payment').forEach(btn => {
  btn.addEventListener('click', async () => {
    const plan     = btn.dataset.plan;
    const provider = btn.dataset.provider;
    const errEl    = document.getElementById('pricing-error');
    errEl.classList.add('hidden');

    const endpoint = provider === 'cryptomus'
      ? '/api/payments/crypto/checkout'
      : '/api/payments/lemon/checkout';

    btn.disabled = true;
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<span style="opacity:.6">Redirecting…</span>';

    try {
      const data = await userApi('POST', endpoint, { planId: plan });
      if (data.url) {
        window.open(data.url, '_blank');
      } else {
        throw new Error('No checkout URL received.');
      }
    } catch (err) {
      errEl.textContent = err.message || 'Payment failed. Please try again.';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  });
});

// When user comes back from payment, poll for credit update
window.addEventListener('focus', () => {
  if (getUser()) loadCredits();
});

// ══════════════════════════════════════════════════════
// ADMIN LOGIN — password show/hide toggle
// ══════════════════════════════════════════════════════
document.getElementById('adm-toggle-pw')?.addEventListener('click', () => {
  const input = document.getElementById('admin-key-input');
  const open = document.getElementById('adm-eye-open');
  const closed = document.getElementById('adm-eye-closed');
  if (!input) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  open?.classList.toggle('hidden', isPassword);
  closed?.classList.toggle('hidden', !isPassword);
});

// ══════════════════════════════════════════════════════
// ADMIN PANEL
// ══════════════════════════════════════════════════════
let adminAutoRefreshInterval = null;
let adminAutoRefreshOn = false;
let adminAllUsers = [];
let adminAllCredits = [];
let adminJobsPage = 1;
const ADMIN_JOBS_PER_PAGE = 20;
let adminJobSort = { col: 'id', dir: 'desc' };

function initAdmin() {
  applyAdminDarkMode();
  loadAdminStats();
  loadAdminJobs();
  loadAdminUsers();
  loadAdminPayments();
  loadAdminCredits();

  // Read section from URL path e.g. /admin/jobs → jobs
  const pathSec = window.location.pathname.split('/').filter(Boolean).pop();
  const startSec = ADM_SECTIONS.includes(pathSec) ? pathSec : 'overview';
  switchAdminSection(startSec, false);

  // Auto-refresh toggle
  const toggle = document.getElementById('adm-autorefresh-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      adminAutoRefreshOn = !adminAutoRefreshOn;
      toggle.classList.toggle('on', adminAutoRefreshOn);
      if (adminAutoRefreshOn) {
        adminAutoRefreshInterval = setInterval(refreshAllAdminData, 30000);
      } else {
        clearInterval(adminAutoRefreshInterval);
      }
    });
  }
}

function applyAdminDarkMode() {
  const dark = localStorage.getItem('ts_dark') === '1';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : '');
}

function refreshAllAdminData() {
  loadAdminStats();
  loadAdminJobs();
  loadAdminUsers();
  loadAdminPayments();
  loadAdminCredits();
  loadAdminActivity();
  updateAdminLastRefreshed();
}

function updateAdminLastRefreshed() {
  const el = document.getElementById('adm-last-updated');
  if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString();
}

document.getElementById('admin-logout-btn')?.addEventListener('click', () => {
  clearAdminKey();
  clearInterval(adminAutoRefreshInterval);
  goto('page-home');
});

// Admin sidebar nav
const ADM_SECTIONS = ['overview','jobs','users','payments','credits','activity','payment-setup','api-settings','email-settings'];

function switchAdminSection(sec, pushState = true) {
  if (!ADM_SECTIONS.includes(sec)) sec = 'overview';
  document.querySelectorAll('.adm-nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.section === sec);
  });
  ADM_SECTIONS.forEach(s => {
    document.getElementById(`admin-sec-${s}`)?.classList.toggle('hidden', s !== sec);
  });
  if (sec === 'activity') loadAdminActivity();
  if (sec === 'payment-setup') loadPaymentSettings();
  if (sec === 'api-settings') loadApiSettings();
  if (sec === 'email-settings') loadEmailSettings();
  if (pushState) {
    const base = (window.BASE_PATH || '').replace(/\/+$/, '');
    history.pushState({ adminSection: sec }, '', `${base}/admin/${sec}`);
  }
}

window.switchAdminSection = switchAdminSection;

window.addEventListener('popstate', e => {
  if (e.state && e.state.adminSection) switchAdminSection(e.state.adminSection, false);
});

// ── Stats ──
document.getElementById('admin-refresh-stats')?.addEventListener('click', loadAdminStats);

async function loadAdminStats() {
  try {
    const stats = await adminApi('GET', '/api/admin/stats');
    document.getElementById('stat-total').textContent = stats.total ?? 0;
    document.getElementById('stat-finished').textContent = stats.finished ?? 0;
    document.getElementById('stat-processing').textContent = stats.processing ?? 0;
    document.getElementById('stat-pending').textContent = stats.pending ?? 0;
    document.getElementById('stat-failed').textContent = stats.failed ?? 0;
    document.getElementById('stat-users').textContent = stats.uniqueUsers ?? 0;
    document.getElementById('stat-revenue').textContent = '$' + (stats.totalRevenue ?? 0).toFixed(2);
    document.getElementById('stat-ls-revenue').textContent = '$' + (stats.lsRevenue ?? 0).toFixed(2);
    document.getElementById('stat-crypto-revenue').textContent = '$' + (stats.cryptoRevenue ?? 0).toFixed(2);
    document.getElementById('stat-payments-count').textContent = stats.totalPayments ?? 0;
    document.getElementById('stat-credits-issued').textContent = stats.totalCreditsIssued ?? 0;

    // Success rate bar
    const total = stats.total ?? 0;
    const finished = stats.finished ?? 0;
    const rate = total > 0 ? Math.round((finished / total) * 100) : 0;
    const rateEl = document.getElementById('adm-success-rate');
    const barEl = document.getElementById('adm-success-bar');
    if (rateEl) rateEl.textContent = rate + '%';
    if (barEl) barEl.style.width = rate + '%';

    updateAdminLastRefreshed();
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

// ── All Jobs ──
document.getElementById('admin-refresh-jobs')?.addEventListener('click', loadAdminJobs);
document.getElementById('admin-jobs-filter')?.addEventListener('input', () => { adminJobsPage = 1; filterAndRenderAdminJobs(); });
document.getElementById('admin-jobs-status-filter')?.addEventListener('change', () => { adminJobsPage = 1; filterAndRenderAdminJobs(); });
document.getElementById('admin-jobs-type-filter')?.addEventListener('change', () => { adminJobsPage = 1; filterAndRenderAdminJobs(); });

document.getElementById('adm-export-jobs')?.addEventListener('click', () => exportCSV(adminAllJobs, [
  { key: 'id', label: 'ID' },
  { key: 'userName', label: 'User Name' },
  { key: 'userEmail', label: 'User Email' },
  { key: 'sourceType', label: 'Type' },
  { key: 'title', label: 'Title' },
  { key: 'sourceUrl', label: 'URL' },
  { key: 'status', label: 'Status' },
  { key: 'createdAt', label: 'Date' },
], 'jobs'));

async function loadAdminJobs() {
  try {
    adminAllJobs = await adminApi('GET', '/api/admin/jobs');
    const countEl = document.getElementById('adm-jobs-count');
    if (countEl) countEl.textContent = adminAllJobs.length;
    filterAndRenderAdminJobs();
  } catch (err) {
    document.getElementById('admin-jobs-body').innerHTML = `<tr><td colspan="7" class="adm-table-empty" style="color:#f87171">${esc(err.message)}</td></tr>`;
  }
}

function getFilteredAdminJobs() {
  const q = (document.getElementById('admin-jobs-filter')?.value || '').trim().toLowerCase();
  const statusF = document.getElementById('admin-jobs-status-filter')?.value || '';
  const typeF = document.getElementById('admin-jobs-type-filter')?.value || '';

  return adminAllJobs.filter(j => {
    if (statusF && j.status !== statusF) return false;
    if (typeF && j.sourceType !== typeF) return false;
    if (q && !(
      (j.userEmail || '').toLowerCase().includes(q) ||
      (j.userName || '').toLowerCase().includes(q) ||
      (j.title || '').toLowerCase().includes(q) ||
      (j.sourceUrl || '').toLowerCase().includes(q)
    )) return false;
    return true;
  });
}

function sortJobs(jobs) {
  return [...jobs].sort((a, b) => {
    let av, bv;
    if (adminJobSort.col === 'id') { av = a.id; bv = b.id; }
    else if (adminJobSort.col === 'status') { av = a.status; bv = b.status; }
    else if (adminJobSort.col === 'date') { av = new Date(a.createdAt); bv = new Date(b.createdAt); }
    else { av = a.id; bv = b.id; }
    if (av < bv) return adminJobSort.dir === 'asc' ? -1 : 1;
    if (av > bv) return adminJobSort.dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function filterAndRenderAdminJobs() {
  const filtered = sortJobs(getFilteredAdminJobs());
  renderAdminJobsPaged(filtered);
}

function renderAdminJobsPaged(jobs) {
  const tbody = document.getElementById('admin-jobs-body');
  const pagination = document.getElementById('adm-jobs-pagination');
  if (!jobs || !jobs.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="adm-table-empty">No jobs found.</td></tr>`;
    if (pagination) pagination.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(jobs.length / ADMIN_JOBS_PER_PAGE);
  if (adminJobsPage > totalPages) adminJobsPage = totalPages;
  const start = (adminJobsPage - 1) * ADMIN_JOBS_PER_PAGE;
  const page = jobs.slice(start, start + ADMIN_JOBS_PER_PAGE);

  tbody.innerHTML = page.map(job => {
    const title = job.title || job.sourceUrl || '—';
    const date = new Date(job.createdAt).toLocaleDateString();
    const userHtml = job.userName
      ? `<div class="td-user-name">${esc(job.userName)}</div><div class="td-user-email">${esc(job.userEmail || '')}</div>`
      : `<span style="color:var(--muted)">Anonymous</span>`;
    const sourceIcon = job.sourceType === 'youtube' ? '🎬' : '📁';
    return `<tr>
      <td class="td-id">#${job.id}</td>
      <td>${userHtml}</td>
      <td>${sourceIcon} ${esc(job.sourceType)}</td>
      <td class="td-url" title="${esc(title)}">${esc(title)}</td>
      <td><span class="job-badge badge-${job.status}">${job.status}</span></td>
      <td style="color:var(--muted)">${date}</td>
      <td><button class="adm-del-btn" data-job-id="${job.id}">Delete</button></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.adm-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this job permanently?')) return;
      try {
        await adminApi('DELETE', `/api/admin/jobs/${btn.dataset.jobId}`);
        showToast('Job deleted.');
        await loadAdminJobs();
        await loadAdminStats();
      } catch (err) {
        showToast('Failed to delete: ' + err.message);
      }
    });
  });

  // Pagination
  if (pagination) {
    if (totalPages <= 1) { pagination.innerHTML = ''; return; }
    let html = '';
    if (adminJobsPage > 1) html += `<button class="adm-page-btn" data-page="${adminJobsPage-1}">‹ Prev</button>`;
    const rangeStart = Math.max(1, adminJobsPage - 2);
    const rangeEnd = Math.min(totalPages, adminJobsPage + 2);
    for (let i = rangeStart; i <= rangeEnd; i++) {
      html += `<button class="adm-page-btn${i === adminJobsPage ? ' active' : ''}" data-page="${i}">${i}</button>`;
    }
    if (adminJobsPage < totalPages) html += `<button class="adm-page-btn" data-page="${adminJobsPage+1}">Next ›</button>`;
    pagination.innerHTML = `<div class="adm-page-info">Showing ${start+1}–${Math.min(start+ADMIN_JOBS_PER_PAGE, jobs.length)} of ${jobs.length}</div><div class="adm-page-btns">${html}</div>`;
    pagination.querySelectorAll('.adm-page-btn').forEach(b => {
      b.addEventListener('click', () => { adminJobsPage = parseInt(b.dataset.page); filterAndRenderAdminJobs(); });
    });
  }
}

// Sortable column headers
document.querySelectorAll('#admin-sec-jobs .sortable').forEach(th => {
  th.style.cursor = 'pointer';
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (adminJobSort.col === col) {
      adminJobSort.dir = adminJobSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      adminJobSort.col = col;
      adminJobSort.dir = 'desc';
    }
    filterAndRenderAdminJobs();
  });
});

// ── Users ──
document.getElementById('admin-refresh-users')?.addEventListener('click', loadAdminUsers);
document.getElementById('admin-users-filter')?.addEventListener('input', filterAndRenderAdminUsers);

document.getElementById('adm-export-users')?.addEventListener('click', () => exportCSV(adminAllUsers, [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'jobCount', label: 'Total Jobs' },
], 'users'));

async function loadAdminUsers() {
  try {
    adminAllUsers = await adminApi('GET', '/api/admin/users');
    const countEl = document.getElementById('adm-users-count');
    if (countEl) countEl.textContent = adminAllUsers.length;
    filterAndRenderAdminUsers();
  } catch (err) {
    document.getElementById('admin-users-body').innerHTML = `<tr><td colspan="4" class="adm-table-empty" style="color:#f87171">${esc(err.message)}</td></tr>`;
  }
}

function filterAndRenderAdminUsers() {
  const q = (document.getElementById('admin-users-filter')?.value || '').trim().toLowerCase();
  const filtered = q
    ? adminAllUsers.filter(u => (u.name||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q))
    : adminAllUsers;
  renderAdminUsers(filtered);
}

function renderAdminUsers(users) {
  const tbody = document.getElementById('admin-users-body');
  if (!users || !users.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="adm-table-empty">No users yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = users.map(u => {
    const initials = (u.name || u.email || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="adm-avatar">${initials}</div>
          <div class="td-user-name">${esc(u.name || '—')}</div>
        </div>
      </td>
      <td style="color:var(--muted);font-size:0.8rem">${esc(u.email || '—')}</td>
      <td><span class="adm-count-badge">${u.jobCount}</span></td>
      <td style="color:var(--muted);font-size:0.8rem">—</td>
    </tr>`;
  }).join('');
}

// ── Payments ──
let adminAllPayments = [];

document.getElementById('admin-refresh-payments')?.addEventListener('click', loadAdminPayments);
document.getElementById('admin-payments-filter')?.addEventListener('input', filterAdminPayments);
document.getElementById('admin-payments-status-filter')?.addEventListener('change', filterAdminPayments);
document.getElementById('admin-payments-provider-filter')?.addEventListener('change', filterAdminPayments);

document.getElementById('adm-export-payments')?.addEventListener('click', () => exportCSV(adminAllPayments, [
  { key: 'id', label: 'ID' },
  { key: 'userEmail', label: 'User Email' },
  { key: 'provider', label: 'Provider' },
  { key: 'planLabel', label: 'Plan' },
  { key: 'amountUsd', label: 'Amount (USD)' },
  { key: 'creditsAwarded', label: 'Credits' },
  { key: 'status', label: 'Status' },
  { key: 'createdAt', label: 'Date' },
], 'payments'));

async function loadAdminPayments() {
  try {
    adminAllPayments = await adminApi('GET', '/api/admin/payments');
    renderAdminPayments(adminAllPayments);
  } catch (err) {
    document.getElementById('admin-payments-body').innerHTML = `<tr><td colspan="9" class="table-empty" style="color:#f87171">${esc(err.message)}</td></tr>`;
  }
}

function filterAdminPayments() {
  const q = (document.getElementById('admin-payments-filter')?.value || '').trim().toLowerCase();
  const statusF = document.getElementById('admin-payments-status-filter')?.value || '';
  const providerF = document.getElementById('admin-payments-provider-filter')?.value || '';
  renderAdminPayments(adminAllPayments.filter(p => {
    if (statusF && p.status !== statusF) return false;
    if (providerF && p.provider !== providerF) return false;
    if (q && !(
      (p.userEmail || '').toLowerCase().includes(q) ||
      (p.planLabel || '').toLowerCase().includes(q) ||
      (p.provider || '').toLowerCase().includes(q) ||
      (p.status || '').toLowerCase().includes(q)
    )) return false;
    return true;
  }));
}

function renderAdminPayments(payments) {
  const tbody = document.getElementById('admin-payments-body');
  if (!payments || !payments.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="adm-table-empty">No payments yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = payments.map(p => {
    const providerIcon = p.provider === 'lemonsqueezy'
      ? '<span class="provider-badge ls">Card</span>'
      : '<span class="provider-badge crypto">Crypto</span>';
    const statusCls = p.status === 'paid' ? 'success' : p.status === 'pending' ? 'warn' : 'danger';
    const date = new Date(p.createdAt).toLocaleDateString();
    return `<tr>
      <td class="td-id">#${p.id}</td>
      <td style="color:var(--muted);font-size:0.78rem">${esc(p.userEmail || '—')}</td>
      <td>${providerIcon}</td>
      <td style="font-weight:600">${esc(p.planLabel || '—')}</td>
      <td style="font-weight:700">$${parseFloat(p.amountUsd || 0).toFixed(2)}</td>
      <td style="color:var(--accent);font-weight:700">+${p.creditsAwarded}</td>
      <td><span class="job-badge badge-${statusCls}">${p.status}</span></td>
      <td style="color:var(--muted)">${date}</td>
      <td><button class="adm-del-btn" data-pay-id="${p.id}">Delete</button></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.adm-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this payment record permanently?')) return;
      try {
        await adminApi('DELETE', `/api/admin/payments/${btn.dataset.payId}`);
        showToast('Payment deleted.');
        await loadAdminPayments();
        await loadAdminStats();
      } catch (err) {
        showToast('Failed: ' + err.message);
      }
    });
  });
}

// ── Credits ──
document.getElementById('admin-refresh-credits')?.addEventListener('click', loadAdminCredits);
document.getElementById('admin-credits-filter')?.addEventListener('input', filterAndRenderAdminCredits);

async function loadAdminCredits() {
  try {
    adminAllCredits = await adminApi('GET', '/api/admin/credits');
    filterAndRenderAdminCredits();
  } catch (err) {
    document.getElementById('admin-credits-body').innerHTML = `<tr><td colspan="4" class="adm-table-empty" style="color:#f87171">${esc(err.message)}</td></tr>`;
  }
}

function filterAndRenderAdminCredits() {
  const q = (document.getElementById('admin-credits-filter')?.value || '').trim().toLowerCase();
  const filtered = q
    ? adminAllCredits.filter(c => (c.userName||'').toLowerCase().includes(q) || (c.userEmail||'').toLowerCase().includes(q))
    : adminAllCredits;
  renderAdminCredits(filtered);
}

function renderAdminCredits(credits) {
  const tbody = document.getElementById('admin-credits-body');
  if (!credits || !credits.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="adm-table-empty">No credit records yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = credits.map(c => {
    const initials = (c.userName || c.userEmail || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
    const creditColor = c.credits > 10 ? '#4ade80' : c.credits > 0 ? '#fbbf24' : '#f87171';
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="adm-avatar">${initials}</div>
          <div class="td-user-name">${esc(c.userName || '—')}</div>
        </div>
      </td>
      <td style="color:var(--muted);font-size:0.8rem">${esc(c.userEmail)}</td>
      <td><span class="adm-credits-val" style="color:${creditColor}">${c.credits}</span></td>
      <td class="adm-quick-actions">
        <button class="adm-action-btn add-cr" data-email="${esc(c.userEmail)}" title="Add 10 credits">+10</button>
        <button class="adm-action-btn sub-cr" data-email="${esc(c.userEmail)}" title="Remove 10 credits">−10</button>
        <button class="adm-action-btn set-zero" data-email="${esc(c.userEmail)}" title="Reset to 0">Reset</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.add-cr').forEach(btn => {
    btn.addEventListener('click', () => adjustCreditsQuick(btn.dataset.email, 10, 'add'));
  });
  tbody.querySelectorAll('.sub-cr').forEach(btn => {
    btn.addEventListener('click', () => adjustCreditsQuick(btn.dataset.email, 10, 'subtract'));
  });
  tbody.querySelectorAll('.set-zero').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm(`Reset credits to 0 for ${btn.dataset.email}?`)) return;
      adjustCreditsQuick(btn.dataset.email, 0, 'set');
    });
  });
}

// ── Payment Setup ──
document.getElementById('adm-save-payment-settings')?.addEventListener('click', savePaymentSettings);
document.getElementById('adm-test-lemon')?.addEventListener('click', testLemonConnection);
document.getElementById('adm-test-crypto')?.addEventListener('click', testCryptoConnection);

document.querySelectorAll('.adm-reveal-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const inp = document.getElementById(btn.dataset.target);
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
});

document.querySelectorAll('.adm-copy-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const el = document.getElementById(btn.dataset.copy);
    if (!el) return;
    navigator.clipboard.writeText(el.textContent || '').then(() => showToast('Copied!'));
  });
});

async function loadPaymentSettings() {
  try {
    const data = await adminApi('GET', '/api/admin/payment-settings');
    const sources = JSON.parse(data._sources || '{}');

    // Fill inputs
    const fieldMap = {
      'adm-ls-api-key':          'LS_API_KEY',
      'adm-ls-store-id':         'LS_STORE_ID',
      'adm-ls-webhook-secret':   'LS_WEBHOOK_SECRET',
      'adm-ls-variant-10':       'LS_VARIANT_10',
      'adm-ls-variant-50':       'LS_VARIANT_50',
      'adm-ls-variant-200':      'LS_VARIANT_200',
      'adm-crypto-payment-key':  'CRYPTO_PAYMENT_KEY',
      'adm-crypto-merchant-id':  'CRYPTO_MERCHANT_ID',
      'adm-app-url':             'APP_URL',
    };
    for (const [id, key] of Object.entries(fieldMap)) {
      const el = document.getElementById(id);
      if (el) el.value = data[key] || '';
      const srcEl = document.getElementById(`adm-src-${key}`);
      if (srcEl) {
        const src = sources[key] || 'unset';
        srcEl.textContent = src === 'db' ? '● DB' : src === 'env' ? '● Env' : '○ Not set';
        srcEl.className = `adm-src-tag src-${src}`;
      }
    }

    // Status dots
    const lsConfigured = !!(data['LS_API_KEY'] && data['LS_STORE_ID']);
    const cryptoConfigured = !!(data['CRYPTO_PAYMENT_KEY'] && data['CRYPTO_MERCHANT_ID']);
    const lsDot = document.getElementById('adm-ls-status-dot');
    const cryptoDot = document.getElementById('adm-crypto-status-dot');
    if (lsDot) { lsDot.className = `adm-pay-status-dot ${lsConfigured ? 'configured' : 'unconfigured'}`; lsDot.title = lsConfigured ? 'Configured' : 'Not configured'; }
    if (cryptoDot) { cryptoDot.className = `adm-pay-status-dot ${cryptoConfigured ? 'configured' : 'unconfigured'}`; cryptoDot.title = cryptoConfigured ? 'Configured' : 'Not configured'; }

    // Webhook URLs
    const base = window.location.origin;
    const lsWebhook = document.getElementById('adm-ls-webhook-url');
    const cryptoWebhook = document.getElementById('adm-crypto-webhook-url');
    if (lsWebhook) lsWebhook.textContent = `${base}/api/payments/lemon/webhook`;
    if (cryptoWebhook) cryptoWebhook.textContent = `${base}/api/payments/crypto/webhook`;

  } catch (err) {
    console.error('Failed to load payment settings:', err);
  }
}

async function savePaymentSettings() {
  const btn = document.getElementById('adm-save-payment-settings');
  const resultEl = document.getElementById('adm-pay-save-result');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  const payload = {};
  document.querySelectorAll('#admin-sec-payment-setup input[name]').forEach(inp => {
    payload[inp.name] = inp.value;
  });

  try {
    await adminApi('POST', '/api/admin/payment-settings', undefined, payload);
    resultEl.className = 'adm-grant-result success';
    resultEl.textContent = '✓ Settings saved successfully.';
    await loadPaymentSettings();
  } catch (err) {
    resultEl.className = 'adm-grant-result error';
    resultEl.textContent = '✗ Failed to save: ' + err.message;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save All Settings'; }
    setTimeout(() => { resultEl.className = 'adm-grant-result hidden'; }, 4000);
  }
}

async function testLemonConnection() {
  const btn = document.getElementById('adm-test-lemon');
  const resEl = document.getElementById('adm-test-lemon-result');
  if (btn) btn.disabled = true;
  resEl.textContent = 'Testing…';
  resEl.className = 'adm-test-result';
  try {
    const data = await adminApi('POST', '/api/admin/payment-settings/test-lemon');
    resEl.textContent = data.ok ? `✓ ${data.storeName}` : `✗ ${data.error}`;
    resEl.className = `adm-test-result ${data.ok ? 'ok' : 'fail'}`;
  } catch (err) {
    resEl.textContent = '✗ ' + err.message;
    resEl.className = 'adm-test-result fail';
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function testCryptoConnection() {
  const btn = document.getElementById('adm-test-crypto');
  const resEl = document.getElementById('adm-test-crypto-result');
  if (btn) btn.disabled = true;
  resEl.textContent = 'Testing…';
  resEl.className = 'adm-test-result';
  try {
    const data = await adminApi('POST', '/api/admin/payment-settings/test-crypto');
    resEl.textContent = data.ok ? `✓ ${data.message}` : `✗ ${data.error}`;
    resEl.className = `adm-test-result ${data.ok ? 'ok' : 'fail'}`;
  } catch (err) {
    resEl.textContent = '✗ ' + err.message;
    resEl.className = 'adm-test-result fail';
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Activity Log ──
document.getElementById('adm-refresh-activity')?.addEventListener('click', loadAdminActivity);

async function loadAdminActivity() {
  const el = document.getElementById('adm-activity-list');
  if (!el) return;
  el.innerHTML = '<div class="adm-table-empty">Loading…</div>';
  try {
    const [jobs, payments] = await Promise.all([
      adminApi('GET', '/api/admin/jobs'),
      adminApi('GET', '/api/admin/payments'),
    ]);

    const events = [];
    (jobs || []).slice(0, 50).forEach(j => {
      events.push({
        time: new Date(j.createdAt),
        icon: j.status === 'finished' ? '✅' : j.status === 'failed' ? '❌' : '⏳',
        color: j.status === 'finished' ? '#4ade80' : j.status === 'failed' ? '#f87171' : '#fbbf24',
        text: `Job <strong>#${j.id}</strong> — ${esc(j.title || j.sourceUrl || 'Untitled')} — <span class="job-badge badge-${j.status}">${j.status}</span>`,
        sub: j.userName ? `by ${esc(j.userName)} &lt;${esc(j.userEmail || '')}&gt;` : 'Anonymous',
      });
    });
    (payments || []).slice(0, 20).forEach(p => {
      events.push({
        time: new Date(p.createdAt),
        icon: '💳',
        color: '#818cf8',
        text: `Payment <strong>#${p.id}</strong> — ${esc(p.planLabel || 'Unknown plan')} — $${parseFloat(p.amountUsd || 0).toFixed(2)}`,
        sub: esc(p.userEmail || 'Unknown user'),
      });
    });
    events.sort((a, b) => b.time - a.time);

    if (!events.length) { el.innerHTML = '<div class="adm-table-empty">No activity yet.</div>'; return; }
    el.innerHTML = events.slice(0, 60).map(e => `
      <div class="adm-activity-item">
        <div class="adm-activity-dot" style="background:${e.color}"></div>
        <div class="adm-activity-body">
          <div class="adm-activity-text">${e.icon} ${e.text}</div>
          <div class="adm-activity-meta">${e.sub} · ${e.time.toLocaleString()}</div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    el.innerHTML = `<div class="adm-table-empty" style="color:#f87171">Failed to load: ${esc(err.message)}</div>`;
  }
}

// ── CSV Export utility ──
function exportCSV(data, columns, filename) {
  if (!data || !data.length) { showToast('No data to export.'); return; }
  const header = columns.map(c => `"${c.label}"`).join(',');
  const rows = data.map(row =>
    columns.map(c => {
      const val = row[c.key] ?? '';
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(',')
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${data.length} rows to CSV.`);
}

async function adjustCreditsQuick(email, amount, action) {
  try {
    const res = await adminApi('POST', '/api/admin/credits/adjust', undefined, { email, amount, action });
    showToast(`Credits updated: ${email} now has ${res.credits}`);
    await loadAdminCredits();
    await loadAdminStats();
  } catch (err) {
    showToast('Failed: ' + err.message);
  }
}

// Grant form
document.getElementById('grant-btn')?.addEventListener('click', async () => {
  const email = document.getElementById('grant-email').value.trim();
  const amount = parseInt(document.getElementById('grant-amount').value, 10);
  const action = document.getElementById('grant-action').value;
  const resultEl = document.getElementById('grant-result');
  if (!email || isNaN(amount)) { showToast('Enter a valid email and amount.'); return; }
  try {
    const res = await adminApi('POST', '/api/admin/credits/adjust', undefined, { email, amount, action });
    resultEl.className = 'grant-result success';
    resultEl.textContent = `Done — ${res.email} now has ${res.credits} credit(s).`;
    document.getElementById('grant-email').value = '';
    document.getElementById('grant-amount').value = '';
    await loadAdminCredits();
    await loadAdminStats();
  } catch (err) {
    resultEl.className = 'grant-result error';
    resultEl.textContent = 'Error: ' + err.message;
  }
});

// ══════════════════════════════════════════════════════
// TIMESTAMPS MODAL
// ══════════════════════════════════════════════════════
document.getElementById('modal-close-btn')?.addEventListener('click', closeModal);
document.getElementById('modal-overlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
document.getElementById('copy-btn')?.addEventListener('click', copyTimestamps);

async function openTimestamps(jobId, title) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-subtitle').textContent = 'Loading timestamps…';
  document.getElementById('modal-timestamps').innerHTML = `<div class="empty-state"><div class="spinner" style="border-color:rgba(99,102,241,0.3);border-top-color:var(--accent)"></div></div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');

  try {
    const data = await userApi('GET', `/api/jobs/${jobId}/timestamps`);
    currentTimestamps = data.timestamps || [];
    document.getElementById('modal-subtitle').textContent = `${currentTimestamps.length} timestamps`;
    renderTimestamps(currentTimestamps);
  } catch (err) {
    document.getElementById('modal-timestamps').innerHTML = `<div class="empty-state"><p style="color:#f87171">${esc(err.message)}</p></div>`;
  }
}

function renderTimestamps(tss) {
  const el = document.getElementById('modal-timestamps');
  if (!tss.length) { el.innerHTML = `<div class="empty-state"><p>No timestamps available.</p></div>`; return; }
  el.innerHTML = tss.map((ts, i) => `
    ${i > 0 ? '<div class="ts-divider"></div>' : ''}
    <div class="timestamp-row">
      <span class="ts-time">${esc(ts.time)}</span>
      <span class="ts-label">${esc(ts.label)}</span>
    </div>
  `).join('');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  currentTimestamps = [];
}

function copyTimestamps() {
  if (!currentTimestamps.length) return;
  const text = currentTimestamps.map(ts => `${ts.time} ${ts.label}`).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    document.getElementById('copy-btn-text').textContent = '✓ Copied!';
    setTimeout(() => { document.getElementById('copy-btn-text').textContent = 'Copy All'; }, 2000);
  });
}

// ══════════════════════════════════════════════════════
// API Helpers
// ══════════════════════════════════════════════════════
async function userApi(method, path, body) {
  const user = getUser();
  const headers = { 'Content-Type': 'application/json' };
  if (user) {
    headers['x-user-email'] = user.email;
    headers['x-user-name'] = user.name;
  }
  return request(method, path, body, headers);
}

async function adminApi(method, path, keyOverride, body) {
  const key = keyOverride !== undefined ? keyOverride : getAdminKey();
  const headers = { 'Content-Type': 'application/json', 'x-admin-key': key };
  return request(method, path, body, headers);
}

async function request(method, path, body, headers) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ══════════════════════════════════════════════════════
// Utilities
// ══════════════════════════════════════════════════════
function setProgress(bar, pctEl, pct) {
  bar.style.width = pct + '%';
  pctEl.textContent = pct + '%';
}

function setLoading(type, loading) {
  const btn = document.getElementById(`btn-${type}`);
  const text = document.getElementById(`btn-${type}-text`);
  const spinner = document.getElementById(`btn-${type}-spinner`);
  btn.disabled = loading;
  text.classList.toggle('hidden', loading);
  spinner.classList.toggle('hidden', !loading);
}

function showErr(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showToast(msg, duration = 3500) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), duration);
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function uploadToS3(url, file, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers || {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error(`Upload failed: HTTP ${xhr.status}`)); };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.send(file);
  });
}

function computeFileMD5(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const hashBuf = await window.crypto.subtle.digest('SHA-256', e.target.result);
        const b64 = btoa(String.fromCharCode(...new Uint8Array(hashBuf).slice(0, 16)));
        onProgress && onProgress(100);
        resolve(b64);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsArrayBuffer(file);
  });
}

// ══════════════════════════════════════════════════════
// Hero Input Tab Toggle
// ══════════════════════════════════════════════════════
function heroTab(tab) {
  const urlPanel  = document.getElementById('hero-url-panel');
  const filePanel = document.getElementById('hero-file-panel');
  const tabUrl    = document.getElementById('htab-url');
  const tabFile   = document.getElementById('htab-file');
  if (!urlPanel) return;
  if (tab === 'url') {
    urlPanel.classList.remove('hidden');
    filePanel.classList.add('hidden');
    tabUrl.classList.add('active');
    tabFile.classList.remove('active');
  } else {
    urlPanel.classList.add('hidden');
    filePanel.classList.remove('hidden');
    tabFile.classList.add('active');
    tabUrl.classList.remove('active');
  }
}
// Expose for inline onclick in HTML (Vite ES module scope)
window.heroTab = heroTab;

// Wire upload CTA to navigate to sign-in / user panel
document.addEventListener('DOMContentLoaded', () => {
  const uploadCta = document.getElementById('home-upload-cta-btn');
  if (uploadCta) {
    uploadCta.addEventListener('click', () => {
      const user = getUser();
      if (user) goto('page-user');
      else goto('page-login');
    });
  }
});

// ══════════════════════════════════════════════════════
// Hero Timestamp Animation
// ══════════════════════════════════════════════════════
function initHeroAnimation() {
  const rows = document.querySelectorAll('#hero-ts-list .ts-row');
  const fill = document.getElementById('hero-progress');
  const playhead = document.getElementById('hero-playhead');
  if (!rows.length || !fill) return;

  let current = 0;
  const INTERVAL = 2000;

  function activate(idx) {
    rows.forEach((r, i) => r.classList.toggle('active-ts', i === idx));
    const pct = parseFloat(rows[idx].dataset.pct || '0');
    fill.style.width = pct + '%';
    if (playhead) playhead.style.left = pct + '%';
  }

  activate(0);
  const timer = setInterval(() => {
    current = (current + 1) % rows.length;
    activate(current);
  }, INTERVAL);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(timer);
  });
}

// ══════════════════════════════════════════════════════
// Feature Showcase — interactive tab + demo panels
// ══════════════════════════════════════════════════════
function initFeatureShowcase() {
  const tabs   = document.querySelectorAll('.feat-tab');
  const panels = document.querySelectorAll('.feat-panel');
  if (!tabs.length) return;

  // Per-panel animation controllers keyed by feat name
  const animations = {};
  let activeAnim = null;

  // ── YouTube panel: typewriter effect ──
  animations.youtube = function startYoutube() {
    const tw = document.getElementById('fdemo-yt-url');
    if (!tw) return;
    const text = 'https://youtu.be/dQw4w9WgXcQ';
    tw.textContent = '';
    let i = 0;
    const t = setInterval(() => {
      if (i < text.length) { tw.textContent += text[i++]; }
      else clearInterval(t);
    }, 40);
    return () => clearInterval(t);
  };

  // ── Upload panel: dropzone → progress bar ──
  animations.upload = function startUpload() {
    const zone = document.getElementById('fdemo-dropzone');
    const prog = document.getElementById('fdemo-upload-progress');
    const fill = document.getElementById('fdemo-prog-fill');
    const pct  = document.getElementById('fdemo-prog-pct');
    const stat = prog ? prog.querySelector('.fdemo-prog-status') : null;
    if (!zone || !prog || !fill) return;

    // Reset
    zone.classList.remove('dragging');
    prog.classList.remove('visible');
    fill.style.width = '0%';
    if (pct) pct.textContent = '0%';
    if (stat) stat.textContent = 'Uploading...';

    let pctVal = 0;
    let timer;

    // Animate dropzone "drag" effect after short delay
    const t1 = setTimeout(() => {
      zone.classList.add('dragging');
      const t2 = setTimeout(() => {
        zone.classList.remove('dragging');
        prog.classList.add('visible');
        timer = setInterval(() => {
          pctVal = Math.min(pctVal + Math.random() * 4 + 1.5, 100);
          fill.style.width = pctVal.toFixed(0) + '%';
          if (pct) pct.textContent = pctVal.toFixed(0) + '%';
          if (pctVal >= 100) {
            clearInterval(timer);
            if (stat) stat.textContent = '✓ Upload complete!';
          }
        }, 100);
      }, 700);
    }, 400);

    return () => { clearTimeout(t1); if (timer) clearInterval(timer); };
  };

  // ── Fast panel: timer + progress steps ──
  animations.fast = function startFast() {
    const secEl  = document.getElementById('fdemo-secs');
    const fillEl = document.getElementById('fdemo-fast-fill');
    const steps  = ['fstep-1','fstep-2','fstep-3','fstep-4'];
    const doneEl = document.getElementById('fdemo-done-time');
    if (!secEl || !fillEl) return;

    // Reset
    steps.forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('show'); });
    secEl.textContent = '0';
    fillEl.style.width = '0%';

    const totalMs  = 4000; // simulated 4s = "18s" in demo
    const doneSecs = 18;
    const start    = Date.now();
    let raf;

    const stepTimes = [0.25, 0.55, 0.78, 1.0]; // fractions of totalMs

    function tick() {
      const elapsed = Date.now() - start;
      const frac    = Math.min(elapsed / totalMs, 1);
      const secs    = Math.round(frac * doneSecs);
      secEl.textContent = secs;
      fillEl.style.width = (frac * 100).toFixed(1) + '%';

      stepTimes.forEach((threshold, idx) => {
        if (frac >= threshold) {
          const el = document.getElementById(steps[idx]);
          if (el) el.classList.add('show');
        }
      });
      if (doneEl && frac >= 1) doneEl.textContent = doneSecs + 's';

      if (frac < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  };

  // ── Copy panel: copy button click ──
  animations.copy = function startCopy() {
    const btn   = document.getElementById('fdemo-copy-btn');
    const label = document.getElementById('fdemo-copy-label');
    const toast = document.getElementById('fdemo-copied-toast');
    if (!btn) return;

    // Reset
    btn.classList.remove('copied');
    if (label) label.textContent = 'Copy All Timestamps';
    if (toast) toast.classList.remove('show');

    function handleClick() {
      btn.classList.add('copied');
      if (label) label.textContent = 'Copied!';
      if (toast) toast.classList.add('show');
      setTimeout(() => {
        btn.classList.remove('copied');
        if (label) label.textContent = 'Copy All Timestamps';
        if (toast) toast.classList.remove('show');
      }, 2200);
    }
    btn.addEventListener('click', handleClick);

    // Auto-demo: simulate a click after 1.2s
    const t = setTimeout(() => handleClick(), 1200);
    return () => { clearTimeout(t); btn.removeEventListener('click', handleClick); };
  };

  // ── History panel: no extra animation needed (CSS handles it) ──
  animations.history = function startHistory() { return () => {}; };

  // ── Switch panel ──
  function switchTo(feat) {
    if (activeAnim) { try { activeAnim(); } catch(e) {} }

    tabs.forEach(t => {
      const on = t.dataset.feat === feat;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on);
    });
    panels.forEach(p => p.classList.toggle('active', p.dataset.feat === feat));

    // Start animation for this panel
    const fn = animations[feat];
    activeAnim = fn ? fn() || null : null;
  }

  // Attach click handlers
  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTo(tab.dataset.feat));
  });

  // Boot the default (first) panel
  const first = tabs[0]?.dataset.feat;
  if (first) switchTo(first);
}

// ══════════════════════════════════════════════════════
// Use Cases — tab switcher
// ══════════════════════════════════════════════════════
function initUseCaseTabs() {
  const tabs   = document.querySelectorAll('.uc-tab');
  const panels = document.querySelectorAll('.uc-panel');
  if (!tabs.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const idx = tab.dataset.uc;

      tabs.forEach(t => {
        const on = t.dataset.uc === idx;
        t.classList.toggle('uc-tab--active', on);
        t.setAttribute('aria-selected', on);
      });

      panels.forEach(p => {
        const on = p.dataset.uc === idx;
        p.classList.toggle('uc-panel--active', on);
        // Re-trigger animation by cloning
        if (on) {
          p.style.animation = 'none';
          requestAnimationFrame(() => { p.style.animation = ''; });
        }
      });
    });
  });
}

// ══════════════════════════════════════════════════════
// Boot — apply dark mode globally, then init current page
// ══════════════════════════════════════════════════════
applyDarkMode();

if (CURRENT_PAGE === 'home') {
  initHeroAnimation();
  initFeatureShowcase();
  initUseCaseTabs();
} else if (CURRENT_PAGE === 'dashboard') {
  if (isAdmin()) {
    goto('page-admin');
  } else {
    const user = getUser();
    if (!user) goto('page-login');
    else initUser(user);
  }
} else if (CURRENT_PAGE === 'admin') {
  if (!isAdmin()) goto('page-admin-login');
  else initAdmin();
} else if (CURRENT_PAGE === 'login') {
  if (isAdmin()) goto('page-admin');
  else if (getUser()) goto('page-user');
} else if (CURRENT_PAGE === 'admin-login') {
  if (isAdmin()) goto('page-admin');
}

// ══════════════════════════════════════════════════════════
// API SETTINGS
// ══════════════════════════════════════════════════════════

async function loadApiSettings() {
  const key = getAdminKey();
  if (!key) return;
  try {
    const res = await fetch('/api/admin/api-settings', {
      headers: { 'x-admin-key': key }
    });
    if (!res.ok) return;
    const data = await res.json();

    const inp = document.getElementById('api-key-input');
    const urlInp = document.getElementById('api-url-input');
    if (inp && data.TIMESTAMPS_API_KEY) inp.value = data.TIMESTAMPS_API_KEY;
    if (urlInp) urlInp.value = data.TIMESTAMPS_BASE_URL || 'https://api.timestamps.video';

    // Source tags
    const sources = data._sources ? JSON.parse(data._sources) : {};
    const srcKey = sources['TIMESTAMPS_API_KEY'] || 'unset';
    const srcUrl = sources['TIMESTAMPS_BASE_URL'] || 'unset';

    const keyTag = document.getElementById('api-key-source-tag');
    const urlTag = document.getElementById('api-url-source-tag');
    if (keyTag) {
      keyTag.className = `adm-src-tag src-${srcKey}`;
      keyTag.textContent = srcKey === 'db' ? 'DB (saved)' : srcKey === 'env' ? 'Env var' : 'Not set';
    }
    if (urlTag) {
      urlTag.className = `adm-src-tag src-${srcUrl}`;
      urlTag.textContent = srcUrl === 'db' ? 'DB (saved)' : srcUrl === 'env' ? 'Env var' : 'Default';
    }

    // Status dot
    const dot = document.getElementById('api-status-dot');
    if (dot) {
      const configured = data.TIMESTAMPS_API_KEY && !data.TIMESTAMPS_API_KEY.startsWith('Not');
      dot.className = `adm-pay-status-dot ${configured ? 'configured' : 'unconfigured'}`;
    }
  } catch (e) {
    console.error('loadApiSettings error', e);
  }
}

window.saveApiSettings = async function() {
  const key = getAdminKey();
  if (!key) return;
  const btn = document.getElementById('api-save-btn');
  const msg = document.getElementById('api-save-msg');

  const apiKey = document.getElementById('api-key-input')?.value || '';
  const baseUrl = document.getElementById('api-url-input')?.value || '';

  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const res = await fetch('/api/admin/api-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': key },
      body: JSON.stringify({ TIMESTAMPS_API_KEY: apiKey, TIMESTAMPS_BASE_URL: baseUrl })
    });
    const data = await res.json();
    if (res.ok) {
      if (msg) { msg.style.color = '#4ade80'; msg.textContent = '✓ Saved successfully'; }
      await loadApiSettings();
    } else {
      if (msg) { msg.style.color = '#f87171'; msg.textContent = data.error || 'Save failed'; }
    }
  } catch(e) {
    if (msg) { msg.style.color = '#f87171'; msg.textContent = 'Network error'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save API Settings'; }
    setTimeout(() => { if (msg) msg.textContent = ''; }, 4000);
  }
};

window.testTimestampsApi = async function() {
  const key = getAdminKey();
  if (!key) return;
  const btn = document.getElementById('api-test-btn');
  const result = document.getElementById('api-test-result');
  if (btn) { btn.disabled = true; btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg> Testing…'; }
  try {
    const res = await fetch('/api/admin/api-settings/test', {
      method: 'POST',
      headers: { 'x-admin-key': key }
    });
    const data = await res.json();
    if (result) {
      result.className = `adm-test-result ${data.ok ? 'ok' : 'fail'}`;
      result.textContent = data.ok ? `✓ ${data.message || 'Connected'}` : `✗ ${data.message || data.error || 'Failed'}`;
    }
  } catch(e) {
    if (result) { result.className = 'adm-test-result fail'; result.textContent = '✗ Network error'; }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Test Connection'; }
    setTimeout(() => { if (result) result.textContent = ''; }, 8000);
  }
};

window.resetApiDefaults = async function() {
  const key = getAdminKey();
  if (!key) return;
  if (!confirm('Reset to default values? This will remove any saved API key and URL from the database.')) return;
  try {
    await fetch('/api/admin/api-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': key },
      body: JSON.stringify({ TIMESTAMPS_API_KEY: '', TIMESTAMPS_BASE_URL: '' })
    });
    await loadApiSettings();
    showToast('Reset to defaults');
  } catch(e) {
    showToast('Reset failed', true);
  }
};

window.toggleApiKeyVisibility = function(btn) {
  const inp = document.getElementById('api-key-input');
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
};

// ══════════════════════════════════════════════════════════
// EMAIL SETTINGS
// ══════════════════════════════════════════════════════════

async function loadEmailSettings() {
  if (!getAdminKey()) return;
  try {
    const data = await adminApi('GET', '/api/admin/email-settings');
    const fields = {
      'smtp-host':        data.SMTP_HOST        || '',
      'smtp-port':        data.SMTP_PORT        || '465',
      'smtp-user':        data.SMTP_USER        || '',
      'smtp-pass':        data.SMTP_PASS        || '',
      'smtp-from-name':   data.SMTP_FROM_NAME   || '',
      'smtp-from-email':  data.SMTP_FROM_EMAIL  || '',
      'smtp-admin-email': data.SMTP_ADMIN_EMAIL || '',
    };
    for (const [id, val] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (el) el.value = val;
    }
    const secure = data.SMTP_SECURE !== 'false';
    const r1 = document.getElementById('smtp-secure-true');
    const r2 = document.getElementById('smtp-secure-false');
    if (r1) r1.checked = secure;
    if (r2) r2.checked = !secure;
    const dot = document.getElementById('smtp-status-dot');
    const configured = !!(data.SMTP_HOST && data.SMTP_USER && data.SMTP_PASS);
    if (dot) dot.className = `adm-pay-status-dot ${configured ? 'configured' : 'unconfigured'}`;
  } catch(e) {
    console.error('loadEmailSettings error', e);
  }
}

window.saveEmailSettings = async function() {
  if (!getAdminKey()) return;
  const btn = document.getElementById('smtp-save-btn');
  const msg = document.getElementById('smtp-save-msg');
  const secureEl = document.querySelector('input[name="smtp-secure"]:checked');
  const body = {
    SMTP_HOST:        document.getElementById('smtp-host')?.value        || '',
    SMTP_PORT:        document.getElementById('smtp-port')?.value        || '465',
    SMTP_USER:        document.getElementById('smtp-user')?.value        || '',
    SMTP_PASS:        document.getElementById('smtp-pass')?.value        || '',
    SMTP_FROM_NAME:   document.getElementById('smtp-from-name')?.value   || '',
    SMTP_FROM_EMAIL:  document.getElementById('smtp-from-email')?.value  || '',
    SMTP_ADMIN_EMAIL: document.getElementById('smtp-admin-email')?.value || '',
    SMTP_SECURE:      secureEl ? secureEl.value : 'true',
  };
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await adminApi('POST', '/api/admin/email-settings', undefined, body);
    if (msg) { msg.style.color = '#4ade80'; msg.textContent = '✓ Saved'; }
    await loadEmailSettings();
  } catch(e) {
    if (msg) { msg.style.color = '#f87171'; msg.textContent = e.message || 'Save failed'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Settings'; }
    setTimeout(() => { if (msg) msg.textContent = ''; }, 4000);
  }
};

window.testSmtpConn = async function() {
  if (!getAdminKey()) return;
  const result = document.getElementById('smtp-test-result');
  if (result) { result.className = 'adm-test-result'; result.textContent = 'Testing…'; }
  try {
    const data = await adminApi('POST', '/api/admin/email-settings/test-smtp');
    if (result) {
      result.className = `adm-test-result ${data.ok ? 'ok' : 'fail'}`;
      result.textContent = data.ok ? `✓ ${data.message}` : `✗ ${data.message}`;
    }
    const dot = document.getElementById('smtp-status-dot');
    if (dot) dot.className = `adm-pay-status-dot ${data.ok ? 'configured' : 'unconfigured'}`;
  } catch(e) {
    if (result) { result.className = 'adm-test-result fail'; result.textContent = `✗ ${e.message || 'Connection failed'}`; }
  }
  setTimeout(() => { if (result) result.textContent = ''; }, 10000);
};

window.sendTestEmailNow = async function() {
  if (!getAdminKey()) return;
  const to = document.getElementById('smtp-test-to')?.value?.trim();
  if (!to) { showToast('Enter an email address first'); return; }
  const btn = document.getElementById('smtp-send-test-btn');
  const result = document.getElementById('smtp-send-result');
  if (btn) btn.disabled = true;
  if (result) { result.className = 'adm-test-result'; result.textContent = 'Sending…'; }
  try {
    const data = await adminApi('POST', '/api/admin/email-settings/send-test', undefined, { to });
    if (result) {
      result.className = `adm-test-result ${data.ok ? 'ok' : 'fail'}`;
      result.textContent = data.ok ? `✓ ${data.message}` : `✗ ${data.message}`;
    }
  } catch(e) {
    if (result) { result.className = 'adm-test-result fail'; result.textContent = `✗ ${e.message || 'Send failed'}`; }
  } finally {
    if (btn) btn.disabled = false;
    setTimeout(() => { if (result) result.textContent = ''; }, 8000);
  }
};

// ══════════════════════════════════════════════════════════
// CONTACT FORM
// ══════════════════════════════════════════════════════════
document.getElementById('contact-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const name    = document.getElementById('cf-name')?.value?.trim();
  const email   = document.getElementById('cf-email')?.value?.trim();
  const subject = document.getElementById('cf-subject')?.value?.trim() || 'Contact Form Message';
  const message = document.getElementById('cf-message')?.value?.trim();
  const btn     = document.getElementById('cf-submit-btn');
  const result  = document.getElementById('cf-result');

  if (result) { result.className = 'cf-result hidden'; result.textContent = ''; }

  if (!name || !email || !message) {
    if (result) { result.className = 'cf-result fail'; result.textContent = 'Please fill in your name, email, and message.'; }
    return;
  }
  if (!email.includes('@')) {
    if (result) { result.className = 'cf-result fail'; result.textContent = 'Please enter a valid email address.'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg> Sending…'; }

  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, subject, message }),
    });
    const data = await res.json();
    if (res.ok && data.ok !== false) {
      if (result) { result.className = 'cf-result ok'; result.textContent = '✓ Message sent! We\'ll get back to you within 24–48 hours.'; }
      document.getElementById('contact-form')?.reset();
    } else {
      if (result) { result.className = 'cf-result fail'; result.textContent = '✗ ' + (data.error || 'Failed to send. Please try again.'); }
    }
  } catch(err) {
    if (result) { result.className = 'cf-result fail'; result.textContent = '✗ Network error. Please try again.'; }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send Message'; }
  }
});
