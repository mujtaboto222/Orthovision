// ═══════════════════════════════════════════════════════
// GOOGLE DRIVE MODULE  (drive.js)
// Handles all Drive API calls from within the editor.
// Reads appAccessToken from auth.js (loaded first).
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// GOOGLE DRIVE INTEGRATION
// Patched to share auth with multi-page controller.
// ═══════════════════════════════════════════════════════
const GD = (() => {
  const DRIVE_API  = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER     = 'OrthoVision Cases';
  const PREFIX     = 'ovcase_';
  const MIME_JSON  = 'application/json';

  let _token       = null;
  let _folderId    = null;
  let _fileId      = null;   // currently loaded/saved case file ID
  let _autosave    = null;
  let _open        = false;
  let _resolveT    = null;

  const el = id => document.getElementById(id);

  // ── UI state ───────────────────────────────────────────
  function showConnected(profile) {
    el('driveAuthPrompt').style.display = 'none';
    el('driveUserBar').classList.add('show');
    el('driveBody').style.display = '';
    el('driveFooter').style.display = '';
    el('driveStatusDot').classList.add('connected');
    if (profile) {
      el('driveUserName').textContent = profile.name || profile.email || 'Connected';
      if (profile.picture) el('driveUserAvatar').innerHTML = `<img src="${profile.picture}" alt="">`;
      else el('driveUserAvatar').textContent = (profile.name||'?')[0].toUpperCase();
    }
  }
  function showDisconnected() {
    el('driveAuthPrompt').style.display = '';
    el('driveUserBar').classList.remove('show');
    el('driveBody').style.display = 'none';
    el('driveFooter').style.display = 'none';
    el('driveStatusDot').classList.remove('connected','saving');
    _token = null; _folderId = null; _fileId = null;
    stopAutosave();
  }

  // ── Token helpers ──────────────────────────────────────
  function getToken() {
    if (_token) return Promise.resolve(_token);
    return new Promise(resolve => { _resolveT = resolve; appSignIn(); });
  }

  // ── Drive API ──────────────────────────────────────────
  async function apiFetch(path, options={}) {
    const tok = await getToken();
    const resp = await fetch(DRIVE_API + path, {
      ...options,
      headers: { Authorization: 'Bearer ' + tok, ...(options.headers||{}) }
    });
    if (!resp.ok) throw new Error(await resp.text());
    return options.raw ? resp : resp.json();
  }

  async function getOrCreateFolder() {
    if (_folderId) return _folderId;
    if (typeof appFolderId !== 'undefined' && appFolderId) { _folderId = appFolderId; return _folderId; }
    const tok = await getToken();
    const q = `name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const d = await (await fetch(DRIVE_API + '/files?q=' + encodeURIComponent(q) + '&fields=files(id)&spaces=drive', {
      headers: { Authorization: 'Bearer ' + tok }
    })).json();
    if (d.files && d.files.length) { _folderId = d.files[0].id; }
    else {
      const cr = await (await fetch(DRIVE_API + '/files', {
        method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' })
      })).json();
      _folderId = cr.id;
    }
    if (typeof appFolderId !== 'undefined') appFolderId = _folderId;
    return _folderId;
  }

  async function uploadJSON(jsonStr, filename, existingId=null) {
    const tok = await getToken();
    const fid = await getOrCreateFolder();
    const meta = { name: filename, mimeType: MIME_JSON };
    if (!existingId) meta.parents = [fid];
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', new Blob([jsonStr], { type: MIME_JSON }));
    const url = existingId
      ? `${UPLOAD_API}/files/${existingId}?uploadType=multipart`
      : `${UPLOAD_API}/files?uploadType=multipart`;
    const resp = await fetch(url, {
      method: existingId ? 'PATCH' : 'POST',
      headers: { Authorization: 'Bearer ' + tok },
      body: form
    });
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json();
  }

  // ── Serialize ──────────────────────────────────────────
  function serializeCase(caseName) {
    const cards = [];
    ['extra','intra','radio'].forEach(colId => {
      document.getElementById('body-'+colId).querySelectorAll('.photo-card').forEach(card => {
        const img = card.querySelector('img');
        const s = getState(img);
        cards.push({
          colId,
          src: s.cropData || img.src,
          left: card.style.left, top: card.style.top,
          width: card.style.width, height: card.style.height,
          zIndex: card.style.zIndex,
          isCeph: card.classList.contains('is-ceph'),
          state: { scale:s.scale, flipX:s.flipX, flipY:s.flipY, rotate:s.rotate,
                   brightness:s.brightness, contrast:s.contrast,
                   drawings:s.drawings, cropData:s.cropData||null }
        });
      });
    });
    const cephResults = [];
    document.querySelectorAll('#cephResultsGrid .crg-name').forEach((n,i) => {
      const v = document.querySelectorAll('#cephResultsGrid .crg-val')[i];
      const nr = document.querySelectorAll('#cephResultsGrid .crg-norm')[i];
      cephResults.push({name:n.textContent, val:v?v.textContent:'', norm:nr?nr.textContent:''});
    });
    return JSON.stringify({
      _app: 'OrthoVision', _version: 2, name: caseName,
      savedAt: new Date().toISOString(),
      notes: {
        problem: document.getElementById('noteProblem').value,
        plan: document.getElementById('notePlan').value,
        mechanics: document.getElementById('noteMechanics').value,
        considerations: document.getElementById('noteConsiderations').value,
      },
      cephResults, cards,
      followUps: fuVisits.map(v => ({
        id: v.id, name: v.name, date: v.date,
        photos: v.photos.map(p => ({name:p.name, src:p.src}))
      }))
    });
  }

  // ── Case list ──────────────────────────────────────────
  async function loadCaseList() {
    if (!_token) return;
    el('driveCaseLoading').style.display = '';
    el('driveCaseEmpty').style.display = 'none';
    el('driveCaseList').querySelectorAll('.drive-case-card').forEach(c => c.remove());
    try {
      const fid = await getOrCreateFolder();
      const q = `'${fid}' in parents and trashed=false and name contains '${PREFIX}'`;
      const tok = await getToken();
      const d = await (await fetch(DRIVE_API + '/files?q=' + encodeURIComponent(q) + '&fields=files(id,name,modifiedTime)&orderBy=modifiedTime+desc&spaces=drive', {
        headers: { Authorization: 'Bearer ' + tok }
      })).json();
      el('driveCaseLoading').style.display = 'none';
      const files = d.files || [];
      if (!files.length) { el('driveCaseEmpty').style.display = ''; return; }
      files.forEach(f => renderCaseCard(f));
    } catch(err) {
      el('driveCaseLoading').style.display = 'none';
      showToast('Failed to load cases: ' + err.message, '❌', 'toast-info', 4000);
    }
  }

  function renderCaseCard(f) {
    const nm = f.name.replace(PREFIX,'').replace('.json','').replace(/_/g,' ');
    const dt = f.modifiedTime ? new Date(f.modifiedTime).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    const card = document.createElement('div');
    card.className = 'drive-case-card'; card.dataset.fileId = f.id;
    card.innerHTML = `<div class="drive-case-icon">🗂</div>
      <div class="drive-case-info"><div class="drive-case-name">${nm}</div><div class="drive-case-meta">${dt}</div></div>
      <button class="drive-case-del" onclick="event.stopPropagation();driveDeleteCase('${f.id}',this.closest('.drive-case-card'))">✕</button>`;
    card.addEventListener('click', () => openCase(f.id, nm));
    el('driveCaseList').appendChild(card);
  }

  // ── Save ───────────────────────────────────────────────
  function openSaveModal() { el('driveNameModal').classList.add('open'); setTimeout(() => el('driveNameInput').focus(), 80); }
  function closeSaveModal() { el('driveNameModal').classList.remove('open'); }

  async function saveCase() {
    const rawName = el('driveNameInput').value.trim();
    if (!rawName) { el('driveNameInput').focus(); return; }
    const saveBtn = el('driveNameSaveBtn');
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    el('driveStatusDot').classList.add('saving');
    try {
      const filename = PREFIX + rawName.replace(/[^a-zA-Z0-9 \-_]/g,'').replace(/ /g,'_') + '.json';
      const json = serializeCase(rawName);
      const result = await uploadJSON(json, filename, _fileId);
      _fileId = result.id;
      if (typeof appFolderId !== 'undefined') { /* folderId already shared */ }
      closeSaveModal();
      await loadCaseList();
      el('driveAutosaveStatus').textContent = 'Saved: ' + new Date().toLocaleTimeString();
      startAutosave();
      showToast('"' + rawName + '" saved to Drive', '💾', 'toast-success', 3000);
    } catch(err) {
      showToast('Save failed: ' + err.message, '❌', 'toast-info', 4000);
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = 'Save to Drive';
      el('driveStatusDot').classList.remove('saving');
    }
  }

  // ── Open ───────────────────────────────────────────────
  async function openCase(fileId, name) {
    if (!confirm(`Load case "${name}"?\n\nThis will replace your current board. Unsaved work will be lost.`)) return;
    showToast('Loading case…', '⏳', 'toast-info', 2000);
    el('driveStatusDot').classList.add('saving');
    try {
      const tok = await getToken();
      const resp = await fetch(DRIVE_API + '/files/' + fileId + '?alt=media', {
        headers: { Authorization: 'Bearer ' + tok }
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      _fileId = fileId;
      const ni = el('driveNameInput');
      if (ni && !ni.value) ni.value = name;
      await deserializeCase(data);
      el('driveAutosaveStatus').textContent = 'Loaded: ' + name;
      startAutosave();
      toggleSidebar();
      showToast('"' + name + '" loaded', '✅', 'toast-success', 3000);
    } catch(err) {
      showToast('Load failed: ' + err.message, '❌', 'toast-info', 4000);
    } finally {
      el('driveStatusDot').classList.remove('saving');
    }
  }

  // ── Delete ─────────────────────────────────────────────
  async function deleteCase(fileId, cardEl) {
    if (!confirm('Delete this case from Google Drive? Cannot be undone.')) return;
    try {
      const tok = await getToken();
      await fetch(DRIVE_API + '/files/' + fileId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
      cardEl.remove();
      if (fileId === _fileId) { _fileId = null; el('driveAutosaveStatus').textContent = 'Auto-save: off'; }
      if (!el('driveCaseList').querySelectorAll('.drive-case-card').length) el('driveCaseEmpty').style.display = '';
      showToast('Case deleted', '🗑', 'toast-info', 2500);
    } catch(err) { showToast('Delete failed: ' + err.message, '❌', 'toast-info', 3500); }
  }

  // ── Autosave ───────────────────────────────────────────
  function startAutosave() {
    stopAutosave();
    if (!_fileId) return;
    _autosave = setInterval(async () => {
      if (!_fileId || !_token) return;
      el('driveStatusDot').classList.add('saving');
      el('driveAutosaveStatus').textContent = 'Auto-saving…';
      try {
        const nm = el('driveNameInput').value || 'Autosave';
        await uploadJSON(serializeCase(nm), null, _fileId);
        el('driveAutosaveStatus').textContent = 'Auto-saved: ' + new Date().toLocaleTimeString();
      } catch(e) { el('driveAutosaveStatus').textContent = 'Auto-save failed'; }
      finally { el('driveStatusDot').classList.remove('saving'); }
    }, 60000);
  }
  function stopAutosave() { if (_autosave) { clearInterval(_autosave); _autosave = null; } }

  // ── Sidebar ────────────────────────────────────────────
  function toggleSidebar() {
    _open = !_open;
    el('driveSidebar').classList.toggle('open', _open);
    el('driveToggleBtn').classList.toggle('active', _open);
    if (_open) {
      if (typeof notesOpen !== 'undefined' && notesOpen && typeof toggleNotes === 'function') toggleNotes();
      if (typeof followupsOpen !== 'undefined' && followupsOpen && typeof toggleFollowups === 'function') toggleFollowups();
    }
  }

  // ── Init / called by multi-page controller ─────────────
  function init() {
    // Try to pull token from multi-page controller
    if (typeof appAccessToken !== 'undefined' && appAccessToken) {
      _token = appAccessToken;
      _folderId = (typeof appFolderId !== 'undefined' && appFolderId) ? appFolderId : null;
      const prof = (typeof appProfile !== 'undefined') ? appProfile : {};
      showConnected(prof);
      loadCaseList();
      startAutosave();
    }
  }
  window.addEventListener('load', () => { setTimeout(init, 200); });

  // ── Sign out ───────────────────────────────────────────
  function signOut() { if (typeof appSignOut === 'function') appSignOut(); else showDisconnected(); }

  // ── Public API ─────────────────────────────────────────
  return {
    signIn() { if (typeof appSignIn === 'function') appSignIn(); },
    signOut,
    loadCaseList,
    openSaveModal, closeSaveModal, saveCase,
    openCase, deleteCase,
    toggleSidebar,
    // Bridge methods for multi-page controller
    _setToken(token, profile) {
      _token = token; _folderId = null; // reset folder so it's re-fetched
      if (_resolveT) { _resolveT(token); _resolveT = null; }
      if (profile) showConnected(profile);
      loadCaseList(); startAutosave();
    },
    _setCurrentFileId(fileId, name) {
      _fileId = fileId;
      const ni = el('driveNameInput');
      if (ni && name) ni.value = name;
      startAutosave();
    },
    _isConnected() { return !!_token; }
  };
})();

// ── Global wrappers ────────────────────────────────────
function toggleDriveSidebar()    { GD.toggleSidebar(); }
function driveSignIn()           { GD.signIn(); }
function driveSignOut()          { GD.signOut(); }
function driveLoadCaseList()     { GD.loadCaseList(); }
function driveOpenSaveModal()    { GD.openSaveModal(); }
function driveCloseSaveModal()   { GD.closeSaveModal(); }
function driveSaveCase()         { GD.saveCase(); }
function driveOpenCase(id, name) { GD.openCase(id, name); }
function driveDeleteCase(id, el) { GD.deleteCase(id, el); }

document.getElementById('driveNameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') driveSaveCase();
  if (e.key === 'Escape') driveCloseSaveModal();
});
document.getElementById('driveNameModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) driveCloseSaveModal();
});
