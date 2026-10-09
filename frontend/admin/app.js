'use strict';

/* ==========================================================================
   CamMonitor — ADMIN console (staff only). Customers use /portal/.
   ========================================================================== */

const TOKEN_KEY = 'cm_admin_token';
const USER_KEY = 'cm_admin_user';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  userEmail: localStorage.getItem(USER_KEY) || null,
  customers: [],
  sites: [],
  cameras: [],
  selectedSiteId: null, // null = all cameras
  expanded: new Set(),  // expanded customer ids in sidebar
  cameraPoll: null,
  healthPoll: null,
  section: 'overview',
  adminCustomers: [], // enriched rows from /api/admin/customers
};

/** cameraId -> { card, video, hls|null, native:boolean, status, cam } */
const cards = new Map();

const $ = (sel, root = document) => root.querySelector(sel);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
  if (res.status === 204) return null;
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
   Auth & views
   ========================================================================== */

function decodeJwtEmail(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).email || null;
  } catch { return null; }
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
  $('#user-email').textContent = state.userEmail || decodeJwtEmail(state.token) || '';
  await loadAll();
  renderSidebar();
  reconcileGrid();
  updateHeader();
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
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  showLogin();
}

function bindLogin() {
  const form = $('#login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    const errBox = $('#login-error');
    errBox.classList.add('hidden');
    let valid = true;
    valid = setFieldError(form, 'login-email', email ? '' : 'Email is required') && valid;
    valid = setFieldError(form, 'login-password', password ? '' : 'Password is required') && valid;
    if (!valid) return;
    const btn = $('#login-submit');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      state.token = data.access_token;
      state.userEmail = (data.user && data.user.email) || email;
      localStorage.setItem(TOKEN_KEY, state.token);
      localStorage.setItem(USER_KEY, state.userEmail);
      form.reset();
      await showApp();
    } catch (err) {
      errBox.textContent = err.message || 'Login failed';
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
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
    if (!state.token) return; // logged out meanwhile
    dot.className = 'health-dot err';
    label.textContent = 'Unreachable';
  }
}

function startPolling() {
  stopPolling();
  state.cameraPoll = setInterval(async () => {
    try {
      state.cameras = await api('/api/cameras');
      reconcileGrid();
      updateHeader();
    } catch (e) {
      // 401 already handled by api(); transient network errors: skip this tick
    }
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
  const [customers, sites, cameras] = await Promise.all([
    api('/api/customers'),
    api('/api/sites'),
    api('/api/cameras'),
  ]);
  state.customers = customers || [];
  state.sites = sites || [];
  state.cameras = cameras || [];
}

function breadcrumb(cam) {
  const site = cam.site || state.sites.find((s) => s.id === cam.siteId);
  const cust = site && (site.customer || state.customers.find((c) => c.id === site.customerId));
  const siteName = site ? site.name : '—';
  const custName = cust ? cust.name : '—';
  return `${custName} › ${siteName}`;
}

/* ==========================================================================
   Sidebar (organization tree)
   ========================================================================== */

function renderSidebar() {
  const tree = $('#org-tree');
  tree.innerHTML = '';

  // "All cameras" root item
  const all = document.createElement('button');
  all.className = 'tree-item tree-all' + (state.selectedSiteId === null ? ' selected' : '');
  all.innerHTML = `<span class="chev"></span><span class="tree-label">All cameras</span>`;
  all.addEventListener('click', () => selectSite(null));
  tree.appendChild(all);

  const customers = [...state.customers].sort((a, b) => a.name.localeCompare(b.name));
  if (!customers.length) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.textContent = 'No customers yet.';
    tree.appendChild(empty);
    return;
  }

  for (const cust of customers) {
    const custSites = state.sites
      .filter((s) => s.customerId === cust.id)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!state.expanded.has(cust.id)) state.expanded.add(cust.id); // default expanded

    const row = document.createElement('button');
    row.className = 'tree-item' + (state.expanded.has(cust.id) ? ' expanded' : '');
    row.innerHTML =
      `<span class="chev">▸</span>` +
      `<span class="tree-label" title="${esc(cust.name)}">${esc(cust.name)}</span>` +
      `<span class="tree-edit" title="Edit customer">Edit</span>`;
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('tree-edit')) return;
      if (state.expanded.has(cust.id)) state.expanded.delete(cust.id);
      else state.expanded.add(cust.id);
      renderSidebar();
    });
    row.querySelector('.tree-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openCustomerModal(cust);
    });
    tree.appendChild(row);

    if (state.expanded.has(cust.id)) {
      const children = document.createElement('div');
      children.className = 'tree-children';
      if (!custSites.length) {
        const none = document.createElement('div');
        none.className = 'tree-empty';
        none.textContent = 'No sites';
        children.appendChild(none);
      }
      for (const site of custSites) {
        const srow = document.createElement('button');
        srow.className = 'tree-item' + (state.selectedSiteId === site.id ? ' selected' : '');
        srow.innerHTML =
          `<span class="chev"></span>` +
          `<span class="tree-label" title="${esc(site.name)}">${esc(site.name)}</span>` +
          `<span class="tree-edit" title="Edit site">Edit</span>`;
        srow.addEventListener('click', (e) => {
          if (e.target.classList.contains('tree-edit')) return;
          selectSite(site.id);
        });
        srow.querySelector('.tree-edit').addEventListener('click', (e) => {
          e.stopPropagation();
          openSiteModal(site);
        });
        children.appendChild(srow);
      }
      tree.appendChild(children);
    }
  }
}

