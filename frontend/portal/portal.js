'use strict';

/* ==========================================================================
   CamMonitor — CUSTOMER portal. Staff use /admin/.
   Customers register, sign in, create their own sites (name, area/location,
   owner), add cameras, watch live streams and get support.
   ========================================================================== */

const TOKEN_KEY = 'cm_portal_token';
const USER_KEY = 'cm_portal_user';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  userEmail: localStorage.getItem(USER_KEY) || null,
  me: null,
  sites: [],
  cameras: [],
  siteFilter: '', // '' = all my sites
  cameraPoll: null,
  healthPoll: null,
  section: 'cameras',
};

/** cameraId -> { card, video, hls|null, native:boolean, status, cam } */
const cards = new Map();

const $ = (sel, root = document) => root.querySelector(sel);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString();
}

/* ==========================================================================
   API layer
   ========================================================================== */

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers);
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  let body = opts.body;
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(path, Object.assign({}, opts, { headers, body }));
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('Session expired. Please sign in again.');
  }
  if (res.status === 403) {
    throw new Error('This account is not a customer account — use the right portal.');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = (data && data.message)
      ? (Array.isArray(data.message) ? data.message.join(', ') : data.message)
      : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

/* ==========================================================================
   Auth views (sign in / register / forgot password)
   ========================================================================== */

function switchAuthTab(tab) {
  document.querySelectorAll('#auth-tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === tab));
  $('#login-form').classList.toggle('hidden', tab !== 'login');
  $('#register-form').classList.toggle('hidden', tab !== 'register');
  $('#forgot-form').classList.toggle('hidden', tab !== 'forgot');
}

function showLogin() {
  stopPolling();
  destroyAllPlayers();
  $('#view-app').classList.add('hidden');
  $('#view-login').classList.remove('hidden');
}

async function showApp() {
  $('#view-login').classList.add('hidden');
  $('#view-app').classList.remove('hidden');
  $('#user-email').textContent = state.userEmail || '';
  await loadAll();
  showSection('cameras');
  startPolling();
}

function handleUnauthorized() {
  state.token = null;
  state.userEmail = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  showLogin();
  const err = $('#login-error');
  err.textContent = 'Session expired. Please sign in again.';
  err.classList.remove('hidden');
}

function logout() {
  state.token = null;
  state.userEmail = null;
  state.me = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  showLogin();
}

function saveSession(data, fallbackEmail) {
  state.token = data.access_token;
  state.userEmail = (data.user && data.user.email) || fallbackEmail;
  localStorage.setItem(TOKEN_KEY, state.token);
  localStorage.setItem(USER_KEY, state.userEmail);
}

function bindAuth() {
  document.querySelectorAll('#auth-tabs button').forEach((b) =>
    b.addEventListener('click', () => switchAuthTab(b.dataset.tab)));
  $('#btn-forgot').addEventListener('click', () => switchAuthTab('forgot'));
  $('#btn-forgot-back').addEventListener('click', () => switchAuthTab('login'));

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    const errBox = $('#login-error');
    errBox.classList.add('hidden');
    let valid = true;
    valid = setFieldError(null, 'login-email', email ? '' : 'Email is required') && valid;
    valid = setFieldError(null, 'login-password', password ? '' : 'Password is required') && valid;
    if (!valid) return;
    const btn = $('#login-submit');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const data = await api('/api/auth/customer/login', { method: 'POST', body: { email, password } });
      saveSession(data, email);
      e.target.reset();
      await showApp();
    } catch (err) {
      errBox.textContent = err.message || 'Login failed';
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#reg-name').value.trim();
    const email = $('#reg-email').value.trim();
    const phone = $('#reg-phone').value.trim();
    const password = $('#reg-password').value;
    const errBox = $('#register-error');
    errBox.classList.add('hidden');
    let valid = true;
    valid = setFieldError(null, 'reg-name', name ? '' : 'Name is required') && valid;
    valid = setFieldError(null, 'reg-email', email ? '' : 'Email is required') && valid;
    valid = setFieldError(null, 'reg-password', password.length >= 6 ? '' : 'At least 6 characters') && valid;
    if (!valid) return;
    const btn = $('#register-submit');
    btn.disabled = true;
    btn.textContent = 'Creating account…';
    try {
      const data = await api('/api/auth/customer/register', {
        method: 'POST',
        body: { name, email, password, contactPhone: phone || undefined },
      });
      saveSession(data, email);
      e.target.reset();
      await showApp();
    } catch (err) {
      errBox.textContent = err.message || 'Registration failed';
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create account';
    }
  });

  $('#forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#forgot-email').value.trim();
    const msgBox = $('#forgot-msg');
    msgBox.classList.add('hidden');
    if (!setFieldError(null, 'forgot-email', email ? '' : 'Email is required')) return;
    const btn = $('#forgot-submit');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const res = await api('/api/auth/customer/forgot-password', { method: 'POST', body: { email } });
      msgBox.textContent = res.message || 'Request sent. The administrator will reset your password.';
      msgBox.classList.remove('hidden');
      msgBox.classList.add('ok-msg');
    } catch (err) {
      msgBox.textContent = err.message || 'Request failed';
      msgBox.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Request password reset';
    }
  });
}

/* ==========================================================================
   Health + polling
   ========================================================================== */

async function refreshHealth() {
  const dot = $('#health-dot');
  const label = $('#health-label');
  try {
    const h = await api('/api/health');
    const ok = h.status === 'ok' && h.mediamtx === 'up';
    dot.className = 'health-dot ' + (ok ? 'ok' : 'warn');
    label.textContent = ok ? 'Systems normal' : 'Degraded';
  } catch (e) {
    if (!state.token) return;
    dot.className = 'health-dot err';
    label.textContent = 'Unreachable';
  }
}

function startPolling() {
  stopPolling();
  state.cameraPoll = setInterval(async () => {
    try {
      state.cameras = await api('/api/portal/cameras');
      if (state.section === 'cameras') {
        reconcileGrid();
        updateHeader();
      }
    } catch (e) { /* transient — skip this tick */ }
  }, 5000);
  state.healthPoll = setInterval(refreshHealth, 15000);
  refreshHealth();
}

function stopPolling() {
  if (state.cameraPoll) { clearInterval(state.cameraPoll); state.cameraPoll = null; }
  if (state.healthPoll) { clearInterval(state.healthPoll); state.healthPoll = null; }
}

/* ==========================================================================
   Data loading
   ========================================================================== */

async function loadAll() {
  const [me, sites, cameras] = await Promise.all([
    api('/api/portal/me'),
    api('/api/portal/sites'),
    api('/api/portal/cameras'),
  ]);
  state.me = me;
  state.sites = sites || [];
  state.cameras = cameras || [];
  renderSiteFilter();
}

function renderSiteFilter() {
  const sel = $('#site-filter');
  const current = state.siteFilter;
  sel.innerHTML = '<option value="">All my sites</option>' + state.sites
    .map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  sel.value = current;
}

function siteOf(cam) {
  return cam.site || state.sites.find((s) => s.id === cam.siteId);
}

/* ==========================================================================
   Sections
   ========================================================================== */