function selectSite(siteId) {
  state.selectedSiteId = siteId;
  renderSidebar();
  reconcileGrid();
  updateHeader();
}

/* ==========================================================================
   Main header + camera grid
   ========================================================================== */

function visibleCameras() {
  return state.cameras
    .filter((c) => state.selectedSiteId === null || c.siteId === state.selectedSiteId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function updateHeader() {
  const site = state.selectedSiteId
    ? state.sites.find((s) => s.id === state.selectedSiteId)
    : null;
  $('#main-title').textContent = site ? site.name : 'Cameras';
  $('#camera-count').textContent = String(visibleCameras().length);
}

function updateEmptyStates() {
  const grid = $('#camera-grid');
  const noCustomers = $('#empty-no-customers');
  const noCameras = $('#empty-no-cameras');

  if (state.customers.length === 0) {
    grid.classList.add('hidden');
    noCameras.classList.add('hidden');
    noCustomers.classList.remove('hidden');
    return;
  }
  noCustomers.classList.add('hidden');

  if (visibleCameras().length === 0) {
    grid.classList.add('hidden');
    noCameras.classList.remove('hidden');
    if (state.selectedSiteId) {
      $('#empty-no-cameras-title').textContent = 'No cameras at this site yet';
      $('#empty-no-cameras-text').textContent = 'Add a camera to start monitoring this site.';
    } else {
      $('#empty-no-cameras-title').textContent = 'No cameras yet';
      $('#empty-no-cameras-text').textContent = 'Add your first camera to start monitoring.';
    }
    return;
  }
  noCameras.classList.add('hidden');
  grid.classList.remove('hidden');
}

/**
 * Reconcile grid DOM with current camera list.
 * Cards are created/removed only as needed; existing cards are updated in
 * place so healthy HLS players are never torn down by a poll.
 */
function reconcileGrid() {
  updateEmptyStates();
  const grid = $('#camera-grid');
  const visible = visibleCameras();
  const visibleIds = new Set(visible.map((c) => c.id));

  // Remove cards for cameras that disappeared or are filtered out
  for (const [id, entry] of cards) {
    if (!visibleIds.has(id)) {
      detachPlayer(entry);
      entry.card.remove();
      cards.delete(id);
    }
  }

  // Create/update cards and enforce order
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
      await api(`/api/cameras/${c.id}`, { method: 'DELETE' });
      await refreshCameras();
    } catch (err) {
      alert(err.message || 'Failed to delete camera');
    }
  });

  return entry;
}

/** Update an existing card in place; manage player lifecycle on transitions. */
function updateCard(entry, cam) {
  const { card } = entry;

  card.querySelector('.cam-name').textContent = cam.name;
  card.querySelector('.cam-crumb').textContent = breadcrumb(cam);

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

  // Player lifecycle: attach only on transition to online, detach when leaving it
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
    hls.loadSource(cam.hlsUrl); // relative /api/hls/... URL — ngrok-safe, use as-is
    hls.attachMedia(video);
    entry.hls = hls;
  } else if (
    video.canPlayType('application/vnd.apple.mpegurl') ||
    video.canPlayType('application/vnd.apple.mpegts')
  ) {
    video.src = cam.hlsUrl;
    entry.native = true;
  } else {
    return; // no HLS support — keep placeholder
  }
  entry.card.classList.add('is-online');
  video.play().catch(() => { /* autoplay may need a user gesture */ });
}