function showSection(name) {
  state.section = name;
  document.querySelectorAll('.admin-section').forEach((s) => s.classList.add('hidden'));
  const section = $(`#section-${name}`);
  if (section) section.classList.remove('hidden');
  document.querySelectorAll('#portal-nav .nav-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.section === name));

  if (name === 'cameras') { reconcileGrid(); updateHeader(); }
  if (name === 'sites') renderSitesTable();
  if (name === 'support') loadMyIssues();
  if (name === 'account') renderAccount();
}

/* ==========================================================================
   Camera grid (same player lifecycle as the admin console)
   ========================================================================== */

function visibleCameras() {
  return state.cameras
    .filter((c) => !state.siteFilter || c.siteId === state.siteFilter)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function updateHeader() {
  $('#camera-count').textContent = String(visibleCameras().length);
}

function updateEmptyStates() {
  const grid = $('#camera-grid');
  const noSites = $('#empty-no-sites');
  const noCameras = $('#empty-no-cameras');

  if (state.sites.length === 0) {
    grid.classList.add('hidden');
    noCameras.classList.add('hidden');
    noSites.classList.remove('hidden');
    return;
  }
  noSites.classList.add('hidden');

  if (visibleCameras().length === 0) {
    grid.classList.add('hidden');
    noCameras.classList.remove('hidden');
    return;
  }
  noCameras.classList.add('hidden');
  grid.classList.remove('hidden');
}

function reconcileGrid() {
  updateEmptyStates();
  const grid = $('#camera-grid');
  const visible = visibleCameras();
  const visibleIds = new Set(visible.map((c) => c.id));

  for (const [id, entry] of cards) {
    if (!visibleIds.has(id)) {
      detachPlayer(entry);
      entry.card.remove();
      cards.delete(id);
    }
  }

  visible.forEach((cam, idx) => {
    let entry = cards.get(cam.id);
    if (!entry) {
      entry = buildCard(cam);
      cards.set(cam.id, entry);
    }
    updateCard(entry, cam);
    if (grid.children[idx] !== entry.card) {
      grid.insertBefore(entry.card, grid.children[idx] || null);
    }
  });
}

const STATUS_META = {
  online: { glyph: '●', label: 'Online' },
  pending: { glyph: '◌', label: 'Pending' },
  offline: { glyph: '○', label: 'Offline' },
};

function buildCard(cam) {
  const card = document.createElement('article');
  card.className = 'cam-card';
  card.dataset.id = cam.id;
  card.innerHTML = `
    <div class="player">
      <video muted autoplay playsinline></video>
      <div class="player-placeholder">
        <div class="ph-icon offline">○</div>
        <div class="ph-text">Camera offline</div>
      </div>
      <span class="live-tag">LIVE</span>
    </div>
    <div class="cam-body">
      <div class="cam-title-row">
        <div class="cam-titles">
          <div class="cam-name"></div>
          <div class="cam-crumb"></div>
        </div>
        <span class="badge offline"></span>
      </div>
      <div class="cam-meta"><span class="chip"></span></div>
      <div class="cam-actions">
        <button class="btn btn-sm" data-act="start">Start</button>
        <button class="btn btn-sm" data-act="stop">Stop</button>
        <button class="btn btn-sm" data-act="edit">Edit</button>
        <span class="spacer"></span>
        <button class="btn btn-sm btn-danger" data-act="delete">Delete</button>
      </div>
    </div>`;

  const entry = {
    card,
    video: card.querySelector('video'),
    hls: null,
    native: false,
    status: null,
    cam: null,
  };

  card.querySelector('[data-act="start"]').addEventListener('click', () => cameraAction(cam.id, 'start'));
  card.querySelector('[data-act="stop"]').addEventListener('click', () => cameraAction(cam.id, 'stop'));
  card.querySelector('[data-act="edit"]').addEventListener('click', () => {
    if (entry.cam) openCameraModal(entry.cam);
  });
  card.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    const c = entry.cam;
    if (!c) return;
    if (!confirm(`Delete camera "${c.name}"? This cannot be undone.`)) return;
    try {
      await api(`/api/portal/cameras/${c.id}`, { method: 'DELETE' });
      await refreshCameras();
    } catch (err) {
      alert(err.message || 'Failed to delete camera');
    }
  });

  return entry;
}

function updateCard(entry, cam) {
  const { card } = entry;

  card.querySelector('.cam-name').textContent = cam.name;
  const site = siteOf(cam);
  card.querySelector('.cam-crumb').textContent = site ? site.name : '—';

  const meta = STATUS_META[cam.status] || STATUS_META.offline;
  const badge = card.querySelector('.badge');
  badge.className = `badge ${cam.status}`;
  badge.textContent = `${meta.glyph} ${meta.label}`;

  const chip = card.querySelector('.chip');
  if (cam.sourceType === 'rtsp') {
    chip.textContent = 'RTSP';
    chip.title = cam.rtspUrl || '';
  } else {
    chip.textContent = cam.demoSource || 'demo';
    chip.title = cam.demoSource || '';
  }

  card.querySelector('[data-act="start"]').disabled = cam.status !== 'offline';
  card.querySelector('[data-act="stop"]').disabled = cam.status === 'offline';

  const hasPlayer = !!(entry.hls || entry.native);
  if (cam.status === 'online' && !hasPlayer) attachPlayer(entry, cam);
  if (cam.status !== 'online' && hasPlayer) detachPlayer(entry);

  if (cam.status !== 'online') {
    const icon = card.querySelector('.ph-icon');
    const text = card.querySelector('.ph-text');
    if (cam.status === 'pending') {
      icon.className = 'ph-icon pending';
      icon.textContent = '◌';
      text.textContent = 'Camera starting…';
    } else {
      icon.className = 'ph-icon offline';
      icon.textContent = '○';
      text.textContent = 'Camera offline';
    }
  }

  entry.status = cam.status;
  entry.cam = cam;
}

/* ==========================================================================
   HLS player lifecycle
   ========================================================================== */

function attachPlayer(entry, cam) {
  if (!cam.hlsUrl) return;
  const video = entry.video;
  if (window.Hls && window.Hls.isSupported()) {
    const hls = new Hls({ liveSyncDurationCount: 3 });
    hls.loadSource(cam.hlsUrl);
    hls.attachMedia(video);
    entry.hls = hls;
  } else if (
    video.canPlayType('application/vnd.apple.mpegurl') ||
    video.canPlayType('application/vnd.apple.mpegts')
  ) {
    video.src = cam.hlsUrl;
    entry.native = true;
  } else {
    return;
  }
  entry.card.classList.add('is-online');
  video.play().catch(() => { /* autoplay may need a user gesture */ });
}

function detachPlayer(entry) {
  if (entry.hls) {
    entry.hls.destroy();
    entry.hls = null;
  }
  entry.native = false;
  entry.video.pause();
  entry.video.removeAttribute('src');
  entry.video.load();
  entry.card.classList.remove('is-online');
}

function destroyAllPlayers() {
  for (const entry of cards.values()) detachPlayer(entry);
  cards.clear();
  const grid = $('#camera-grid');
  if (grid) grid.innerHTML = '';
}

async function refreshCameras() {
  state.cameras = await api('/api/portal/cameras');
  reconcileGrid();
  updateHeader();
}

async function cameraAction(id, action) {
  try {
    await api(`/api/portal/cameras/${id}/${action}`, { method: 'POST' });
    await refreshCameras();
  } catch (err) {
    alert(err.message || `Failed to ${action} camera`);
  }
}

/* ==========================================================================
   Modal system
   ========================================================================== */

let modalEscHandler = null;