function detachPlayer(entry) {
  if (entry.hls) {
    entry.hls.destroy();
    entry.hls = null;
  }
  if (entry.native) {
    entry.native = false;
  }
  entry.video.pause();
  entry.video.removeAttribute('src');
  entry.video.load();
  entry.card.classList.remove('is-online');
}

function destroyAllPlayers() {
  for (const entry of cards.values()) detachPlayer(entry);
  cards.clear();
  $('#camera-grid').innerHTML = '';
}

async function refreshCameras() {
  state.cameras = await api('/api/cameras');
  reconcileGrid();
  updateHeader();
}

async function cameraAction(id, action) {
  try {
    await api(`/api/cameras/${id}/${action}`, { method: 'POST' });
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
  const input = form.querySelector(`#${CSS.escape(name)}`);
  const errEl = form.querySelector(`[data-error-for="${CSS.escape(name)}"]`);
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
   Customer modal
   ========================================================================== */

function openCustomerModal(customer) {
  const isEdit = !!customer;
  openModal({
    title: isEdit ? 'Edit Customer' : 'Add Customer',
    bodyHTML:
      fieldHTML({ id: 'cust-name', label: 'Name', required: true, value: customer?.name || '', placeholder: 'Acme GmbH' }) +
      fieldHTML({ id: 'cust-email', label: 'Contact email', type: 'email', value: customer?.contactEmail || '', placeholder: 'ops@acme.example' }) +
      fieldHTML({ id: 'cust-phone', label: 'Contact phone', value: customer?.contactPhone || '', placeholder: '+49 30 000000' }) +
      fieldHTML({ id: 'cust-notes', label: 'Notes', textarea: true, value: customer?.notes || '', placeholder: 'Optional notes…' }),
    onSubmit: async (form) => {
      const name = $('#cust-name', form).value.trim();
      if (!setFieldError(form, 'cust-name', name ? '' : 'Name is required')) return false;
      const body = {
        name,
        contactEmail: $('#cust-email', form).value.trim() || null,
        contactPhone: $('#cust-phone', form).value.trim() || null,
        notes: $('#cust-notes', form).value.trim() || null,
      };
      if (isEdit) {
        await api(`/api/customers/${customer.id}`, { method: 'PATCH', body });
      } else {
        const created = await api('/api/customers', { method: 'POST', body });
        if (created && created.id) state.expanded.add(created.id);
      }
      await loadAll();
      renderSidebar();
      reconcileGrid();
      updateHeader();
    },
  });
}

/* ==========================================================================
   Site modal
   ========================================================================== */

function openSiteModal(site) {
  const isEdit = !!site;
  const customers = [...state.customers].sort((a, b) => a.name.localeCompare(b.name));
  const options = ['<option value="">Select a customer…</option>']
    .concat(customers.map((c) =>
      `<option value="${esc(c.id)}"${site && site.customerId === c.id ? ' selected' : ''}>${esc(c.name)}</option>`))
    .join('');

  openModal({
    title: isEdit ? 'Edit Site' : 'Add Site',
    bodyHTML:
      fieldHTML({ id: 'site-name', label: 'Name', required: true, value: site?.name || '', placeholder: 'HQ Berlin' }) +
      `<div class="field">
         <label for="site-customer">Customer <span class="req">*</span></label>
         <select id="site-customer">${options}</select>
         <div class="field-error" data-error-for="site-customer"></div>
       </div>` +
      fieldHTML({ id: 'site-address', label: 'Area / Location', value: site?.address || '', placeholder: 'Street, city, country' }) +
      fieldHTML({ id: 'site-owner', label: 'Site owner', value: site?.owner || '', placeholder: 'Person responsible for the site' }),
    onSubmit: async (form) => {
      const name = $('#site-name', form).value.trim();
      const customerId = $('#site-customer', form).value;
      let valid = setFieldError(form, 'site-name', name ? '' : 'Name is required');
      valid = setFieldError(form, 'site-customer', customerId ? '' : 'Customer is required') && valid;
      if (!valid) return false;
      const body = {
        name,
        customerId,
        address: $('#site-address', form).value.trim() || null,
        owner: $('#site-owner', form).value.trim() || null,
      };
      if (isEdit) {
        await api(`/api/sites/${site.id}`, { method: 'PATCH', body });
      } else {
        await api('/api/sites', { method: 'POST', body });
        state.expanded.add(customerId);
      }
      await loadAll();
      renderSidebar();
      reconcileGrid();
      updateHeader();
    },
  });
}

/* ==========================================================================
   Camera modal
   ========================================================================== */

async function openCameraModal(camera) {
  const isEdit = !!camera;

  // Fetch available demo sources for the dropdown
  let demoSources = [];
  try {
    demoSources = await api('/api/cameras/demo-sources');
  } catch { demoSources = []; }

  const customers = [...state.customers].sort((a, b) => a.name.localeCompare(b.name));
  const siteGroups = customers.map((cust) => {
    const sites = state.sites
      .filter((s) => s.customerId === cust.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!sites.length) return '';
    const opts = sites.map((s) =>
      `<option value="${esc(s.id)}"${camera && camera.siteId === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    return `<optgroup label="${esc(cust.name)}">${opts}</optgroup>`;
  }).join('');

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
         <select id="cam-site">
           <option value="">Select a site…</option>
           ${siteGroups}
         </select>
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
        await api('/api/cameras', { method: 'POST', body });
      } else {
        // PATCH only changed fields
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
          await api(`/api/cameras/${camera.id}`, { method: 'PATCH', body: payload });
        }
        // Changing the source re-provisions: bounce the stream if it was live
        if (sourceChanged && wasOnline) {
          await api(`/api/cameras/${camera.id}/stop`, { method: 'POST' });
          await api(`/api/cameras/${camera.id}/start`, { method: 'POST' });
        }
      }
      await refreshCameras();
    },
  });
}

/* ==========================================================================
   Demo video sources modal (list / upload / delete files in videos/)
   ========================================================================== */

function openDemoSourcesModal() {
  openModal({
    title: 'Demo Video Sources',
    bodyHTML:
      `<div class="field">
         <label for="dv-file">Upload a video</label>
         <div class="dv-upload-row">
           <input id="dv-file" type="file" accept="video/*,.mp4,.mov,.mkv,.webm">
           <button type="button" class="btn" id="dv-upload">Upload</button>
         </div>
         <div class="dv-hint">You can also copy .mp4 files into the videos/ folder — they appear here automatically.</div>
       </div>
       <div class="dv-list" id="dv-list"></div>`,
    onOpen: (form) => {
      // This modal manages data inline — no Save button needed
      const saveBtn = form.querySelector('[data-save]');
      if (saveBtn) saveBtn.classList.add('hidden');
      const cancelBtn = form.querySelector('[data-close]');
      if (cancelBtn) cancelBtn.textContent = 'Close';
      $('#dv-upload', form).addEventListener('click', () => uploadDemoSource(form));
      renderDemoSourcesList(form);
    },
    onSubmit: () => false, // Enter key must not close the modal
  });
}

async function renderDemoSourcesList(form) {
  const list = $('#dv-list', form);
  if (!list) return;
  try {
    const sources = await api('/api/cameras/demo-sources');
    if (!sources || !sources.length) {
      list.innerHTML = '<div class="dv-empty">No demo videos found in videos/</div>';
      return;
    }
    list.innerHTML = '';
    for (const name of sources) {
      const row = document.createElement('div');
      row.className = 'dv-row';
      row.innerHTML =
        `<span class="chip" title="${esc(name)}">${esc(name)}</span>` +
        `<button type="button" class="btn btn-sm btn-danger">Delete</button>`;
      row.querySelector('button').addEventListener('click', () => deleteDemoSource(form, name));
      list.appendChild(row);
    }
  } catch (err) {
    list.innerHTML = `<div class="dv-empty">${esc(err.message || 'Failed to load demo sources')}</div>`;
  }
}

async function deleteDemoSource(form, filename) {
  if (!confirm(`Delete demo video "${filename}"? This cannot be undone.`)) return;
  const errBox = form.querySelector('[data-form-error]');
  errBox.classList.add('hidden');
  try {
    await api(`/api/cameras/demo-sources/${encodeURIComponent(filename)}`, { method: 'DELETE' });
  } catch (err) {
    // e.g. 409 — the file is in use by a camera
    errBox.textContent = err.message || 'Failed to delete demo video';
    errBox.classList.remove('hidden');
  }
  await renderDemoSourcesList(form);
}

async function uploadDemoSource(form) {
  const input = $('#dv-file', form);
  const errBox = form.querySelector('[data-form-error]');
  const file = input.files && input.files[0];
  errBox.classList.add('hidden');
  if (!file) {
    errBox.textContent = 'Choose a video file first';
    errBox.classList.remove('hidden');
    return;
  }

  const btn = $('#dv-upload', form);
  btn.disabled = true;
  btn.textContent = 'Uploading…';
  try {
    const formData = new FormData();
    formData.append('file', file);
    // fetch directly: multipart boundary must be set by the browser
    const res = await fetch('/api/cameras/demo-sources/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
      body: formData,
    });
    if (res.status === 401) {
      handleUnauthorized();
      throw new Error('Session expired. Please sign in again.');
    }
    if (!res.ok) {
      let msg = `Upload failed (${res.status})`;
      try {
        const data = await res.json();
        if (data && data.message) {
          msg = Array.isArray(data.message) ? data.message.join(', ') : data.message;
        }
      } catch { /* keep default message */ }
      throw new Error(msg);
    }
    input.value = '';
    await renderDemoSourcesList(form);
  } catch (err) {
    errBox.textContent = err.message || 'Upload failed';
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload';
  }
}

/* ==========================================================================
   Admin sections (nav + views)
   ========================================================================== */

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString();
}

function fmtAgo(iso) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function showSection(name) {
  state.section = name;
  document.querySelectorAll('.admin-section').forEach((s) => s.classList.add('hidden'));
  const section = $(`#section-${name}`);
  if (section) section.classList.remove('hidden');
  document.querySelectorAll('#admin-nav .nav-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.section === name));
  // Org tree only matters for the camera console
  $('#org-panel').classList.toggle('hidden', name !== 'cameras');

  if (name === 'overview') loadOverview();
  if (name === 'customers') loadAdminCustomers();
  if (name === 'issues') loadIssues();
  if (name === 'resets') loadResets();
  if (name === 'activity') loadActivity();
  if (name === 'cameras') { loadAll().then(() => { renderSidebar(); reconcileGrid(); updateHeader(); }); }
}

function setNavBadge(id, count) {
  const el = $(id);
  if (!el) return;
  el.textContent = String(count);
  el.classList.toggle('hidden', !count);
}

/* ------------------------------- overview ------------------------------- */

async function loadOverview() {
  try {
    const o = await api('/api/admin/overview');
    setNavBadge('#nav-badge-issues', o.openIssues);
    setNavBadge('#nav-badge-resets', o.pendingResetRequests);
    setNavBadge('#nav-badge-customers', o.inactiveCustomers);

    const stats = [
      ['Customers', o.customers], ['Sites', o.sites], ['Cameras', o.cameras],
      ['Cameras online', o.camerasOnline], ['Cameras offline', o.camerasOffline],
      ['Open issues', o.openIssues], ['Password resets pending', o.pendingResetRequests],
      ['Inactive customers', o.inactiveCustomers],
    ];
    $('#stat-grid').innerHTML = stats.map(([label, value]) =>
      `<div class="stat-card"><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div></div>`).join('');

    const attention = [];
    if (o.pendingResetRequests) attention.push(`${o.pendingResetRequests} password reset request(s) waiting — see Password Resets.`);
    if (o.openIssues) attention.push(`${o.openIssues} open support issue(s) — see Issues.`);
    if (o.inactiveCustomers) attention.push(`${o.inactiveCustomers} customer(s) have not signed in for over 14 days — see Customers.`);
    if (o.camerasOffline) attention.push(`${o.camerasOffline} camera(s) offline — see Camera Console.`);
    $('#attention-list').innerHTML = attention.length
      ? attention.map((a) => `<div class="attention-item">⚠ ${esc(a)}</div>`).join('')
      : '<div class="attention-item ok">✓ Everything looks good.</div>';
  } catch (err) {
    $('#stat-grid').innerHTML = `<div class="dv-empty">${esc(err.message)}</div>`;
  }
}

/* ------------------------------- customers ------------------------------ */

async function loadAdminCustomers() {
  try {
    state.adminCustomers = await api('/api/admin/customers');
  } catch (err) {
    state.adminCustomers = [];
    $('#customers-table').innerHTML = `<div class="dv-empty">${esc(err.message)}</div>`;
    return;
  }
  renderCustomersTable();
}

function renderCustomersTable() {
  const rows = state.adminCustomers;
  $('#customers-count').textContent = String(rows.length);
  if (!rows.length) {
    $('#customers-table').innerHTML =
      '<div class="dv-empty">No customers yet. Customers register themselves on the <a href="/portal/">customer portal</a>.</div>';
    return;
  }
  $('#customers-table').innerHTML = `
    <table class="table">
      <thead><tr>
        <th>Customer</th><th>Portal login</th><th>Sites</th><th>Cameras</th>
        <th>Last sign-in</th><th>Flags</th><th></th>
      </tr></thead>
      <tbody>
        ${rows.map((c) => `
          <tr>
            <td><strong>${esc(c.name)}</strong><div class="muted-sm">${esc(c.contactPhone || '')}</div></td>
            <td>${c.hasLogin ? esc(c.email) : '<span class="badge offline">no login</span>'}</td>
            <td>${c.siteCount}</td>
            <td>${c.cameraCount} <span class="muted-sm">(${c.camerasOnline} online)</span></td>
            <td title="${esc(fmtTime(c.lastLoginAt))}">${esc(fmtAgo(c.lastLoginAt))}</td>
            <td>
              ${c.inactive ? '<span class="badge pending">inactive</span>' : ''}
              ${!c.hasLogin ? '<span class="badge offline">no login</span>' : ''}
            </td>
            <td class="row-actions">
              <button class="btn btn-sm" data-act="view" data-id="${c.id}">View</button>
              <button class="btn btn-sm" data-act="cred" data-id="${c.id}">Set password</button>
              <button class="btn btn-sm btn-danger" data-act="del" data-id="${c.id}">Delete</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  $('#customers-table').querySelectorAll('button[data-act]').forEach((btn) => {
    const c = state.adminCustomers.find((x) => x.id === btn.dataset.id);
    btn.addEventListener('click', () => {
      if (btn.dataset.act === 'view') openCustomerDetail(c.id);
      if (btn.dataset.act === 'cred') openCredentialsModal(c);
      if (btn.dataset.act === 'del') deleteAdminCustomer(c);
    });
  });
}

async function openCustomerDetail(id) {
  let detail;
  try {
    detail = await api(`/api/admin/customers/${id}`);
  } catch (err) {
    alert(err.message || 'Failed to load customer');
    return;
  }
  const sites = detail.sites || [];
  openModal({
    title: `Customer — ${detail.name}`,
    bodyHTML: `
      <div class="detail-grid">
        <div><span class="muted-sm">Portal login</span><br>${detail.hasLogin ? esc(detail.email) : '— (no login yet)'}</div>
        <div><span class="muted-sm">Last sign-in</span><br>${esc(fmtTime(detail.lastLoginAt))} (${esc(fmtAgo(detail.lastLoginAt))})</div>
        <div><span class="muted-sm">Registered</span><br>${esc(fmtTime(detail.createdAt))}</div>
        <div><span class="muted-sm">Contact</span><br>${esc(detail.contactPhone || detail.contactEmail || '—')}</div>
      </div>
      <h4 class="modal-subhead">Sites &amp; cameras</h4>
      ${sites.length ? sites.map((s) => `
        <div class="detail-site">
          <strong>${esc(s.name)}</strong>
          <span class="muted-sm">${esc(s.address || 'no location')}${s.owner ? ` · owner: ${esc(s.owner)}` : ''}</span>
          <ul>${(s.cameras || []).map((cam) =>
            `<li>${esc(cam.name)} <span class="badge ${cam.status}">${cam.status}</span></li>`).join('') || '<li class="muted-sm">no cameras</li>'}</ul>
        </div>`).join('') : '<div class="muted-sm">No sites yet.</div>'}
      <h4 class="modal-subhead">Recent activity</h4>
      ${(detail.activity || []).slice(0, 10).map((a) =>
        `<div class="activity-row"><span class="muted-sm">${esc(fmtTime(a.createdAt))}</span> ${esc(a.detail || a.action)}</div>`).join('')
        || '<div class="muted-sm">No recorded activity.</div>'}
      <h4 class="modal-subhead">Support issues</h4>
      ${(detail.issues || []).map((i) =>
        `<div class="activity-row"><span class="badge ${i.status === 'open' ? 'pending' : 'online'}">${i.status}</span> ${esc(i.subject)} <span class="muted-sm">${esc(fmtAgo(i.createdAt))}</span></div>`).join('')
        || '<div class="muted-sm">No issues reported.</div>'}`,
    onSubmit: () => true, // Save button just closes
  });
}

function openCredentialsModal(customer) {
  openModal({
    title: `Set password — ${customer.name}`,
    bodyHTML:
      fieldHTML({ id: 'cred-email', label: 'Login email', type: 'email', required: true, value: customer.email || '', placeholder: 'customer@example.com' }) +
      fieldHTML({ id: 'cred-pass', label: 'New password', type: 'text', required: true, placeholder: 'min. 6 characters — share it with the customer' }) +
      `<div class="dv-hint">This creates or resets the customer's portal login. Any pending password-reset request for them is marked resolved.</div>`,
    onSubmit: async (form) => {
      const email = $('#cred-email', form).value.trim();
      const password = $('#cred-pass', form).value;
      let valid = setFieldError(form, 'cred-email', email ? '' : 'Email is required');
      valid = setFieldError(form, 'cred-pass', password.length >= 6 ? '' : 'At least 6 characters') && valid;
      if (!valid) return false;
      await api(`/api/admin/customers/${customer.id}/credentials`, {
        method: 'POST',
        body: { email, password },
      });
      alert(`Password set for ${customer.name}. Share these credentials with the customer:\n\nLogin: ${email}\nPassword: ${password}`);
      await loadAdminCustomers();
    },
  });
}

async function deleteAdminCustomer(customer) {
  if (!confirm(`Delete customer "${customer.name}"? ALL their sites and cameras will be removed. This cannot be undone.`)) return;
  try {
    await api(`/api/admin/customers/${customer.id}`, { method: 'DELETE' });
    await loadAdminCustomers();
    await loadAll();
    renderSidebar();
    reconcileGrid();
  } catch (err) {
    alert(err.message || 'Failed to delete customer');
  }
}

/* -------------------------------- issues -------------------------------- */

async function loadIssues() {
  const status = $('#issues-filter').value;
  let issues;
  try {
    issues = await api(`/api/admin/issues${status ? `?status=${status}` : ''}`);
  } catch (err) {
    $('#issues-list').innerHTML = `<div class="dv-empty">${esc(err.message)}</div>`;
    return;
  }
  $('#issues-count').textContent = String(issues.length);
  if (!issues.length) {
    $('#issues-list').innerHTML = '<div class="empty-state"><div class="empty-icon">✓</div><h2>Nothing here</h2><p>No issues with this status.</p></div>';
    return;
  }
  const catLabel = {
    'camera-view': 'Cannot view camera',
    'login': 'Login problem',
    'password': 'Password / account',
    'editing': 'Cannot edit / change',
    'other': 'Other',
  };
  $('#issues-list').innerHTML = '';
  for (const issue of issues) {
    const el = document.createElement('div');
    el.className = 'issue-card';
    el.innerHTML = `
      <div class="issue-head">
        <span class="badge ${issue.status === 'open' ? 'pending' : 'online'}">${issue.status}</span>
        <span class="chip">${esc(catLabel[issue.category] || issue.category)}</span>
        <strong>${esc(issue.subject)}</strong>
        <span class="spacer"></span>
        <span class="muted-sm">${esc(fmtTime(issue.createdAt))}</span>
      </div>
      <div class="issue-body">${esc(issue.message)}</div>
      <div class="issue-meta">
        From: <strong>${esc(issue.customer?.name || 'unknown')}</strong>
        <span class="muted-sm">${esc(issue.customer?.email || '')}</span>
        ${issue.adminNote ? `<div class="muted-sm">Resolution note: ${esc(issue.adminNote)}</div>` : ''}
      </div>
      <div class="issue-actions"></div>`;
    const actions = el.querySelector('.issue-actions');
    if (issue.status === 'open') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-primary';
      btn.textContent = 'Resolve…';
      btn.addEventListener('click', () => openResolveIssueModal(issue));
      actions.appendChild(btn);
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm';
      btn.textContent = 'Reopen';
      btn.addEventListener('click', async () => {
        try { await api(`/api/admin/issues/${issue.id}/reopen`, { method: 'POST' }); await loadIssues(); }
        catch (err) { alert(err.message); }
      });
      actions.appendChild(btn);
    }
    $('#issues-list').appendChild(el);
  }
}

function openResolveIssueModal(issue) {
  openModal({
    title: `Resolve issue — ${issue.subject}`,
    bodyHTML:
      `<div class="issue-body">${esc(issue.message)}</div>` +
      fieldHTML({ id: 'issue-note', label: 'Resolution note (optional)', textarea: true, placeholder: 'What was done to fix this…' }),
    onSubmit: async (form) => {
      await api(`/api/admin/issues/${issue.id}/resolve`, {
        method: 'POST',
        body: { note: $('#issue-note', form).value.trim() || null },
      });
      await loadIssues();
    },
  });
}

/* ---------------------------- password resets --------------------------- */

async function loadResets() {
  let reqs;
  try {
    reqs = await api('/api/admin/reset-requests');
  } catch (err) {
    $('#resets-table').innerHTML = `<div class="dv-empty">${esc(err.message)}</div>`;
    return;
  }
  setNavBadge('#nav-badge-resets', reqs.length);
  $('#resets-count').textContent = String(reqs.length);
  if (!reqs.length) {
    $('#resets-table').innerHTML = '<div class="dv-empty">No pending password reset requests.</div>';
    return;
  }
  $('#resets-table').innerHTML = `
    <table class="table">
      <thead><tr><th>Customer</th><th>Email</th><th>Requested</th><th></th></tr></thead>
      <tbody>
        ${reqs.map((r) => `
          <tr>
            <td><strong>${esc(r.customer?.name || 'unknown')}</strong></td>
            <td>${esc(r.email)}</td>
            <td title="${esc(fmtTime(r.createdAt))}">${esc(fmtAgo(r.createdAt))}</td>
            <td class="row-actions"><button class="btn btn-sm btn-primary" data-id="${r.id}">Set new password…</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  $('#resets-table').querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const req = reqs.find((r) => r.id === btn.dataset.id);
      openResolveResetModal(req);
    });
  });
}

function openResolveResetModal(req) {
  openModal({
    title: `Reset password — ${req.customer?.name || req.email}`,
    bodyHTML:
      `<div class="dv-hint">Set a new password for <strong>${esc(req.email)}</strong> and share it with the customer over a trusted channel.</div>` +
      fieldHTML({ id: 'reset-pass', label: 'New password', type: 'text', required: true, placeholder: 'min. 6 characters' }),
    onSubmit: async (form) => {
      const newPassword = $('#reset-pass', form).value;
      if (!setFieldError(form, 'reset-pass', newPassword.length >= 6 ? '' : 'At least 6 characters')) return false;
      await api(`/api/admin/reset-requests/${req.id}/resolve`, {
        method: 'POST',
        body: { newPassword },
      });
      alert(`Password reset for ${req.email}.\nNew password: ${newPassword}\n\nShare it with the customer.`);
      await loadResets();
    },
  });
}

/* ------------------------------- activity ------------------------------- */

async function loadActivity() {
  let rows;
  try {
    rows = await api('/api/admin/activity?limit=150');
  } catch (err) {
    $('#activity-table').innerHTML = `<div class="dv-empty">${esc(err.message)}</div>`;
    return;
  }
  if (!rows.length) {
    $('#activity-table').innerHTML = '<div class="dv-empty">No activity recorded yet.</div>';
    return;
  }
  $('#activity-table').innerHTML = `
    <table class="table">
      <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
      <tbody>
        ${rows.map((a) => `
          <tr>
            <td title="${esc(fmtTime(a.createdAt))}">${esc(fmtAgo(a.createdAt))}</td>
            <td><span class="chip">${esc(a.actorRole)}</span> ${esc(a.actorEmail || '')}</td>
            <td><code>${esc(a.action)}</code></td>
            <td>${esc(a.detail || '')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ==========================================================================
   Init
   ========================================================================== */

function bindShell() {
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-add-customer').addEventListener('click', () => openCustomerModal(null));
  $('#btn-add-customer-2').addEventListener('click', () => openCustomerModal(null));
  $('#btn-empty-add-customer').addEventListener('click', () => openCustomerModal(null));
  $('#btn-add-site').addEventListener('click', () => {
    if (!state.customers.length) {
      openCustomerModal(null);
      return;
    }
    openSiteModal(null);
  });
  $('#btn-add-camera').addEventListener('click', () => openCameraModal(null));
  $('#btn-empty-add-camera').addEventListener('click', () => openCameraModal(null));
  $('#btn-demo-videos').addEventListener('click', openDemoSourcesModal);
  $('#issues-filter').addEventListener('change', loadIssues);
  document.querySelectorAll('#admin-nav .nav-item').forEach((btn) =>
    btn.addEventListener('click', () => showSection(btn.dataset.section)));
}

async function init() {
  bindLogin();
  bindShell();
  if (state.token) {
    try {
      await showApp();
      return;
    } catch (e) {
      // token rejected or backend unreachable at boot — fall back to login
      if (state.token) showLogin(); else return; // 401 already showed login
    }
  }
  showLogin();
}

init();