function openModal({ title, bodyHTML, onSubmit, onOpen }) {
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-header">
        <h2>${esc(title)}</h2>
        <button type="button" class="modal-x" data-close aria-label="Close">×</button>
      </div>
      <form class="modal-form" novalidate>
        ${bodyHTML}
        <div class="form-error hidden" data-form-error></div>
        <div class="modal-footer">
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary" data-save>Save</button>
        </div>
      </form>
    </div>`;
  root.classList.remove('hidden');

  const form = root.querySelector('form');
  const saveBtn = root.querySelector('[data-save]');
  const errBox = root.querySelector('[data-form-error]');

  const close = () => closeModal();
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  modalEscHandler = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', modalEscHandler);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const result = await onSubmit(form);
      if (result !== false) close();
    } catch (err) {
      errBox.textContent = err.message || 'Save failed';
      errBox.classList.remove('hidden');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  if (onOpen) onOpen(form, close);
  const first = form.querySelector('input, select, textarea');
  if (first) first.focus();
}

function closeModal() {
  const root = $('#modal-root');
  root.classList.add('hidden');
  root.innerHTML = '';
  if (modalEscHandler) {
    document.removeEventListener('keydown', modalEscHandler);
    modalEscHandler = null;
  }
}

/** Set (or clear) an inline field error. Returns true when valid. */
function setFieldError(form, name, msg) {
  const root = form || document;
  const input = root.querySelector(`#${CSS.escape(name)}`);
  const errEl = root.querySelector(`[data-error-for="${CSS.escape(name)}"]`);
  if (input) input.classList.toggle('input-invalid', !!msg);
  if (errEl) {
    errEl.textContent = msg || '';
    errEl.classList.toggle('visible', !!msg);
  }
  return !msg;
}

function fieldHTML({ id, label, type = 'text', value = '', required = false, placeholder = '', textarea = false }) {
  const req = required ? ' <span class="req">*</span>' : '';
  const control = textarea
    ? `<textarea id="${id}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input id="${id}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
  return `
    <div class="field">
      <label for="${id}">${esc(label)}${req}</label>
      ${control}
      <div class="field-error" data-error-for="${id}"></div>
    </div>`;
}

/* ==========================================================================
   Sites (my sites: name, area/location, site owner)
   ========================================================================== */

function renderSitesTable() {
  const sites = state.sites;
  $('#sites-count').textContent = String(sites.length);
  if (!sites.length) {
    $('#sites-table').innerHTML =
      '<div class="dv-empty">No sites yet. Create your first site, then add cameras to it.</div>';
    return;
  }
  $('#sites-table').innerHTML = `
    <table class="table">
      <thead><tr>
        <th>Site name</th><th>Area / Location</th><th>Site owner</th><th>Cameras</th><th>Created</th><th></th>
      </tr></thead>
      <tbody>
        ${sites.map((s) => `
          <tr>
            <td><strong>${esc(s.name)}</strong></td>
            <td>${esc(s.address || '—')}</td>
            <td>${esc(s.owner || '—')}</td>
            <td>${(s.cameras || []).length}</td>
            <td>${esc(fmtTime(s.createdAt))}</td>
            <td class="row-actions">
              <button class="btn btn-sm" data-act="edit" data-id="${s.id}">Edit</button>
              <button class="btn btn-sm btn-danger" data-act="del" data-id="${s.id}">Delete</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  $('#sites-table').querySelectorAll('button[data-act]').forEach((btn) => {
    const site = state.sites.find((s) => s.id === btn.dataset.id);
    btn.addEventListener('click', () => {
      if (btn.dataset.act === 'edit') openSiteModal(site);
      if (btn.dataset.act === 'del') deleteSite(site);
    });
  });
}

function openSiteModal(site) {
  const isEdit = !!site;
  openModal({
    title: isEdit ? 'Edit Site' : 'Create Site',
    bodyHTML:
      fieldHTML({ id: 'site-name', label: 'Site name', required: true, value: site?.name || '', placeholder: 'HQ Berlin' }) +
      fieldHTML({ id: 'site-address', label: 'Site area / location', value: site?.address || '', placeholder: 'Street, city, country' }) +
      fieldHTML({ id: 'site-owner', label: 'Site owner', value: site?.owner || '', placeholder: 'Person responsible for this site' }),
    onSubmit: async (form) => {
      const name = $('#site-name', form).value.trim();
      if (!setFieldError(form, 'site-name', name ? '' : 'Site name is required')) return false;
      const body = {
        name,
        address: $('#site-address', form).value.trim() || null,
        owner: $('#site-owner', form).value.trim() || null,
      };
      if (isEdit) {
        await api(`/api/portal/sites/${site.id}`, { method: 'PATCH', body });
      } else {
        await api('/api/portal/sites', { method: 'POST', body });
      }
      await loadAll();
      if (state.section === 'sites') renderSitesTable();
      if (state.section === 'cameras') { reconcileGrid(); updateHeader(); }
    },
  });
}

async function deleteSite(site) {
  const camCount = (site.cameras || []).length;
  if (!confirm(`Delete site "${site.name}"? Its ${camCount} camera(s) will also be removed. This cannot be undone.`)) return;
  try {
    await api(`/api/portal/sites/${site.id}`, { method: 'DELETE' });
    if (state.siteFilter === site.id) state.siteFilter = '';
    await loadAll();
    renderSitesTable();
  } catch (err) {
    alert(err.message || 'Failed to delete site');
  }
}

/* ==========================================================================
   Camera modal
   ========================================================================== */

async function openCameraModal(camera) {
  const isEdit = !!camera;

  let demoSources = [];
  try {
    demoSources = await api('/api/portal/cameras/demo-sources');
  } catch { demoSources = []; }

  const siteOptions = ['<option value="">Select a site…</option>']
    .concat(state.sites.map((s) =>
      `<option value="${esc(s.id)}"${camera && camera.siteId === s.id ? ' selected' : ''}>${esc(s.name)}</option>`)).join('');

  const sourceType = camera ? camera.sourceType : 'demo';
  const demoOptions = ['<option value="">Select a demo source…</option>']
    .concat(demoSources.map((f) =>
      `<option value="${esc(f)}"${camera && camera.demoSource === f ? ' selected' : ''}>${esc(f)}</option>`)).join('');

  openModal({
    title: isEdit ? 'Edit Camera' : 'Add Camera',
    bodyHTML:
      fieldHTML({ id: 'cam-name', label: 'Name', required: true, value: camera?.name || '', placeholder: 'Front Gate' }) +
      `<div class="field">
         <label for="cam-site">Site <span class="req">*</span></label>
         <select id="cam-site">${siteOptions}</select>
         <div class="field-error" data-error-for="cam-site"></div>
       </div>
       <div class="field">
         <label>Source type</label>
         <div class="segmented" id="cam-source-type">
           <button type="button" data-type="demo" class="${sourceType === 'demo' ? 'active' : ''}">Demo file</button>
           <button type="button" data-type="rtsp" class="${sourceType === 'rtsp' ? 'active' : ''}">RTSP URL</button>
         </div>
       </div>
       <div class="field" id="cam-demo-field">
         <label for="cam-demo-source">Demo source <span class="req">*</span></label>
         <select id="cam-demo-source">${demoOptions}</select>
         <div class="field-error" data-error-for="cam-demo-source"></div>
       </div>
       <div class="field hidden" id="cam-rtsp-field">
         <label for="cam-rtsp-url">RTSP URL <span class="req">*</span></label>
         <input id="cam-rtsp-url" type="text" value="${esc(camera?.rtspUrl || '')}" placeholder="rtsp://camera.example/stream">
         <div class="field-error" data-error-for="cam-rtsp-url"></div>
       </div>`,
    onOpen: (form) => {
      const seg = $('#cam-source-type', form);
      const applyType = (type) => {
        seg.dataset.value = type;
        seg.querySelectorAll('button').forEach((b) =>
          b.classList.toggle('active', b.dataset.type === type));
        $('#cam-demo-field', form).classList.toggle('hidden', type !== 'demo');
        $('#cam-rtsp-field', form).classList.toggle('hidden', type !== 'rtsp');
      };
      seg.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => applyType(b.dataset.type)));
      applyType(sourceType);
    },
    onSubmit: async (form) => {
      const name = $('#cam-name', form).value.trim();
      const siteId = $('#cam-site', form).value;
      const type = $('#cam-source-type', form).dataset.value || 'demo';
      const demoSource = $('#cam-demo-source', form).value;
      const rtspUrl = $('#cam-rtsp-url', form).value.trim();

      let valid = setFieldError(form, 'cam-name', name ? '' : 'Name is required');
      valid = setFieldError(form, 'cam-site', siteId ? '' : 'Site is required') && valid;
      if (type === 'demo') {
        valid = setFieldError(form, 'cam-demo-source', demoSource ? '' : 'Select a demo source') && valid;
      } else {
        valid = setFieldError(form, 'cam-rtsp-url', rtspUrl ? '' : 'RTSP URL is required') && valid;
      }
      if (!valid) return false;

      if (!isEdit) {
        const body = { name, siteId, sourceType: type };
        if (type === 'demo') body.demoSource = demoSource;
        else body.rtspUrl = rtspUrl;
        await api('/api/portal/cameras', { method: 'POST', body });
      } else {
        const payload = {};
        if (name !== camera.name) payload.name = name;
        if (siteId !== camera.siteId) payload.siteId = siteId;
        if (type !== camera.sourceType) {
          payload.sourceType = type;
          if (type === 'demo') payload.demoSource = demoSource;
          else payload.rtspUrl = rtspUrl;
        } else if (type === 'demo' && demoSource !== (camera.demoSource || '')) {
          payload.demoSource = demoSource;
        } else if (type === 'rtsp' && rtspUrl !== (camera.rtspUrl || '')) {
          payload.rtspUrl = rtspUrl;
        }
        const sourceChanged =
          'sourceType' in payload || 'demoSource' in payload || 'rtspUrl' in payload;
        const wasOnline = camera.status === 'online';
        if (Object.keys(payload).length) {
          await api(`/api/portal/cameras/${camera.id}`, { method: 'PATCH', body: payload });
        }
        if (sourceChanged && wasOnline) {
          await api(`/api/portal/cameras/${camera.id}/stop`, { method: 'POST' });
          await api(`/api/portal/cameras/${camera.id}/start`, { method: 'POST' });
        }
      }
      await refreshCameras();
    },
  });
}

/* ==========================================================================
   Support (report issue + my issues)
   ========================================================================== */

function bindSupport() {
  $('#issue-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgBox = $('#issue-msg');
    msgBox.classList.add('hidden');
    const subject = $('#issue-subject').value.trim();
    const message = $('#issue-message').value.trim();
    let valid = setFieldError(null, 'issue-subject', subject ? '' : 'Subject is required');
    valid = setFieldError(null, 'issue-message', message ? '' : 'Please describe the problem') && valid;
    if (!valid) return;
    try {
      await api('/api/portal/issues', {
        method: 'POST',
        body: { category: $('#issue-category').value, subject, message },
      });
      $('#issue-subject').value = '';
      $('#issue-message').value = '';
      msgBox.textContent = 'Sent! The admin team has been notified.';
      msgBox.classList.add('ok-msg');
      msgBox.classList.remove('hidden');
      await loadMyIssues();
    } catch (err) {
      msgBox.textContent = err.message || 'Failed to send';
      msgBox.classList.remove('hidden');
    }
  });
}

async function loadMyIssues() {
  let issues;
  try {
    issues = await api('/api/portal/issues');
  } catch (err) {
    $('#my-issues-list').innerHTML = `<div class="dv-empty">${esc(err.message)}</div>`;
    return;
  }
  if (!issues.length) {
    $('#my-issues-list').innerHTML = '<div class="dv-empty">You have not reported any issues.</div>';
    return;
  }
  const catLabel = {
    'camera-view': 'Cannot view camera',
    'login': 'Login problem',
    'password': 'Password / account',
    'editing': 'Cannot edit / change',
    'other': 'Other',
  };
  $('#my-issues-list').innerHTML = issues.map((issue) => `
    <div class="issue-card">
      <div class="issue-head">
        <span class="badge ${issue.status === 'open' ? 'pending' : 'online'}">${issue.status}</span>
        <span class="chip">${esc(catLabel[issue.category] || issue.category)}</span>
        <strong>${esc(issue.subject)}</strong>
        <span class="spacer"></span>
        <span class="muted-sm">${esc(fmtTime(issue.createdAt))}</span>
      </div>
      <div class="issue-body">${esc(issue.message)}</div>
      ${issue.adminNote ? `<div class="issue-meta">Admin note: ${esc(issue.adminNote)}</div>` : ''}
    </div>`).join('');
}

/* ==========================================================================
   Account (profile + change password)
   ========================================================================== */

function renderAccount() {
  const me = state.me;
  if (!me) return;
  $('#account-summary').innerHTML = `
    <div><span class="muted-sm">Login email</span><br>${esc(me.email)}</div>
    <div><span class="muted-sm">Last sign-in</span><br>${esc(fmtTime(me.lastLoginAt))}</div>
    <div><span class="muted-sm">Member since</span><br>${esc(fmtTime(me.createdAt))}</div>
    <div><span class="muted-sm">Usage</span><br>${me.siteCount} site(s), ${me.cameraCount} camera(s)</div>`;
  $('#prof-name').value = me.name || '';
  $('#prof-phone').value = me.contactPhone || '';
}

function bindAccount() {
  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgBox = $('#profile-msg');
    msgBox.classList.add('hidden');
    msgBox.classList.remove('ok-msg');
    const name = $('#prof-name').value.trim();
    if (!setFieldError(null, 'prof-name', name ? '' : 'Name is required')) return;
    try {
      state.me = await api('/api/portal/me', {
        method: 'PATCH',
        body: { name, contactPhone: $('#prof-phone').value.trim() || null },
      });
      renderAccount();
      msgBox.textContent = 'Profile saved.';
      msgBox.classList.add('ok-msg');
      msgBox.classList.remove('hidden');
    } catch (err) {
      msgBox.textContent = err.message || 'Save failed';
      msgBox.classList.remove('hidden');
    }
  });

  $('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgBox = $('#password-msg');
    msgBox.classList.add('hidden');
    msgBox.classList.remove('ok-msg');
    const currentPassword = $('#pw-current').value;
    const newPassword = $('#pw-new').value;
    let valid = setFieldError(null, 'pw-current', currentPassword ? '' : 'Current password is required');
    valid = setFieldError(null, 'pw-new', newPassword.length >= 6 ? '' : 'At least 6 characters') && valid;
    if (!valid) return;
    try {
      await api('/api/portal/me/password', { method: 'POST', body: { currentPassword, newPassword } });
      $('#pw-current').value = '';
      $('#pw-new').value = '';
      msgBox.textContent = 'Password changed.';
      msgBox.classList.add('ok-msg');
      msgBox.classList.remove('hidden');
    } catch (err) {
      msgBox.textContent = err.message || 'Failed to change password';
      msgBox.classList.remove('hidden');
    }
  });
}

/* ==========================================================================
   Init
   ========================================================================== */

function bindShell() {
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-add-camera').addEventListener('click', () => {
    if (!state.sites.length) { openSiteModal(null); return; }
    openCameraModal(null);
  });
  $('#btn-empty-add-camera').addEventListener('click', () => {
    if (!state.sites.length) { openSiteModal(null); return; }
    openCameraModal(null);
  });
  $('#btn-empty-add-site').addEventListener('click', () => openSiteModal(null));
  $('#btn-add-site').addEventListener('click', () => openSiteModal(null));
  $('#site-filter').addEventListener('change', (e) => {
    state.siteFilter = e.target.value;
    reconcileGrid();
    updateHeader();
  });
  document.querySelectorAll('#portal-nav .nav-item').forEach((btn) =>
    btn.addEventListener('click', () => showSection(btn.dataset.section)));
}

async function init() {
  bindAuth();
  bindShell();
  bindSupport();
  bindAccount();
  if (state.token) {
    try {
      await showApp();
      return;
    } catch (e) {
      if (state.token) showLogin(); else return; // 401 already showed login
    }
  }
  showLogin();
}

init();
