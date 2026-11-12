/* app.js — UI + sinkronisasi Sistem Villa Taman Kelinci (Tahap 1).
 *
 * SPA statis tanpa framework dan tanpa dependensi eksternal.
 * Data: data.json di repo privat, diakses lewat GitHub REST API dengan
 * token fine-grained milik pengguna (disimpan HANYA di localStorage).
 *
 * Alur simpan: ubah data lokal -> simpan cache localStorage -> dorong ke
 * GitHub (PUT contents API dengan sha terakhir). Gagal jaringan TIDAK
 * pernah menghilangkan edit: perubahan ditandai "belum tersinkron" dan
 * bisa dicoba lagi. Konflik 409 TIDAK pernah menimpa diam-diam.
 */
(function () {
  'use strict';

  var L = VTKLogic;

  /* ---------------- Konstanta ---------------- */

  var DEFAULT_CONN = {
    owner: 'danidwidarmawan',
    repo: 'sistem-villa-taman-kelinci-data',
    branch: 'main'
  };
  var APP_VERSION = '1.0.0-tahap1';

  var LS = {
    data: 'vtk_data',
    sha: 'vtk_sha',
    syncedAt: 'vtk_synced_at',
    pending: 'vtk_pending',
    pat: 'vtk_pat',
    conn: 'vtk_conn',
    backup: 'vtk_conflict_backup'
  };

  var NAV = [
    { route: 'dashboard', label: 'Dashboard', icon: 'grid' },
    { route: 'reservasi', label: 'Reservasi', icon: 'key' },
    { route: 'keuangan', label: 'Keuangan', icon: 'banknote' },
    { route: 'leads', label: 'Leads', icon: 'users' },
    { route: 'kalender', label: 'Kalender', icon: 'calendar' },
    { route: 'pengaturan', label: 'Pengaturan', icon: 'sliders' }
  ];

  /* Ikon SVG inline (stroke, currentColor) — tanpa emoji, tanpa file gambar. */
  var ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M17 4l2 2"/><path d="M14 7l2 2"/>',
    banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5a3.5 3.5 0 0 1 0 6.9"/><path d="M17.5 14.2a6.5 6.5 0 0 1 4 5.8"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>',
    percent: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6"/><path d="M9 9.5h.01M15 14.5h.01"/>',
    calendarCheck: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/><path d="M9 15l2 2 4-4"/>',
    receipt: '<path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z"/><path d="M9 8h6M9 12h6"/>'
  };

  /* '<svg …>' lengkap untuk ikon bernama; '' bila tidak dikenal. */
  function icon(name) {
    if (!ICONS[name]) { return ''; }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  /* ---------------- State ---------------- */

  var state = {
    data: null,
    sha: null,
    /* boot | setup | online | demo | offline */
    mode: 'boot',
    pending: 0,
    lastSync: null, /* Date */
    syncing: false,
    syncError: '',
    conflict: null, /* { remoteData, remoteSha, fetchedAt } */
    route: 'dashboard',
    dashMonth: L.currentMonthKey(),
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    calSelected: null,
    filters: {
      res: { status: '', month: '', q: '' },
      tx: { month: L.currentMonthKey(), type: '', category: '', status: '' },
      lead: { status: '', source: '', q: '' }
    },
    /* form aktif: { module: 'res'|'tx'|'lead', id: string|null, prefill: object|null } */
    form: null,
    /* form yang dijadwalkan lintas-hash (mis. Leads -> Jadikan reservasi) */
    pendingForm: null,
    /* tarif reservasi sudah diubah manual (agar saran tidak menimpa) */
    rateTouched: false,
    conn: loadConn()
  };

  /* ---------------- Utilitas DOM ---------------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    if (s === null || s === undefined) { return ''; }
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(msg, kind) {
    var t = $('toast');
    if (!t) { return; }
    t.textContent = msg;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.className = 'toast'; }, 3500);
  }

  function confirmDialog(msg) {
    return window.confirm(msg);
  }

  function downloadBlob(filename, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function downloadText(filename, text, mime) {
    downloadBlob(filename, new Blob([text], { type: mime || 'application/json;charset=utf-8' }));
  }

  /* ---------------- Base64 UTF-8 (aman untuk string besar) ---------------- */

  function b64encodeUtf8(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function b64decodeUtf8(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
    return new TextDecoder().decode(bytes);
  }

  /* ---------------- Storage lokal ---------------- */

  function lsGet(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { window.localStorage.setItem(k, v); } catch (e) { /* storage penuh / privat */ }
  }
  function lsRemove(k) {
    try { window.localStorage.removeItem(k); } catch (e) { /* abaikan */ }
  }

  function getToken() { return lsGet(LS.pat) || ''; }

  function loadConn() {
    try {
      var raw = lsGet(LS.conn);
      if (raw) {
        var c = JSON.parse(raw);
        if (c && c.owner && c.repo) {
          return { owner: c.owner, repo: c.repo, branch: c.branch || 'main' };
        }
      }
    } catch (e) { /* pakai default */ }
    return { owner: DEFAULT_CONN.owner, repo: DEFAULT_CONN.repo, branch: DEFAULT_CONN.branch };
  }

  function persistConn(c) {
    state.conn = { owner: c.owner, repo: c.repo, branch: c.branch || 'main' };
    lsSet(LS.conn, JSON.stringify(state.conn));
  }

  function loadCache() {
    try {
      var raw = lsGet(LS.data);
      if (!raw) { return null; }
      var d = JSON.parse(raw);
      if (L.validateData(d).length) { return null; }
      return d;
    } catch (e) { return null; }
  }

  function saveCache() {
    if (!state.data || state.mode === 'demo') { return; }
    lsSet(LS.data, JSON.stringify(state.data));
    lsSet(LS.sha, state.sha || '');
    lsSet(LS.pending, String(state.pending));
    if (state.lastSync) { lsSet(LS.syncedAt, state.lastSync.toISOString()); }
  }

  /* ---------------- GitHub API ---------------- */

  function ghBaseUrl() {
    var c = state.conn;
    return 'https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' +
      encodeURIComponent(c.repo) + '/contents/data.json';
  }

  function ghHeaders() {
    return {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + getToken(),
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  function ghErrorMessage(status, bodyText) {
    if (status === 401) { return 'Token ditolak (401). Periksa token di Pengaturan → Koneksi.'; }
    if (status === 403) { return 'Akses ditolak (403). Token mungkin tidak punya izin Contents: Read and write untuk repo data, atau rate limit tercapai.'; }
    if (status === 404) { return 'Repo atau file data.json tidak ditemukan (404). Periksa nama owner/repo/branch.'; }
    if (status === 409) { return 'Konflik versi (409): data berubah dari tempat lain.'; }
    if (status === 422) { return 'Permintaan tidak valid (422).'; }
    var msg = 'GitHub API error (' + status + ')';
    if (bodyText) {
      try {
        var j = JSON.parse(bodyText);
        if (j && j.message) { msg += ': ' + j.message; }
      } catch (e) { /* abaikan */ }
    }
    return msg;
  }

  /* GET data.json -> { ok, data, sha, status, error } */
  function apiGet() {
    var url = ghBaseUrl() + '?ref=' + encodeURIComponent(state.conn.branch);
    return fetch(url, { headers: ghHeaders() }).then(function (resp) {
      if (!resp.ok) {
        return resp.text().then(function (t) {
          return { ok: false, status: resp.status, error: ghErrorMessage(resp.status, t) };
        });
      }
      return resp.json().then(function (j) {
        try {
          var parsed = JSON.parse(b64decodeUtf8(j.content || ''));
          var errs = L.validateData(parsed);
          if (errs.length) {
            return { ok: false, status: 200, error: 'Isi data.json di repo tidak valid: ' + errs.join(' ') };
          }
          return { ok: true, data: parsed, sha: j.sha };
        } catch (e) {
          return { ok: false, status: 200, error: 'Gagal membaca data.json dari repo: ' + e.message };
        }
      });
    }).catch(function (e) {
      return { ok: false, status: 0, error: 'Tidak bisa terhubung ke GitHub (' + (e && e.message ? e.message : 'offline?') + ').' };
    });
  }

  /* PUT data.json. sha null = buat file baru. */
  function apiPut(dataObj, sha, message) {
    var body = {
      message: message || 'Update data Villa Taman Kelinci',
      content: b64encodeUtf8(JSON.stringify(dataObj, null, 2)),
      branch: state.conn.branch
    };
    if (sha) { body.sha = sha; }
    return fetch(ghBaseUrl(), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders()),
      body: JSON.stringify(body)
    }).then(function (resp) {
      if (!resp.ok) {
        return resp.text().then(function (t) {
          return { ok: false, status: resp.status, error: ghErrorMessage(resp.status, t) };
        });
      }
      return resp.json().then(function (j) {
        return { ok: true, sha: j && j.content ? j.content.sha : sha };
      });
    }).catch(function (e) {
      return { ok: false, status: 0, error: 'Tidak bisa terhubung ke GitHub (' + (e && e.message ? e.message : 'offline?') + ').' };
    });
  }

  /* ---------------- Sinkronisasi ---------------- */

  function updateSyncUI() {
    var pill = $('sync-pill');
    var pillSide = $('sync-pill-side');
    var text = '';
    var cls = 'sync-pill';
    if (state.mode === 'demo') {
      text = 'Mode Demo';
      cls += ' demo';
    } else if (state.syncing) {
      text = 'Menyinkronkan…';
      cls += ' syncing';
    } else if (!getToken()) {
      text = state.pending > 0
        ? 'Offline — ' + state.pending + ' perubahan menunggu'
        : 'Offline — token belum diatur';
      cls += ' offline';
    } else if (state.conflict) {
      text = 'Konflik — perlu keputusan Anda';
      cls += ' conflict';
    } else if (state.pending > 0) {
      text = 'Belum tersinkron — ' + state.pending + ' perubahan menunggu';
      cls += ' pending';
    } else if (state.syncError) {
      text = 'Gagal sinkron — coba lagi';
      cls += ' error';
    } else if (state.lastSync) {
      text = 'Tersinkron • ' + L.fmtSyncTime(state.lastSync);
      cls += ' ok';
    } else {
      text = 'Belum pernah sinkron';
      cls += ' offline';
    }
    [pill, pillSide].forEach(function (el) {
      if (el) { el.textContent = text; el.className = cls; }
    });
  }

  /* Ambil data terbaru dari GitHub. Tidak pernah menimpa edit lokal yang
   * belum tersinkron — bila remote berubah sementara ada edit lokal,
   * tandai konflik dan biarkan pengguna memutuskan. */
  function syncFromRemote(opts) {
    opts = opts || {};
    if (!getToken() || state.mode === 'demo') { return Promise.resolve(false); }
    if (state.syncing) { return Promise.resolve(false); }
    state.syncing = true;
    state.syncError = '';
    updateSyncUI();
    return apiGet().then(function (res) {
      state.syncing = false;
      if (!res.ok) {
        if (res.status === 404 && state.data) {
          /* File belum ada di repo tapi kita punya data lokal: dorong sebagai file awal. */
          state.sha = null;
          return pushToRemote().then(function () { return true; });
        }
        state.syncError = res.error;
        updateSyncUI();
        if (!opts.silent) { toast(res.error, 'error'); }
        return false;
      }
      state.lastSync = new Date();
      if (res.sha === state.sha) {
        saveCache();
        updateSyncUI();
        return true;
      }
      if (state.pending > 0 && state.data) {
        /* Remote berubah sementara ada edit lokal yang belum terkirim. */
        state.conflict = { remoteData: res.data, remoteSha: res.sha, fetchedAt: new Date() };
        updateSyncUI();
        renderBanner();
        return false;
      }
      state.data = res.data;
      state.sha = res.sha;
      state.pending = 0;
      state.conflict = null;
      saveCache();
      updateSyncUI();
      /* Jangan me-render ulang saat form sedang diisi — input pengguna
       * akan hilang. Data baru tetap dipakai saat render berikutnya. */
      if (!state.form) { renderView(); }
      return true;
    });
  }

  /* Dorong data lokal ke GitHub. Mengembalikan { ok, error? }. */
  function pushToRemote() {
    if (state.mode === 'demo' || !state.data) { return Promise.resolve({ ok: true, skipped: true }); }
    if (!getToken()) { return Promise.resolve({ ok: false, error: 'Token belum diatur.' }); }
    if (state.syncing) { return Promise.resolve({ ok: false, error: 'Sinkronisasi sedang berjalan.' }); }
    state.syncing = true;
    state.syncError = '';
    updateSyncUI();
    return apiPut(state.data, state.sha, 'Update data Villa Taman Kelinci (' + L.fmtSyncTime(new Date()) + ')')
      .then(function (res) {
        state.syncing = false;
        if (res.ok) {
          state.sha = res.sha || state.sha;
          state.pending = 0;
          state.lastSync = new Date();
          state.conflict = null;
          saveCache();
          updateSyncUI();
          renderBanner();
          return { ok: true };
        }
        if (res.status === 409) {
          /* Ambil versi terbaru untuk ditampilkan; edit lokal tetap utuh. */
          return apiGet().then(function (latest) {
            if (latest.ok) {
              state.conflict = { remoteData: latest.data, remoteSha: latest.sha, fetchedAt: new Date() };
            } else {
              state.syncError = res.error;
            }
            updateSyncUI();
            renderBanner();
            return { ok: false, error: res.error, conflict: !!state.conflict };
          });
        }
        state.syncError = res.error;
        updateSyncUI();
        return { ok: false, error: res.error };
      });
  }

  /* Simpan perubahan lokal (cache + tandai pending), lalu dorong ke GitHub.
   * Selalu mengembalikan promise yang resolve dengan hasil dorong. */
  function commit() {
    state.pending++;
    saveCache();
    updateSyncUI();
    if (state.mode === 'demo') {
      return Promise.resolve({ ok: true, skipped: true, demo: true });
    }
    if (!getToken()) {
      return Promise.resolve({ ok: false, error: 'Tersimpan di perangkat ini. Atur token GitHub agar tersinkron.' });
    }
    return pushToRemote();
  }

  function touch(entity) {
    var now = new Date().toISOString();
    if (!entity.createdAt) { entity.createdAt = now; }
    entity.updatedAt = now;
    return entity;
  }

  /* ---------------- Shell: navigasi, banner ---------------- */

  function renderNav() {
    var html = NAV.map(function (n) {
      var active = state.route === n.route ? ' active' : '';
      return '<a href="#/' + n.route + '" class="nav-item' + active + '" data-route="' + n.route + '">' +
        '<span class="nav-ico" aria-hidden="true">' + icon(n.icon) + '</span>' +
        '<span class="nav-label">' + n.label + '</span></a>';
    }).join('');
    var d = $('nav-desktop');
    var m = $('nav-mobile');
    if (d) { d.innerHTML = html; }
    if (m) { m.innerHTML = html; }
  }

  function renderBanner() {
    var b = $('banner');
    if (!b) { return; }
    var html = '';
    if (state.mode === 'demo') {
      html += '<div class="banner demo"><strong>MODE DEMO</strong> — data dari seed (tanpa transaksi). ' +
        'Perubahan di sini <strong>tidak tersimpan</strong> permanen. Atur token GitHub di Pengaturan untuk memakai data asli.</div>';
    }
    if (state.conflict) {
      html += '<div class="banner conflict"><strong>Data berubah dari tempat lain.</strong> ' +
        'Ada versi terbaru di GitHub (diambil ' + L.fmtSyncTime(state.conflict.fetchedAt) + '), ' +
        'sementara perangkat ini punya ' + state.pending + ' perubahan yang belum terkirim. ' +
        'Edit Anda masih terlihat dan belum hilang. Pilih salah satu:' +
        '<div class="banner-actions">' +
        '<button type="button" class="btn btn-small" onclick="VTK.resolveConflict(\'reload\')">Muat ulang versi terbaru</button>' +
        '<button type="button" class="btn btn-small btn-danger" onclick="VTK.resolveConflict(\'overwrite\')">Timpa dengan versi saya</button>' +
        '<button type="button" class="btn btn-small btn-ghost" onclick="VTK.resolveConflict(\'later\')">Nanti saja</button>' +
        '</div></div>';
    }
    if (state.mode === 'offline') {
      html += '<div class="banner offline">Anda membuka <strong>data tersimpan di perangkat ini</strong> tanpa token GitHub. ' +
        'Perubahan tersimpan lokal dan akan tersinkron setelah token diatur. ' +
        '<button type="button" class="btn btn-small" onclick="VTK.go(\'pengaturan\')">Atur token</button></div>';
    }
    b.innerHTML = html;
  }

  function renderShell() {
    renderNav();
    renderBanner();
    updateSyncUI();
  }

  /* ---------------- Router ---------------- */

  function parseHash() {
    var h = (window.location.hash || '').replace(/^#\/?/, '');
    var route = h.split('/')[0] || 'dashboard';
    if (!NAV.some(function (n) { return n.route === route; })) { route = 'dashboard'; }
    return route;
  }

  function route() {
    state.route = parseHash();
    /* Hormati form yang dijadwalkan lintas-hash (mis. Leads -> Jadikan
     * reservasi, Kalender -> tambah reservasi); selain itu tutup form. */
    state.form = state.pendingForm || null;
    state.pendingForm = null;
    renderShell();
    renderView();
    window.scrollTo(0, 0);
  }

  function go(routeName) {
    if (window.location.hash === '#/' + routeName) {
      route();
    } else {
      window.location.hash = '#/' + routeName;
    }
  }

  /* ---------------- Layar setup (belum ada token) ---------------- */

  function setupView() {
    var hasCache = !!loadCache();
    var c = state.conn;
    return '' +
      '<section class="setup card">' +
      '<img src="villa-logo.png" alt="Logo Villa Taman Kelinci" class="setup-logo" />' +
      '<h1>Selamat datang di Sistem Villa Taman Kelinci</h1>' +
      '<p>Aplikasi ini menyimpan data operasional villa (reservasi, keuangan, leads) ' +
      'di repo GitHub privat Anda, sehingga bisa dibuka dari HP atau laptop mana saja dan ' +
      'tetap tersimpan aman. Pertama, buat token akses GitHub (sekali saja):</p>' +
      '<ol class="steps">' +
      '<li>Buka <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">github.com/settings/personal-access-tokens</a> lalu klik <strong>Generate new token</strong>.</li>' +
      '<li>Pada <strong>Repository access</strong>, pilih <strong>Only select repositories</strong> lalu pilih repo <code>' + esc(c.repo) + '</code> saja.</li>' +
      '<li>Pada <strong>Permissions → Repository permissions → Contents</strong>, pilih <strong>Read and write</strong>, lalu generate dan salin tokennya.</li>' +
      '<li>Tempel token di bawah ini, lalu klik <strong>Simpan &amp; mulai</strong>.</li>' +
      '</ol>' +
      '<form onsubmit="return VTK.saveToken(event)">' +
      '<label class="field"><span>Token GitHub (fine-grained)</span>' +
      '<input type="password" name="token" required autocomplete="off" placeholder="github_pat_..." /></label>' +
      '<div class="form-row">' +
      '<label class="field"><span>Owner</span><input type="text" name="owner" value="' + esc(c.owner) + '" required /></label>' +
      '<label class="field"><span>Repo data</span><input type="text" name="repo" value="' + esc(c.repo) + '" required /></label>' +
      '<label class="field"><span>Branch</span><input type="text" name="branch" value="' + esc(c.branch) + '" required /></label>' +
      '</div>' +
      '<p class="hint">Token hanya disimpan di browser perangkat ini dan tidak pernah dikirim ke mana pun selain api.github.com. ' +
      'Jangan pernah membagikan token atau mempublikasikan repo data.</p>' +
      '<div class="form-actions"><button type="submit" class="btn btn-primary">Simpan &amp; mulai</button></div>' +
      '</form>' +
      '<hr />' +
      '<div class="setup-alt">' +
      '<button type="button" class="btn" onclick="VTK.startDemo()">Coba mode demo</button> ' +
      (hasCache ? '<button type="button" class="btn" onclick="VTK.openOffline()">Buka data tersimpan (offline)</button>' : '') +
      '<p class="hint">Mode demo memakai data master saja (tanpa transaksi) dan perubahan tidak tersimpan.</p>' +
      '</div>' +
      '</section>';
  }

  /* ---------------- Boot ---------------- */

  function fetchSeed() {
    return fetch('seed.json').then(function (resp) {
      if (!resp.ok) { throw new Error('seed.json tidak ditemukan (' + resp.status + ')'); }
      return resp.json();
    }).then(function (j) {
      var errs = L.validateData(j);
      if (errs.length) { throw new Error('seed.json tidak valid: ' + errs.join(' ')); }
      return j;
    });
  }

  function showLoading(msg) {
    var v = $('view');
    if (v) { v.innerHTML = '<div class="loading card"><p>' + esc(msg || 'Memuat…') + '</p></div>'; }
  }

  function boot() {
    var cached = loadCache();
    var cachedSha = lsGet(LS.sha) || null;
    var cachedPending = parseInt(lsGet(LS.pending) || '0', 10) || 0;
    var syncedAt = lsGet(LS.syncedAt);
    state.pending = cachedPending;
    state.lastSync = syncedAt ? new Date(syncedAt) : null;

    if (!getToken()) {
      state.mode = 'setup';
      state.route = 'setup';
      renderShell();
      $('view').innerHTML = setupView();
      updateSyncUI();
      return;
    }

    state.mode = 'online';
    if (cached) {
      /* Tampilkan cache dulu (cepat, bisa offline), sinkron di latar belakang. */
      state.data = cached;
      state.sha = cachedSha;
      route();
      syncFromRemote({ silent: true });
      return;
    }

    /* Tanpa cache: ambil dari GitHub; bila file belum ada, bootstrap dari seed. */
    showLoading('Menghubungkan ke GitHub…');
    state.syncing = true;
    updateSyncUI();
    apiGet().then(function (res) {
      state.syncing = false;
      if (res.ok) {
        state.data = res.data;
        state.sha = res.sha;
        state.lastSync = new Date();
        state.pending = 0;
        saveCache();
        route();
        return;
      }
      if (res.status === 404) {
        showLoading('File data belum ada di repo — menyiapkan dari data master…');
        fetchSeed().then(function (seed) {
          state.data = seed;
          state.sha = null;
          state.pending = 0;
          return apiPut(seed, null, 'Data awal Sistem Villa Taman Kelinci (migrasi dari Excel)');
        }).then(function (putRes) {
          if (putRes.ok) {
            state.sha = putRes.sha || null;
            state.lastSync = new Date();
            saveCache();
            toast('Data awal berhasil dibuat di repo.');
          } else {
            state.syncError = putRes.error;
            toast('Data awal belum bisa dibuat di repo: ' + putRes.error, 'error');
          }
          route();
        }).catch(function (e) {
          state.syncError = e.message;
          showLoading('Gagal menyiapkan data awal: ' + esc(e.message));
        });
        return;
      }
      state.syncError = res.error;
      showLoading('Gagal memuat data: ' + esc(res.error) + ' <button type="button" class="btn btn-small" onclick="VTK.retryBoot()">Coba lagi</button>');
      updateSyncUI();
    });
  }

  /* ---------------- Helper render ---------------- */

  function optList(list, selected) {
    return list.map(function (v) {
      return '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
  }

  function badge(text, kind) {
    return '<span class="badge ' + (kind || '') + '">' + esc(text) + '</span>';
  }

  function payBadge(status) {
    var kind = { 'Lunas': 'ok', 'Sebagian': 'warn', 'Belum Bayar': 'bad', 'Belum dihitung': 'muted' }[status] || '';
    return badge(status, kind);
  }

  function resStatusBadge(status) {
    var kind = { 'Terkonfirmasi': 'ok', 'Check-in': 'info', 'Selesai': 'muted', 'Menunggu DP': 'warn', 'Permintaan': 'info', 'Dibatalkan': 'bad' }[status] || '';
    return badge(status, kind);
  }

  function leadStatusBadge(status) {
    var kind = { 'Menang': 'ok', 'Kalah': 'bad', 'Menunggu DP': 'warn', 'Follow-up': 'info', 'Baru': 'info' }[status] || '';
    return badge(status, kind);
  }

  function verifyBadge(status) {
    var kind = { 'Terverifikasi': 'ok', 'Belum Dicek': 'warn', 'Ditolak': 'bad' }[status] || '';
    return badge(status, kind);
  }

  function emptyState(text) {
    return '<p class="empty">' + esc(text) + '</p>';
  }

  function saveStatusHTML() {
    return '<p class="save-status" id="save-status" aria-live="polite"></p>';
  }

  function setSaveStatus(msg, kind) {
    var el = $('save-status');
    if (el) { el.textContent = msg; el.className = 'save-status ' + (kind || ''); }
  }

  function reservationsSorted() {
    return (state.data.reservations || []).slice().sort(function (a, b) {
      if (a.checkin !== b.checkin) { return a.checkin < b.checkin ? 1 : -1; }
      return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1;
    });
  }

  function transactionsSorted() {
    return (state.data.transactions || []).slice().sort(function (a, b) {
      if (a.date !== b.date) { return a.date < b.date ? 1 : -1; }
      return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1;
    });
  }

  function leadsSorted() {
    return (state.data.leads || []).slice().sort(function (a, b) {
      if (a.dateIn !== b.dateIn) { return a.dateIn < b.dateIn ? 1 : -1; }
      return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1;
    });
  }

  /* ---------------- Dispatcher view ---------------- */

  function renderView() {
    var v = $('view');
    if (!v) { return; }
    if (!state.data) {
      if (state.mode === 'setup') { v.innerHTML = setupView(); return; }
      showLoading('Memuat data…');
      return;
    }
    switch (state.route) {
      case 'reservasi': v.innerHTML = state.form && state.form.module === 'res' ? reservationFormHTML() : reservationsViewHTML(); break;
      case 'keuangan': v.innerHTML = state.form && state.form.module === 'tx' ? transactionFormHTML() : financeViewHTML(); break;
      case 'leads': v.innerHTML = state.form && state.form.module === 'lead' ? leadFormHTML() : leadsViewHTML(); break;
      case 'kalender': v.innerHTML = calendarViewHTML(); break;
      case 'pengaturan': v.innerHTML = settingsViewHTML(); break;
      case 'dashboard':
      default: v.innerHTML = dashboardViewHTML(); break;
    }
    afterRender();
  }

  /* Hook setelah render: hitung ulang dinamis pada form yang sedang dibuka. */
  function afterRender() {
    if (state.form && state.form.module === 'res') { resFormRecalc(); }
    if (state.form && state.form.module === 'lead') { leadFormToggleLostReason(); }
  }

  /* ---------------- 1. Dashboard ---------------- */

  function dashboardViewHTML() {
    var d = L.computeDashboard(state.data, state.dashMonth, L.todayISO());
    var s = state.data.settings;
    var kpi = function (label, value, sub) {
      return '<div class="kpi card"><div class="kpi-label">' + label + '</div>' +
        '<div class="kpi-value">' + value + '</div>' +
        (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';
    };
    /* Kartu KPI hero gaya referensi: ikon kecil + label + angka besar.
     * extraCls: mis. 'kpi-hero-navy' untuk kartu pertama. */
    var hero = function (label, value, sub, icoName, icoCls, extraCls) {
      return '<div class="kpi card kpi-hero' + (extraCls ? ' ' + extraCls : '') + '">' +
        '<span class="kpi-ico' + (icoCls ? ' ' + icoCls : '') + '" aria-hidden="true">' + icon(icoName) + '</span>' +
        '<div class="kpi-label">' + label + '</div>' +
        '<div class="kpi-value">' + value + '</div>' +
        (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';
    };
    var html = '<section class="page-head">' +
      '<h1>Dashboard</h1>' +
      '<label class="month-picker"><span>Bulan</span>' +
      '<input type="month" value="' + esc(state.dashMonth) + '" onchange="VTK.setDashMonth(this.value)" /></label>' +
      '</section>';

    /* 4 kartu KPI hero */
    html += '<section class="kpi-grid kpi-hero-grid">' +
      hero('Uang masuk', L.fmtRp(d.moneyIn), d.monthLabel + ' • terverifikasi', 'banknote', '', 'kpi-hero-navy') +
      hero('Okupansi', L.fmtPct(d.occupancyPct), d.monthLabel, 'percent', 'green') +
      hero('Booking check-in', L.fmtNum(d.bookingsCheckin), d.monthLabel, 'calendarCheck', 'blue') +
      hero('Sisa tagihan', L.fmtRp(d.totalOutstanding), 'semua reservasi aktif', 'receipt', 'amber') +
      '</section>';

    /* 4 KPI pendukung sebagai strip ringkas (tidak ada data yang dihilangkan) */
    html += '<section class="kpi-grid kpi-strip">' +
      kpi('Malam terisi', L.fmtNum(d.nightsOccupied) + ' malam', 'dari ' + d.daysInMonth + ' hari') +
      kpi('Leads masuk', L.fmtNum(d.leadsThisMonth), d.monthLabel) +
      kpi('Uang keluar (terverifikasi)', L.fmtRp(d.moneyOut), d.monthLabel) +
      kpi('Arus kas bersih', L.fmtRp(d.netCash), d.monthLabel) +
      '</section>';

    /* Baris 1: arus kas (lebar) + donut komposisi pemasukan (sempit).
     * Grafik memakai 6 bulan terakhir, berakhir di bulan yang dipilih. */
    var cf = L.monthlyCashflow(state.data.transactions, state.dashMonth, 6);
    var comp = L.incomeComposition(state.data.transactions, state.dashMonth);
    var donutItems = comp.items.map(function (c) { return { label: c.category, value: c.total }; });
    html += '<section class="dash-row">' +
      '<div class="card chart-card"><h2>Arus kas 6 bulan terakhir</h2>' +
      '<p class="hint">Hanya transaksi Terverifikasi. Bulan terakhir: ' + esc(d.monthLabel) + '.</p>' +
      VTKCharts.cashflowChart(cf) + '</div>' +
      '<div class="card chart-card donut-card"><h2>Komposisi pemasukan</h2>' +
      '<p class="hint">' + esc(d.monthLabel) + ' — hanya transaksi Terverifikasi.</p>' +
      VTKCharts.donutChart(donutItems, { total: comp.total, totalLabel: 'Pemasukan',
        ariaLabel: 'Grafik donut komposisi pemasukan per kategori.',
        emptyMsg: 'Belum ada pemasukan terverifikasi di bulan ini.' }) +
      '<div class="card-foot"><button type="button" class="btn btn-small btn-primary" onclick="VTK.go(\'keuangan\')">Lihat Keuangan</button></div>' +
      '</div></section>';

    /* Baris 2: tren okupansi (lebar) + kalender mini (sempit) */
    var occ = L.monthlyOccupancy(state.data.reservations, state.dashMonth, 6);
    html += '<section class="dash-row">' +
      '<div class="card chart-card"><h2>Tren okupansi</h2>' +
      '<p class="hint">6 bulan terakhir, berakhir ' + esc(d.monthLabel) + '.</p>' +
      VTKCharts.occupancyChart(occ) + '</div>' +
      '<div class="card mini-cal-card"><h2>Kalender — ' + esc(d.monthLabel) + '</h2>' +
      miniCalHTML(state.dashMonth) +
      '<div class="card-foot"><button type="button" class="btn btn-small btn-primary" onclick="VTK.go(\'kalender\')">Lihat Kalender</button></div>' +
      '</div></section>';

    /* Perlu tindakan + kinerja sumber lead, berdampingan di desktop */
    var a = d.actions;
    var actionItems = [];
    a.unverified.forEach(function (tx) {
      actionItems.push('<li><a href="#/keuangan">' + L.fmtRp(tx.amount) + ' — ' + esc(tx.description || tx.category) +
        ' (' + L.fmtDate(tx.date) + ')</a> <span class="muted">menunggu verifikasi</span></li>');
    });
    a.upcomingCheckins.forEach(function (r) {
      actionItems.push('<li><a href="#/reservasi">Check-in ' + esc(r.guestName) + '</a> — ' +
        L.fmtDate(r.checkin) + ' (' + L.fmtNum(r.pax) + ' tamu)</li>');
    });
    a.overdueFollowups.forEach(function (l) {
      actionItems.push('<li><a href="#/leads">Follow-up ' + esc(l.name) + '</a> <span class="muted">terlewat sejak ' +
        L.fmtDate(l.nextFollowup) + '</span></li>');
    });
    a.dpOverdue.forEach(function (it) {
      var days = it.daysToCheckin;
      var when = days < 0 ? 'check-in sudah lewat ' + Math.abs(days) + ' hari' :
        days === 0 ? 'check-in hari ini' : 'check-in ' + days + ' hari lagi';
      actionItems.push('<li><a href="#/reservasi">' + esc(it.reservation.id) + ' — ' + esc(it.reservation.guestName) +
        '</a> <span class="muted">Menunggu DP, sisa ' + L.fmtRp(it.calc.remaining) + ', ' + when + '</span></li>');
    });
    a.overIdealDays.forEach(function (x) {
      actionItems.push('<li><span class="warn-text">' + L.fmtDate(x.date) + ': ' + L.fmtNum(x.pax) +
        ' tamu — di atas kapasitas ideal (' + L.fmtNum(s.capacity.idealPax) + ')</span></li>');
    });
    a.overMaxDays.forEach(function (x) {
      actionItems.push('<li><span class="bad-text">' + L.fmtDate(x.date) + ': ' + L.fmtNum(x.pax) +
        ' tamu — melebihi kapasitas maksimum (' + L.fmtNum(s.capacity.maxPax) + ')</span></li>');
    });
    html += '<section class="two-col">' +
      '<div class="card"><h2>Perlu tindakan ' +
      (actionItems.length ? '<span class="count-badge">' + actionItems.length + '</span>' : '') + '</h2>' +
      (actionItems.length ? '<ul class="action-list">' + actionItems.join('') + '</ul>' : emptyState('Tidak ada yang perlu tindakan.')) +
      '</div>';

    /* Kinerja sumber lead + grafik batang nilai booking per sumber */
    var srcRows = d.sourcePerf.map(function (sp) {
      return '<tr><td data-label="Sumber">' + esc(sp.source) + '</td>' +
        '<td data-label="Leads">' + L.fmtNum(sp.leads) + '</td>' +
        '<td data-label="Menang">' + L.fmtNum(sp.won) + '</td>' +
        '<td data-label="Konversi">' + L.fmtPct(sp.conversion) + '</td>' +
        '<td data-label="Nilai booking">' + L.fmtRp(sp.bookingValue) + '</td></tr>';
    }).join('');
    var srcItems = d.sourcePerf.map(function (sp) {
      return { label: sp.source, value: sp.bookingValue };
    }).sort(function (a, b) { return b.value - a.value; });
    html += '<div class="card chart-card"><h2>Kinerja sumber lead — ' + esc(d.monthLabel) + '</h2>' +
      '<h3>Nilai booking per sumber</h3>' +
      '<p class="hint">Berdasarkan tanggal booking.</p>' +
      VTKCharts.hBarChart(srcItems, { color: 'orange', ariaLabel: 'Grafik batang nilai booking per sumber lead.',
        emptyMsg: 'Belum ada data — grafik muncul setelah ada reservasi.' }) +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Sumber</th><th>Leads</th><th>Menang</th><th>Konversi</th><th>Nilai booking</th></tr></thead>' +
      '<tbody>' + srcRows + '</tbody></table></div></div></section>';

    /* Check-in berikutnya + transaksi terakhir */
    var nextRows = d.nextCheckins.length ? d.nextCheckins.map(function (r) {
      var c = L.reservationCalc(r, state.data.transactions, s);
      return '<li><a href="#/reservasi">' + esc(r.guestName) + '</a> — ' + L.fmtDate(r.checkin) +
        ' (' + c.nights + ' malam, ' + L.fmtNum(r.pax) + ' tamu) ' + resStatusBadge(r.status) + '</li>';
    }).join('') : '<li class="muted">Belum ada check-in mendatang.</li>';
    var txRows = d.recentTx.length ? d.recentTx.map(function (tx) {
      return '<li>' + L.fmtDate(tx.date) + ' — ' + esc(tx.description || tx.category) +
        ' <strong class="nowrap">' + (tx.type === 'Masuk' ? '+' : '−') + L.fmtRp(tx.amount) + '</strong> ' + verifyBadge(tx.verifyStatus) + '</li>';
    }).join('') : '<li class="muted">Belum ada transaksi.</li>';
    html += '<section class="two-col">' +
      '<div class="card"><h2>Check-in berikutnya</h2><ul class="simple-list">' + nextRows + '</ul></div>' +
      '<div class="card"><h2>Transaksi terakhir</h2><ul class="simple-list">' + txRows + '</ul></div>' +
      '</section>';

    /* Biaya tetap + titik impas */
    var be = d.breakeven;
    var beText = (be.weekday !== null && be.weekend !== null)
      ? '≈ ' + be.weekday + ' malam weekday / ' + be.weekend + ' malam weekend per bulan'
      : '—';
    html += '<section class="card"><h2>Biaya tetap &amp; titik impas</h2>' +
      '<p>Total biaya tetap <strong>' + L.fmtRp(d.fixedCost.total) + '/bulan</strong> ' +
      '(gaji, listrik &amp; air, internet, keamanan, gaji owner, estimasi maintenance). ' +
      'Titik impas kasar: <strong>' + esc(beText) + '</strong> ' +
      '(pendapatan kotor, belum biaya variabel).</p></section>';

    return html;
  }

  /* Kalender mini dashboard: grid ringkas bulan yang dipilih (Senin dulu).
   * Hari terisi ditandai oranye, hari ini dilingkari; klik hari membuka
   * halaman Kalender pada bulan & hari tersebut. */
  function miniCalHTML(monthKey) {
    var y = +String(monthKey).slice(0, 4);
    var m0 = +String(monthKey).slice(5, 7) - 1;
    var cells = L.calendarCells(state.data, y, m0, L.todayISO());
    var dows = ['S', 'S', 'R', 'K', 'J', 'S', 'M'];
    var occupied = 0;
    var h = '<div class="mini-cal" role="grid" aria-label="Kalender mini ' + esc(L.monthLabel(monthKey)) + '">';
    dows.forEach(function (dow) { h += '<div class="mini-cal-dow">' + dow + '</div>'; });
    cells.forEach(function (c) {
      var cls = 'mini-cal-cell';
      if (!c.inMonth) { cls += ' other'; }
      if (c.isToday) { cls += ' today'; }
      if (c.reservations.length) {
        cls += ' occupied';
        if (c.inMonth) { occupied++; }
      }
      var label = L.fmtDate(c.dateISO) + (c.reservations.length ? ' — terisi (' + c.reservations.length + ' reservasi)' : ' — kosong');
      h += '<button type="button" class="' + cls + '" title="' + esc(label) + '" aria-label="' + esc(label) +
        '" onclick="VTK.miniCalGo(\'' + c.dateISO + '\')">' + c.day + '</button>';
    });
    h += '</div>';
    h += occupied
      ? '<p class="hint">Hari oranye = terisi.</p>'
      : '<p class="hint">Belum ada reservasi di bulan ini.</p>';
    return h;
  }

  /* ---------------- 2. Reservasi ---------------- */

  function reservationsViewHTML() {
    var f = state.filters.res;
    var list = reservationsSorted().filter(function (r) {
      if (f.status && r.status !== f.status) { return false; }
      if (f.month && (r.checkin || '').slice(0, 7) !== f.month) { return false; }
      if (f.q) {
        var q = f.q.toLowerCase();
        if (!((r.guestName || '').toLowerCase().indexOf(q) !== -1 ||
          (r.id || '').toLowerCase().indexOf(q) !== -1)) { return false; }
      }
      return true;
    });
    var rows = list.map(function (r) {
      var c = L.reservationCalc(r, state.data.transactions, state.data.settings);
      return '<tr class="clickable" onclick="VTK.openResForm(\'' + esc(r.id) + '\')">' +
        '<td data-label="Booking ID">' + esc(r.id) + '</td>' +
        '<td data-label="Tamu">' + esc(r.guestName) + '</td>' +
        '<td data-label="Check-in">' + L.fmtDate(r.checkin) + '</td>' +
        '<td data-label="Check-out">' + L.fmtDate(r.checkout) + '</td>' +
        '<td data-label="Malam">' + c.nights + '</td>' +
        '<td data-label="Tamu (pax)">' + L.fmtNum(r.pax) + '</td>' +
        '<td data-label="Total">' + L.fmtRp(c.total) + '</td>' +
        '<td data-label="Terbayar">' + L.fmtRp(c.paid) + '</td>' +
        '<td data-label="Sisa">' + L.fmtRp(c.remaining) + '</td>' +
        '<td data-label="Status Bayar">' + payBadge(c.payStatus) + '</td>' +
        '<td data-label="Status">' + resStatusBadge(r.status) + '</td></tr>';
    }).join('');

    return '<section class="page-head"><h1>Reservasi</h1>' +
      '<button type="button" class="btn btn-primary" onclick="VTK.openResForm()">+ Tambah reservasi</button></section>' +
      '<section class="filters card">' +
      '<label class="field"><span>Status</span><select onchange="VTK.setFilter(\'res\',\'status\',this.value)">' +
      '<option value="">Semua</option>' + optList(L.RES_STATUSES, f.status) + '</select></label>' +
      '<label class="field"><span>Bulan check-in</span><input type="month" value="' + esc(f.month) + '" onchange="VTK.setFilter(\'res\',\'month\',this.value)" /></label>' +
      '<label class="field field-grow"><span>Cari nama / Booking ID</span>' +
      '<input type="search" value="' + esc(f.q) + '" placeholder="cth: Budi / BK-202611-001" oninput="VTK.setFilter(\'res\',\'q\',this.value)" /></label>' +
      '<button type="button" class="btn btn-small" onclick="VTK.exportCSV(\'reservasi\')">Unduh CSV</button>' +
      '</section>' +
      '<section class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>Booking ID</th><th>Tamu</th><th>Check-in</th><th>Check-out</th><th>Malam</th><th>Tamu (pax)</th>' +
      '<th>Total</th><th>Terbayar</th><th>Sisa</th><th>Status Bayar</th><th>Status</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="11" class="empty">Belum ada reservasi.</td></tr>') + '</tbody></table></div></section>';
  }

  function reservationById(id) {
    return (state.data.reservations || []).find(function (r) { return r.id === id; }) || null;
  }

  function leadOptions(selectedId) {
    var opts = '<option value="">— Tidak terkait lead —</option>';
    leadsSorted().forEach(function (l) {
      opts += '<option value="' + esc(l.id) + '"' + (l.id === selectedId ? ' selected' : '') + '>' +
        esc(l.id) + ' — ' + esc(l.name) + '</option>';
    });
    return opts;
  }

  function reservationFormHTML() {
    var f = state.form;
    var isNew = !f.id;
    var r = f.id ? reservationById(f.id) : null;
    var p = f.prefill || {};
    var v = r || {
      bookingDate: L.todayISO(), checkin: p.checkin || '', checkout: p.checkout || '',
      guestName: p.guestName || '', wa: p.wa || '', pax: p.pax || '',
      vipRooms: 0, extraBeds: 0, source: p.source || 'WhatsApp langsung',
      status: p.status || 'Permintaan', ratePerNight: '', extraCost: 0, discount: 0,
      leadId: p.leadId || '', specialRequest: '', internalNote: '',
      promoEarlyCheckin: 'Tidak', agreedCheckinTime: '', h1Confirmation: '',
      h1EmptyVerified: 'Belum', promoHelped: 'Tidak Ditanya', promoDirectCost: 0
    };
    state.rateTouched = !!r; /* saat edit, saran tidak menimpa tarif tersimpan */
    var title = isNew ? 'Reservasi baru' : 'Ubah reservasi ' + esc(r.id);
    var existingCalc = r ? L.reservationCalc(r, state.data.transactions, state.data.settings) : null;

    return '<section class="page-head"><h1>' + title + '</h1>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">← Kembali ke daftar</button></section>' +
      '<form class="card form-card" id="res-form" onsubmit="return VTK.saveRes(event)" oninput="VTK.resFormRecalc()">' +
      '<input type="hidden" name="id" value="' + (r ? esc(r.id) : '') + '" />' +
      '<h2>Tamu &amp; tanggal</h2>' +
      '<div class="form-row">' +
      '<label class="field"><span>Tanggal booking *</span><input type="date" name="bookingDate" value="' + esc(v.bookingDate) + '" required /></label>' +
      '<label class="field"><span>Check-in *</span><input type="date" name="checkin" value="' + esc(v.checkin) + '" required /></label>' +
      '<label class="field"><span>Check-out *</span><input type="date" name="checkout" value="' + esc(v.checkout) + '" required /></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field field-grow"><span>Nama tamu *</span><input type="text" name="guestName" value="' + esc(v.guestName) + '" required /></label>' +
      '<label class="field"><span>Nomor WhatsApp</span><input type="tel" name="wa" value="' + esc(v.wa) + '" placeholder="08…" /></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>Jumlah tamu (pax) *</span><input type="number" name="pax" min="1" step="1" value="' + esc(v.pax) + '" required /></label>' +
      '<label class="field"><span>Kamar VIP dipakai (0–4)</span><input type="number" name="vipRooms" min="0" max="4" step="1" value="' + esc(v.vipRooms) + '" /></label>' +
      '<label class="field"><span>Extra bed dipakai</span><input type="number" name="extraBeds" min="0" step="1" value="' + esc(v.extraBeds) + '" /></label>' +
      '</div>' +
      '<div id="res-warnings"></div>' +
      '<h2>Harga</h2>' +
      '<div class="form-row">' +
      '<label class="field"><span>Tarif / malam (Rp) *</span>' +
      '<input type="number" name="ratePerNight" id="rf-rate" min="0" step="1000" value="' + esc(v.ratePerNight) + '" required oninput="VTK.markRateTouched()" />' +
      '<span class="hint" id="rf-rate-hint"></span></label>' +
      '<label class="field"><span>Biaya tambahan (Rp)</span><input type="number" name="extraCost" min="0" step="1000" value="' + esc(v.extraCost) + '" /></label>' +
      '<label class="field"><span>Diskon (Rp)</span><input type="number" name="discount" min="0" step="1000" value="' + esc(v.discount) + '" /></label>' +
      '</div>' +
      '<div class="calc-box" id="res-calc"></div>' +
      '<h2>Status &amp; sumber</h2>' +
      '<div class="form-row">' +
      '<label class="field"><span>Status reservasi</span><select name="status">' + optList(L.RES_STATUSES, v.status) + '</select></label>' +
      '<label class="field"><span>Sumber</span><select name="source">' + optList(L.LEAD_SOURCES, v.source) + '</select></label>' +
      '<label class="field"><span>Lead terkait</span><select name="leadId">' + leadOptions(v.leadId) + '</select></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field field-grow"><span>Permintaan khusus</span><textarea name="specialRequest" rows="2">' + esc(v.specialRequest) + '</textarea></label>' +
      '<label class="field field-grow"><span>Catatan internal</span><textarea name="internalNote" rows="2">' + esc(v.internalNote) + '</textarea></label>' +
      '</div>' +
      '<h2>Promo early check-in</h2>' +
      '<div class="form-row">' +
      '<label class="field"><span>Promo early check-in</span><select name="promoEarlyCheckin">' + optList(['Ya', 'Tidak'], v.promoEarlyCheckin) + '</select></label>' +
      '<label class="field"><span>Jam check-in disepakati</span><input type="time" name="agreedCheckinTime" value="' + esc(v.agreedCheckinTime) + '" /></label>' +
      '<label class="field"><span>Konfirmasi H-1</span><input type="datetime-local" name="h1Confirmation" value="' + esc(v.h1Confirmation) + '" /></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>H-1 kosong terverifikasi</span><select name="h1EmptyVerified">' + optList(['Belum', 'Terverifikasi'], v.h1EmptyVerified) + '</select></label>' +
      '<label class="field"><span>Promo membantu booking</span><select name="promoHelped">' + optList(['Ya', 'Tidak', 'Tidak Ditanya'], v.promoHelped) + '</select></label>' +
      '<label class="field"><span>Biaya langsung promo (Rp)</span><input type="number" name="promoDirectCost" min="0" step="1000" value="' + esc(v.promoDirectCost) + '" /></label>' +
      '</div>' +
      (existingCalc ? '<p class="hint">Terbayar saat ini (dari transaksi terverifikasi): <strong>' + L.fmtRp(existingCalc.paid) +
        '</strong> — sisa ' + L.fmtRp(existingCalc.remaining) + ' (' + esc(existingCalc.payStatus) + '). ' +
        'Untuk mencatat pembayaran, tambah transaksi di modul Keuangan dengan Booking ID ini.</p>' : '') +
      '<div id="res-overlap-confirm"></div>' +
      saveStatusHTML() +
      '<div class="form-actions">' +
      '<button type="submit" class="btn btn-primary">Simpan reservasi</button>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">Batal</button>' +
      (r ? '<button type="button" class="btn btn-danger" onclick="VTK.delRes(\'' + esc(r.id) + '\')">Hapus</button>' : '') +
      '</div></form>';
  }

  function readResForm() {
    var form = $('res-form');
    var fd = new FormData(form);
    var num = function (k) { var n = parseFloat(fd.get(k)); return isNaN(n) ? 0 : n; };
    return {
      id: fd.get('id') || '',
      bookingDate: fd.get('bookingDate') || '',
      checkin: fd.get('checkin') || '',
      checkout: fd.get('checkout') || '',
      guestName: (fd.get('guestName') || '').trim(),
      wa: (fd.get('wa') || '').trim(),
      pax: parseInt(fd.get('pax'), 10) || 0,
      vipRooms: parseInt(fd.get('vipRooms'), 10) || 0,
      extraBeds: parseInt(fd.get('extraBeds'), 10) || 0,
      source: fd.get('source') || '',
      status: fd.get('status') || 'Permintaan',
      ratePerNight: num('ratePerNight'),
      extraCost: num('extraCost'),
      discount: num('discount'),
      leadId: fd.get('leadId') || '',
      specialRequest: (fd.get('specialRequest') || '').trim(),
      internalNote: (fd.get('internalNote') || '').trim(),
      promoEarlyCheckin: fd.get('promoEarlyCheckin') || 'Tidak',
      agreedCheckinTime: fd.get('agreedCheckinTime') || '',
      h1Confirmation: fd.get('h1Confirmation') || '',
      h1EmptyVerified: fd.get('h1EmptyVerified') || 'Belum',
      promoHelped: fd.get('promoHelped') || 'Tidak Ditanya',
      promoDirectCost: num('promoDirectCost')
    };
  }

  /* Hitung ulang dinamis: malam, total, DP, jatuh tempo, saran tarif,
   * peringatan bentrok & kapasitas. Dipanggil pada setiap input. */
  function resFormRecalc() {
    var form = $('res-form');
    if (!form) { return; }
    var v = readResForm();
    var s = state.data.settings;
    var calcEl = $('res-calc');
    var warnEl = $('res-warnings');
    var hintEl = $('rf-rate-hint');
    var overlapEl = $('res-overlap-confirm');

    /* Saran tarif */
    var suggestion = L.suggestedRate(v.checkin, v.checkout, s);
    if (hintEl) {
      if (suggestion !== null) {
        hintEl.innerHTML = 'Saran: ' + L.fmtRp(suggestion) + '/malam ' +
          '<button type="button" class="btn btn-small btn-ghost" onclick="VTK.applySuggestedRate(' + suggestion + ')">Pakai saran</button>';
        /* Isi otomatis hanya untuk reservasi baru & tarif belum disentuh. */
        if (!v.id && !state.rateTouched) {
          var rateInput = $('rf-rate');
          if (rateInput && !rateInput.value) { rateInput.value = suggestion; v.ratePerNight = suggestion; }
        }
      } else {
        hintEl.textContent = 'Isi check-in & check-out untuk saran tarif otomatis (peak/weekend/weekday).';
      }
    }

    /* Peringatan */
    var warnings = [];
    if (v.checkin && v.checkout && v.checkout <= v.checkin) {
      warnings.push('<div class="alert bad">Check-out harus setelah check-in.</div>');
    }
    var overlap = L.findOverlap(state.data.reservations, v.checkin, v.checkout, v.id || null);
    if (overlap) {
      warnings.push('<div class="alert bad"><strong>Bentrok tanggal!</strong> Villa hanya 1 unit. ' +
        'Rentang ini tumpang tindih dengan ' + esc(overlap.id) + ' — ' + esc(overlap.guestName) +
        ' (' + L.fmtDate(overlap.checkin) + ' s.d. ' + L.fmtDate(overlap.checkout) + ').</div>');
    }
    var cap = L.capacityLevel(v.pax || 0, s);
    if (cap === 'max') {
      warnings.push('<div class="alert bad"><strong>Melebihi kapasitas maksimum</strong> (' + L.fmtNum(s.capacity.maxPax) + ' tamu).</div>');
    } else if (cap === 'ideal') {
      warnings.push('<div class="alert warn"><strong>Di atas kapasitas ideal</strong> (' + L.fmtNum(s.capacity.idealPax) + ' tamu) — pertimbangkan extra bed / kamar VIP.</div>');
    }
    var peakWarn = L.peakMinNightsWarning(v.checkin, v.checkout, s);
    if (peakWarn) {
      warnings.push('<div class="alert warn"><strong>Di bawah minimum peak ' + esc(peakWarn.peak.name) + '</strong> — ' +
        'menginap ' + peakWarn.nights + ' malam, minimum ' + peakWarn.minNights + ' malam untuk periode peak ini.</div>');
    }
    if (warnEl) { warnEl.innerHTML = warnings.join(''); }
    if (overlapEl) {
      overlapEl.innerHTML = overlap
        ? '<label class="field checkbox"><input type="checkbox" id="rf-overlap-ok" /> ' +
          '<span>Saya yakin, simpan meski bentrok dengan ' + esc(overlap.id) + '</span></label>'
        : '';
    }

    /* Ringkasan hitung */
    if (calcEl) {
      var c = L.reservationCalc(v, state.data.transactions, s);
      var paidNow = v.id ? L.paidForBooking(v.id, state.data.transactions) : 0;
      var remainingNow = Math.max(0, c.total - paidNow);
      calcEl.innerHTML =
        '<div><span>Malam</span><strong>' + c.nights + '</strong></div>' +
        '<div><span>Total booking</span><strong>' + L.fmtRp(c.total) + '</strong></div>' +
        '<div><span>DP 50%</span><strong>' + L.fmtRp(c.dpAmount) + '</strong></div>' +
        '<div><span>Jatuh tempo pelunasan (H-3)</span><strong>' + L.fmtDate(c.dueDate) + '</strong></div>' +
        (v.id ? '<div><span>Terbayar</span><strong>' + L.fmtRp(paidNow) + '</strong></div>' +
          '<div><span>Sisa tagihan</span><strong>' + L.fmtRp(remainingNow) + '</strong></div>' : '');
    }
  }

  function saveRes(event) {
    event.preventDefault();
    var v = readResForm();
    var errors = [];
    if (!v.guestName) { errors.push('Nama tamu wajib diisi.'); }
    if (!L.isISODate(v.checkin) || !L.isISODate(v.checkout)) { errors.push('Tanggal check-in & check-out wajib diisi.'); }
    else if (v.checkout <= v.checkin) { errors.push('Check-out harus setelah check-in.'); }
    if (!v.pax || v.pax < 1) { errors.push('Jumlah tamu minimal 1.'); }
    if (v.vipRooms < 0 || v.vipRooms > 4) { errors.push('Kamar VIP dipakai harus 0–4.'); }
    if (v.ratePerNight < 0) { errors.push('Tarif/malam tidak boleh negatif.'); }
    var overlap = L.findOverlap(state.data.reservations, v.checkin, v.checkout, v.id || null);
    if (overlap) {
      var okBox = $('rf-overlap-ok');
      if (!okBox || !okBox.checked) {
        errors.push('Tanggal bentrok dengan ' + overlap.id + '. Centang konfirmasi bila tetap ingin menyimpan.');
      }
    }
    if (errors.length) { setSaveStatus(errors.join(' '), 'error'); return false; }

    setSaveStatus('Menyimpan…', '');
    var isNew = !v.id;
    if (isNew) {
      v.id = L.nextId('BK', state.data.reservations, v.bookingDate || L.todayISO());
      state.data.reservations.push(touch(v));
    } else {
      var existing = reservationById(v.id);
      if (!existing) { setSaveStatus('Reservasi tidak ditemukan.', 'error'); return false; }
      var createdAt = existing.createdAt;
      Object.assign(existing, v);
      existing.createdAt = createdAt;
      touch(existing);
    }
    commit().then(function (res) {
      if (res.ok) {
        setSaveStatus('Tersimpan ✓', 'ok');
        toast('Reservasi ' + v.id + ' tersimpan.');
        state.form = null;
        renderView();
      } else if (res.demo) {
        setSaveStatus('Tersimpan (mode demo — tidak permanen).', 'warn');
        toast('Tersimpan di mode demo (tidak permanen).', 'warn');
        state.form = null;
        renderView();
      } else {
        /* Tersimpan lokal, gagal dorong: jangan hilangkan, beri tahu + tawarkan coba lagi. */
        setSaveStatus('Tersimpan di perangkat ini, belum tersinkron: ' + res.error, 'warn');
        toast('Tersimpan lokal, belum tersinkron.', 'warn');
        state.form = null;
        renderView();
      }
    });
    return false;
  }

  function delRes(id) {
    var r = reservationById(id);
    if (!r) { return; }
    var linked = (state.data.transactions || []).filter(function (tx) { return tx.bookingId === id; }).length;
    var msg = 'Hapus reservasi ' + id + ' (' + r.guestName + ')?' +
      (linked ? '\n\nPerhatian: ada ' + linked + ' transaksi yang merujuk Booking ID ini. Transaksi tidak ikut terhapus.' : '');
    if (!confirmDialog(msg)) { return; }
    state.data.reservations = state.data.reservations.filter(function (x) { return x.id !== id; });
    commit().then(function () {
      toast('Reservasi ' + id + ' dihapus.');
      state.form = null;
      renderView();
    });
  }

  /* ---------------- 3. Keuangan ---------------- */

  function financeViewHTML() {
    var f = state.filters.tx;
    var list = transactionsSorted().filter(function (tx) {
      if (f.month && (tx.date || '').slice(0, 7) !== f.month) { return false; }
      if (f.type && tx.type !== f.type) { return false; }
      if (f.category && tx.category !== f.category) { return false; }
      if (f.status && tx.verifyStatus !== f.status) { return false; }
      return true;
    });
    var sumIn = 0;
    var sumOut = 0;
    list.forEach(function (tx) {
      if (tx.type === 'Masuk') { sumIn += +tx.amount || 0; }
      else { sumOut += +tx.amount || 0; }
    });
    var rows = list.map(function (tx) {
      return '<tr class="clickable" onclick="VTK.openTxForm(\'' + esc(tx.id) + '\')">' +
        '<td data-label="ID">' + esc(tx.id) + '</td>' +
        '<td data-label="Tanggal">' + L.fmtDate(tx.date) + '</td>' +
        '<td data-label="Jenis">' + badge(tx.type, tx.type === 'Masuk' ? 'ok' : 'bad') + '</td>' +
        '<td data-label="Kategori">' + esc(tx.category) + '</td>' +
        '<td data-label="Booking ID">' + esc(tx.bookingId || '—') + '</td>' +
        '<td data-label="Deskripsi">' + esc(tx.description) + '</td>' +
        '<td data-label="Metode">' + esc(tx.method) + '</td>' +
        '<td data-label="Jumlah">' + L.fmtRp(tx.amount) + '</td>' +
        '<td data-label="Status Verifikasi">' + verifyBadge(tx.verifyStatus) + '</td></tr>';
    }).join('');

    /* Grafik per kategori (bulan yang difilter; hanya transaksi Terverifikasi) */
    var catMonth = f.month || null;
    var catLabel = catMonth ? L.monthLabel(catMonth) : 'Semua bulan';
    var inCats = L.categoryTotals(state.data.transactions, catMonth, 'Masuk');
    var outCats = L.categoryTotals(state.data.transactions, catMonth, 'Keluar');
    var catCharts = '<section class="two-col">' +
      '<div class="card chart-card"><h2>Pemasukan per kategori</h2>' +
      '<p class="hint">' + esc(catLabel) + ' — hanya transaksi Terverifikasi.</p>' +
      VTKCharts.hBarChart(inCats.map(function (c) { return { label: c.category, value: c.total }; }),
        { color: 'green', ariaLabel: 'Grafik batang pemasukan per kategori.',
          emptyMsg: 'Belum ada data — grafik muncul setelah ada pemasukan terverifikasi.' }) + '</div>' +
      '<div class="card chart-card"><h2>Pengeluaran per kategori</h2>' +
      '<p class="hint">' + esc(catLabel) + ' — hanya transaksi Terverifikasi.</p>' +
      VTKCharts.hBarChart(outCats.map(function (c) { return { label: c.category, value: c.total }; }),
        { color: 'red', ariaLabel: 'Grafik batang pengeluaran per kategori.',
          emptyMsg: 'Belum ada data — grafik muncul setelah ada pengeluaran terverifikasi.' }) + '</div>' +
      '</section>';

    return '<section class="page-head"><h1>Keuangan</h1>' +
      '<button type="button" class="btn btn-primary" onclick="VTK.openTxForm()">+ Tambah transaksi</button></section>' +
      '<section class="kpi-grid kpi-grid-3">' +
      '<div class="kpi card"><div class="kpi-label">Total masuk</div><div class="kpi-value">' + L.fmtRp(sumIn) + '</div></div>' +
      '<div class="kpi card"><div class="kpi-label">Total keluar</div><div class="kpi-value">' + L.fmtRp(sumOut) + '</div></div>' +
      '<div class="kpi card"><div class="kpi-label">Bersih</div><div class="kpi-value">' + L.fmtRp(sumIn - sumOut) + '</div></div>' +
      '</section>' +
      '<section class="filters card">' +
      '<label class="field"><span>Bulan</span><input type="month" value="' + esc(f.month) + '" onchange="VTK.setFilter(\'tx\',\'month\',this.value)" /></label>' +
      '<label class="field"><span>Jenis</span><select onchange="VTK.setFilter(\'tx\',\'type\',this.value)">' +
      '<option value="">Semua</option>' + optList(L.TX_TYPES, f.type) + '</select></label>' +
      '<label class="field"><span>Kategori</span><select onchange="VTK.setFilter(\'tx\',\'category\',this.value)">' +
      '<option value="">Semua</option>' + optList(L.TX_CATEGORIES, f.category) + '</select></label>' +
      '<label class="field"><span>Status</span><select onchange="VTK.setFilter(\'tx\',\'status\',this.value)">' +
      '<option value="">Semua</option>' + optList(L.TX_VERIFY, f.status) + '</select></label>' +
      '<button type="button" class="btn btn-small" onclick="VTK.exportCSV(\'keuangan\')">Unduh CSV</button>' +
      '</section>' +
      catCharts +
      '<section class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>ID</th><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Booking ID</th><th>Deskripsi</th><th>Metode</th><th>Jumlah</th><th>Status Verifikasi</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="9" class="empty">Belum ada transaksi.</td></tr>') + '</tbody></table></div></section>';
  }

  function transactionById(id) {
    return (state.data.transactions || []).find(function (tx) { return tx.id === id; }) || null;
  }

  function bookingOptions(selectedId) {
    var opts = '<option value="">— Tanpa Booking ID —</option>';
    reservationsSorted().forEach(function (r) {
      opts += '<option value="' + esc(r.id) + '"' + (r.id === selectedId ? ' selected' : '') + '>' +
        esc(r.id) + ' — ' + esc(r.guestName) + ' (' + L.fmtDate(r.checkin) + ')</option>';
    });
    return opts;
  }

  function transactionFormHTML() {
    var f = state.form;
    var tx = f.id ? transactionById(f.id) : null;
    var p = f.prefill || {};
    var v = tx || {
      date: L.todayISO(), type: p.type || 'Masuk', category: p.category || 'Pembayaran Tamu',
      bookingId: p.bookingId || '', description: p.description || '', method: 'Transfer Bank',
      amount: p.amount || '', pic: '', verifyStatus: 'Belum Dicek', proof: '', note: ''
    };
    return '<section class="page-head"><h1>' + (tx ? 'Ubah transaksi ' + esc(tx.id) : 'Transaksi baru') + '</h1>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">← Kembali ke daftar</button></section>' +
      '<form class="card form-card" id="tx-form" onsubmit="return VTK.saveTx(event)">' +
      '<input type="hidden" name="id" value="' + (tx ? esc(tx.id) : '') + '" />' +
      '<div class="form-row">' +
      '<label class="field"><span>Tanggal *</span><input type="date" name="date" value="' + esc(v.date) + '" required /></label>' +
      '<label class="field"><span>Jenis *</span><select name="type">' + optList(L.TX_TYPES, v.type) + '</select></label>' +
      '<label class="field"><span>Kategori *</span><select name="category">' + optList(L.TX_CATEGORIES, v.category) + '</select></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>Booking ID</span><select name="bookingId">' + bookingOptions(v.bookingId) + '</select>' +
      '<span class="hint">Wajib untuk kategori Pembayaran Tamu / Refund Tamu (dipakai menghitung Terbayar).</span></label>' +
      '<label class="field"><span>Jumlah (Rp) *</span><input type="number" name="amount" min="0" step="1000" value="' + esc(v.amount) + '" required /></label>' +
      '<label class="field"><span>Metode</span><select name="method">' + optList(L.TX_METHODS, v.method) + '</select></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field field-grow"><span>Deskripsi *</span><input type="text" name="description" value="' + esc(v.description) + '" required /></label>' +
      '<label class="field"><span>Status verifikasi</span><select name="verifyStatus">' + optList(L.TX_VERIFY, v.verifyStatus) + '</select></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>PIC</span><input type="text" name="pic" value="' + esc(v.pic) + '" /></label>' +
      '<label class="field"><span>Bukti / referensi</span><input type="text" name="proof" value="' + esc(v.proof) + '" /></label>' +
      '<label class="field field-grow"><span>Catatan</span><input type="text" name="note" value="' + esc(v.note) + '" /></label>' +
      '</div>' +
      saveStatusHTML() +
      '<div class="form-actions">' +
      '<button type="submit" class="btn btn-primary">Simpan transaksi</button>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">Batal</button>' +
      (tx ? '<button type="button" class="btn btn-danger" onclick="VTK.delTx(\'' + esc(tx.id) + '\')">Hapus</button>' : '') +
      '</div></form>';
  }

  function saveTx(event) {
    event.preventDefault();
    var fd = new FormData($('tx-form'));
    var amount = parseFloat(fd.get('amount'));
    var errors = [];
    if (!L.isISODate(fd.get('date'))) { errors.push('Tanggal wajib diisi.'); }
    if (isNaN(amount) || amount <= 0) { errors.push('Jumlah harus lebih dari 0.'); }
    if (!(fd.get('description') || '').trim()) { errors.push('Deskripsi wajib diisi.'); }
    var category = fd.get('category');
    var bookingId = fd.get('bookingId') || '';
    if ((category === 'Pembayaran Tamu' || category === 'Refund Tamu') && !bookingId) {
      errors.push('Booking ID wajib diisi untuk kategori ' + category + '.');
    }
    if (errors.length) { setSaveStatus(errors.join(' '), 'error'); return false; }

    setSaveStatus('Menyimpan…', '');
    var id = fd.get('id') || '';
    var obj = {
      id: id,
      date: fd.get('date'),
      type: fd.get('type'),
      category: category,
      bookingId: bookingId,
      description: (fd.get('description') || '').trim(),
      method: fd.get('method'),
      amount: amount,
      month: (fd.get('date') || '').slice(0, 7),
      pic: (fd.get('pic') || '').trim(),
      verifyStatus: fd.get('verifyStatus'),
      proof: (fd.get('proof') || '').trim(),
      note: (fd.get('note') || '').trim()
    };
    if (!id) {
      obj.id = L.nextId('TRX', state.data.transactions, obj.date);
      state.data.transactions.push(touch(obj));
    } else {
      var existing = transactionById(id);
      if (!existing) { setSaveStatus('Transaksi tidak ditemukan.', 'error'); return false; }
      var createdAt = existing.createdAt;
      Object.assign(existing, obj);
      existing.createdAt = createdAt;
      touch(existing);
    }
    commit().then(function (res) {
      if (res.ok || res.demo) {
        toast('Transaksi ' + obj.id + ' tersimpan.');
        state.form = null;
        renderView();
      } else {
        setSaveStatus('Tersimpan di perangkat ini, belum tersinkron: ' + res.error, 'warn');
        state.form = null;
        renderView();
      }
    });
    return false;
  }

  function delTx(id) {
    var tx = transactionById(id);
    if (!tx) { return; }
    if (!confirmDialog('Hapus transaksi ' + id + ' (' + L.fmtRp(tx.amount) + ' — ' + tx.description + ')?')) { return; }
    state.data.transactions = state.data.transactions.filter(function (x) { return x.id !== id; });
    commit().then(function () {
      toast('Transaksi ' + id + ' dihapus.');
      state.form = null;
      renderView();
    });
  }

  /* ---------------- 4. Leads ---------------- */

  function leadsViewHTML() {
    var f = state.filters.lead;
    var today = L.todayISO();
    var list = leadsSorted().filter(function (l) {
      if (f.status && l.status !== f.status) { return false; }
      if (f.source && l.source !== f.source) { return false; }
      if (f.q) {
        var q = f.q.toLowerCase();
        if (!((l.name || '').toLowerCase().indexOf(q) !== -1 ||
          (l.id || '').toLowerCase().indexOf(q) !== -1)) { return false; }
      }
      return true;
    });
    var rows = list.map(function (l) {
      var overdue = l.nextFollowup && l.nextFollowup < today && l.status !== 'Menang' && l.status !== 'Kalah';
      var followup = l.nextFollowup ? L.fmtDate(l.nextFollowup) + (overdue ? ' ' + badge('Terlewat', 'bad') : '') : '—';
      return '<tr class="clickable" onclick="VTK.openLeadForm(\'' + esc(l.id) + '\')">' +
        '<td data-label="Lead ID">' + esc(l.id) + '</td>' +
        '<td data-label="Tanggal Masuk">' + L.fmtDate(l.dateIn) + '</td>' +
        '<td data-label="Nama">' + esc(l.name) + '</td>' +
        '<td data-label="WA">' + esc(l.wa || '—') + '</td>' +
        '<td data-label="Rencana Check-in">' + L.fmtDate(l.planCheckin) + '</td>' +
        '<td data-label="Rencana Check-out">' + L.fmtDate(l.planCheckout) + '</td>' +
        '<td data-label="Tamu">' + L.fmtNum(l.pax) + '</td>' +
        '<td data-label="Sumber">' + esc(l.source) + '</td>' +
        '<td data-label="Status">' + leadStatusBadge(l.status) + '</td>' +
        '<td data-label="Nilai Penawaran">' + (l.offerValue ? L.fmtRp(l.offerValue) : '—') + '</td>' +
        '<td data-label="Follow-up Berikutnya">' + followup + '</td>' +
        '<td data-label="Alasan Kalah">' + esc(l.lostReason || '—') + '</td>' +
        '<td data-label="Booking ID">' + esc(l.bookingId || '—') + '</td></tr>';
    }).join('');

    return '<section class="page-head"><h1>Leads</h1>' +
      '<button type="button" class="btn btn-primary" onclick="VTK.openLeadForm()">+ Tambah lead</button></section>' +
      '<section class="filters card">' +
      '<label class="field"><span>Status</span><select onchange="VTK.setFilter(\'lead\',\'status\',this.value)">' +
      '<option value="">Semua</option>' + optList(L.LEAD_STATUSES, f.status) + '</select></label>' +
      '<label class="field"><span>Sumber</span><select onchange="VTK.setFilter(\'lead\',\'source\',this.value)">' +
      '<option value="">Semua</option>' + optList(L.LEAD_SOURCES, f.source) + '</select></label>' +
      '<label class="field field-grow"><span>Cari nama / Lead ID</span>' +
      '<input type="search" value="' + esc(f.q) + '" placeholder="cth: Sari / LD-202611-001" oninput="VTK.setFilter(\'lead\',\'q\',this.value)" /></label>' +
      '<button type="button" class="btn btn-small" onclick="VTK.exportCSV(\'leads\')">Unduh CSV</button>' +
      '</section>' +
      '<section class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>Lead ID</th><th>Tanggal Masuk</th><th>Nama</th><th>WA</th><th>Rencana Check-in</th><th>Rencana Check-out</th>' +
      '<th>Tamu</th><th>Sumber</th><th>Status</th><th>Nilai Penawaran</th><th>Follow-up Berikutnya</th><th>Alasan Kalah</th><th>Booking ID</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="13" class="empty">Belum ada lead.</td></tr>') + '</tbody></table></div></section>';
  }

  function leadById(id) {
    return (state.data.leads || []).find(function (l) { return l.id === id; }) || null;
  }

  function leadFormHTML() {
    var f = state.form;
    var l = f.id ? leadById(f.id) : null;
    var v = l || {
      dateIn: L.todayISO(), name: '', wa: '', planCheckin: '', planCheckout: '',
      pax: '', source: 'WhatsApp langsung', status: 'Baru', offerValue: '',
      nextFollowup: '', lostReason: '', bookingId: '', pic: '', note: ''
    };
    var canConvert = l && (l.status === 'Menang' || l.status === 'Menunggu DP');
    return '<section class="page-head"><h1>' + (l ? 'Ubah lead ' + esc(l.id) : 'Lead baru') + '</h1>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">← Kembali ke daftar</button></section>' +
      '<form class="card form-card" id="lead-form" onsubmit="return VTK.saveLead(event)">' +
      '<input type="hidden" name="id" value="' + (l ? esc(l.id) : '') + '" />' +
      '<div class="form-row">' +
      '<label class="field"><span>Tanggal masuk *</span><input type="date" name="dateIn" value="' + esc(v.dateIn) + '" required /></label>' +
      '<label class="field field-grow"><span>Nama calon tamu *</span><input type="text" name="name" value="' + esc(v.name) + '" required /></label>' +
      '<label class="field"><span>Nomor WhatsApp</span><input type="tel" name="wa" value="' + esc(v.wa) + '" placeholder="08…" /></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>Rencana check-in</span><input type="date" name="planCheckin" value="' + esc(v.planCheckin) + '" /></label>' +
      '<label class="field"><span>Rencana check-out</span><input type="date" name="planCheckout" value="' + esc(v.planCheckout) + '" /></label>' +
      '<label class="field"><span>Jumlah tamu</span><input type="number" name="pax" min="1" step="1" value="' + esc(v.pax) + '" /></label>' +
      '<label class="field"><span>Sumber</span><select name="source">' + optList(L.LEAD_SOURCES, v.source) + '</select></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>Status</span><select name="status" id="lf-status" onchange="VTK.leadFormToggleLostReason()">' + optList(L.LEAD_STATUSES, v.status) + '</select></label>' +
      '<label class="field"><span>Nilai penawaran (Rp)</span><input type="number" name="offerValue" min="0" step="1000" value="' + esc(v.offerValue) + '" /></label>' +
      '<label class="field"><span>Follow-up berikutnya</span><input type="date" name="nextFollowup" value="' + esc(v.nextFollowup) + '" /></label>' +
      '</div>' +
      '<div class="form-row" id="lf-lost-row">' +
      '<label class="field"><span>Alasan kalah *</span><select name="lostReason" id="lf-lost">' +
      '<option value="">— Pilih alasan —</option>' + optList(L.LOST_REASONS, v.lostReason) + '</select>' +
      '<span class="hint">Wajib diisi bila status Kalah.</span></label>' +
      '<label class="field"><span>Booking ID terkait</span><select name="bookingId">' + bookingOptions(v.bookingId) + '</select></label>' +
      '<label class="field"><span>PIC</span><input type="text" name="pic" value="' + esc(v.pic) + '" /></label>' +
      '</div>' +
      '<label class="field"><span>Catatan</span><textarea name="note" rows="2">' + esc(v.note) + '</textarea></label>' +
      saveStatusHTML() +
      '<div class="form-actions">' +
      '<button type="submit" class="btn btn-primary">Simpan lead</button>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">Batal</button>' +
      (canConvert ? '<button type="button" class="btn btn-accent" onclick="VTK.leadToRes(\'' + esc(l.id) + '\')">Jadikan reservasi</button>' : '') +
      (l ? '<button type="button" class="btn btn-danger" onclick="VTK.delLead(\'' + esc(l.id) + '\')">Hapus</button>' : '') +
      '</div></form>';
  }

  function leadFormToggleLostReason() {
    var statusEl = $('lf-status');
    var row = $('lf-lost-row');
    var lostEl = $('lf-lost');
    if (!statusEl || !row) { return; }
    var isLost = statusEl.value === 'Kalah';
    row.style.display = isLost ? '' : 'none';
    if (lostEl) { lostEl.required = isLost; }
    if (!isLost && lostEl) { lostEl.value = ''; }
  }

  function saveLead(event) {
    event.preventDefault();
    var fd = new FormData($('lead-form'));
    var errors = [];
    if (!L.isISODate(fd.get('dateIn'))) { errors.push('Tanggal masuk wajib diisi.'); }
    if (!(fd.get('name') || '').trim()) { errors.push('Nama calon tamu wajib diisi.'); }
    if (fd.get('status') === 'Kalah' && !fd.get('lostReason')) { errors.push('Alasan kalah wajib diisi bila status Kalah.'); }
    if (fd.get('planCheckin') && fd.get('planCheckout') && fd.get('planCheckout') <= fd.get('planCheckin')) {
      errors.push('Rencana check-out harus setelah rencana check-in.');
    }
    if (errors.length) { setSaveStatus(errors.join(' '), 'error'); return false; }

    setSaveStatus('Menyimpan…', '');
    var id = fd.get('id') || '';
    var obj = {
      id: id,
      dateIn: fd.get('dateIn'),
      name: (fd.get('name') || '').trim(),
      wa: (fd.get('wa') || '').trim(),
      planCheckin: fd.get('planCheckin') || '',
      planCheckout: fd.get('planCheckout') || '',
      pax: parseInt(fd.get('pax'), 10) || 0,
      source: fd.get('source'),
      status: fd.get('status'),
      offerValue: parseFloat(fd.get('offerValue')) || 0,
      nextFollowup: fd.get('nextFollowup') || '',
      lostReason: fd.get('status') === 'Kalah' ? (fd.get('lostReason') || '') : '',
      bookingId: fd.get('bookingId') || '',
      pic: (fd.get('pic') || '').trim(),
      note: (fd.get('note') || '').trim()
    };
    if (!id) {
      obj.id = L.nextId('LD', state.data.leads, obj.dateIn);
      state.data.leads.push(touch(obj));
    } else {
      var existing = leadById(id);
      if (!existing) { setSaveStatus('Lead tidak ditemukan.', 'error'); return false; }
      var createdAt = existing.createdAt;
      Object.assign(existing, obj);
      existing.createdAt = createdAt;
      touch(existing);
    }
    commit().then(function (res) {
      if (res.ok || res.demo) {
        toast('Lead ' + obj.id + ' tersimpan.');
        state.form = null;
        renderView();
      } else {
        setSaveStatus('Tersimpan di perangkat ini, belum tersinkron: ' + res.error, 'warn');
        state.form = null;
        renderView();
      }
    });
    return false;
  }

  function delLead(id) {
    var l = leadById(id);
    if (!l) { return; }
    if (!confirmDialog('Hapus lead ' + id + ' (' + l.name + ')?')) { return; }
    state.data.leads = state.data.leads.filter(function (x) { return x.id !== id; });
    commit().then(function () {
      toast('Lead ' + id + ' dihapus.');
      state.form = null;
      renderView();
    });
  }

  function leadToRes(id) {
    var l = leadById(id);
    if (!l) { return; }
    state.pendingForm = {
      module: 'res',
      id: null,
      prefill: {
        guestName: l.name,
        wa: l.wa,
        checkin: l.planCheckin,
        checkout: l.planCheckout,
        pax: l.pax || '',
        source: l.source,
        leadId: l.id,
        status: 'Permintaan'
      }
    };
    go('reservasi');
  }

  /* ---------------- 5. Kalender ---------------- */

  function calendarViewHTML() {
    var today = L.todayISO();
    var cells = L.calendarCells(state.data, state.calYear, state.calMonth, today);
    var label = L.MONTHS_FULL[state.calMonth] + ' ' + state.calYear;
    var monthKey = state.calYear + '-' + L.pad2(state.calMonth + 1);

    var dayNames = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    var grid = dayNames.map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('');
    grid += cells.map(function (c) {
      var cls = 'cal-cell';
      if (!c.inMonth) { cls += ' other'; }
      if (c.isToday) { cls += ' today'; }
      if (c.isWeekend) { cls += ' weekend'; }
      if (c.peak) { cls += ' peak'; }
      if (c.reservations.length) { cls += ' occupied'; }
      if (c.capacity === 'ideal') { cls += ' over-ideal'; }
      if (c.capacity === 'max') { cls += ' over-max'; }
      if (state.calSelected === c.dateISO) { cls += ' selected'; }
      var body = '<span class="cal-day">' + c.day + '</span>';
      if (c.peak) { body += '<span class="cal-tag peak-tag">' + esc(c.peak.name) + '</span>'; }
      if (c.reservations.length === 1) {
        var r = c.reservations[0];
        body += '<span class="cal-guest">' + esc(r.guestName) + '</span><span class="cal-pax">' + L.fmtNum(c.pax) + ' tamu</span>';
      } else if (c.reservations.length > 1) {
        body += '<span class="cal-guest">' + c.reservations.length + ' reservasi</span><span class="cal-pax">' + L.fmtNum(c.pax) + ' tamu</span>';
      }
      if (c.capacity !== 'ok' && c.reservations.length) {
        body += '<span class="cal-tag cap-tag">' + (c.capacity === 'max' ? 'Melebihi maks' : 'Di atas ideal') + '</span>';
      }
      return '<button type="button" class="' + cls + '" onclick="VTK.calDayClick(\'' + c.dateISO + '\')">' + body + '</button>';
    }).join('');

    /* Detail hari terpilih */
    var detail = '';
    if (state.calSelected) {
      var selCells = cells.filter(function (c) { return c.dateISO === state.calSelected; });
      var sel = selCells[0];
      var selRes = sel ? sel.reservations : [];
      var items = selRes.length ? selRes.map(function (r) {
        var c = L.reservationCalc(r, state.data.transactions, state.data.settings);
        return '<li><a href="javascript:void(0)" onclick="VTK.openResForm(\'' + esc(r.id) + '\')">' + esc(r.guestName) + '</a> — ' +
          L.fmtDate(r.checkin) + ' s.d. ' + L.fmtDate(r.checkout) + ' (' + c.nights + ' malam, ' + L.fmtNum(r.pax) + ' tamu) ' +
          resStatusBadge(r.status) + '</li>';
      }).join('') : '<li class="muted">Villa kosong pada hari ini.</li>';
      detail = '<section class="card"><h2>' + L.fmtDate(state.calSelected) + '</h2><ul class="simple-list">' + items + '</ul>' +
        '<button type="button" class="btn btn-primary" onclick="VTK.addResForDay(\'' + state.calSelected + '\')">+ Tambah reservasi (check-in hari ini)</button></section>';
    }

    /* Daftar reservasi bulan ini */
    var monthRes = (state.data.reservations || []).filter(function (r) {
      if (r.status === 'Dibatalkan' || !L.isISODate(r.checkin) || !L.isISODate(r.checkout)) { return false; }
      var nextStart = L.addDaysISO(monthKey + '-01', L.daysInMonth(state.calYear, state.calMonth));
      return r.checkin < nextStart && r.checkout > monthKey + '-01';
    }).sort(function (a, b) { return a.checkin < b.checkin ? -1 : 1; });
    var monthList = monthRes.length ? monthRes.map(function (r) {
      return '<li><a href="javascript:void(0)" onclick="VTK.openResForm(\'' + esc(r.id) + '\')">' + esc(r.guestName) + '</a> — ' +
        L.fmtDate(r.checkin) + ' s.d. ' + L.fmtDate(r.checkout) + ' ' + resStatusBadge(r.status) + '</li>';
    }).join('') : '<li class="muted">Belum ada reservasi di bulan ini.</li>';

    return '<section class="page-head"><h1>Kalender</h1>' +
      '<div class="cal-nav">' +
      '<button type="button" class="btn" onclick="VTK.calNav(-1)" aria-label="Bulan sebelumnya">‹</button>' +
      '<strong>' + esc(label) + '</strong>' +
      '<button type="button" class="btn" onclick="VTK.calNav(1)" aria-label="Bulan berikutnya">›</button>' +
      '<button type="button" class="btn" onclick="VTK.calToday()">Hari ini</button>' +
      '</div></section>' +
      '<section class="card"><div class="cal-grid">' + grid + '</div>' +
      '<p class="hint legend"><span class="sw occupied"></span> Terisi &nbsp; <span class="sw peak"></span> Peak &nbsp; ' +
      '<span class="sw weekend"></span> Weekend &nbsp; <span class="sw today"></span> Hari ini &nbsp; ' +
      '<span class="sw over-ideal"></span> Di atas kapasitas ideal &nbsp; <span class="sw over-max"></span> Melebihi maksimum</p></section>' +
      detail +
      '<section class="card"><h2>Reservasi bulan ini</h2><ul class="simple-list">' + monthList + '</ul></section>';
  }

  /* ---------------- 6. Pengaturan ---------------- */

  function peakRowHTML(p, idx) {
    p = p || { name: '', start: '', end: '', rate: '', minNights: 2 };
    return '<div class="peak-row form-row" data-idx="' + idx + '">' +
      '<label class="field"><span>Nama</span><input type="text" class="pk-name" value="' + esc(p.name) + '" placeholder="cth: Natal" /></label>' +
      '<label class="field"><span>Mulai</span><input type="date" class="pk-start" value="' + esc(p.start) + '" /></label>' +
      '<label class="field"><span>Selesai</span><input type="date" class="pk-end" value="' + esc(p.end) + '" /></label>' +
      '<label class="field"><span>Tarif/malam (Rp)</span><input type="number" class="pk-rate" min="0" step="1000" value="' + esc(p.rate) + '" /></label>' +
      '<label class="field"><span>Min. malam</span><input type="number" class="pk-min" min="1" step="1" value="' + esc(p.minNights) + '" /></label>' +
      '<button type="button" class="btn btn-small btn-danger" onclick="VTK.delPeakRow(this)">Hapus</button>' +
      '</div>';
  }

  function settingsViewHTML() {
    var s = state.data.settings;
    var t = s.tariffs || {};
    var cap = s.capacity || {};
    var weekend = s.weekendNights || [5, 6];
    var dayChecks = [
      { v: 1, label: 'Senin' }, { v: 2, label: 'Selasa' }, { v: 3, label: 'Rabu' },
      { v: 4, label: 'Kamis' }, { v: 5, label: 'Jumat' }, { v: 6, label: 'Sabtu' }, { v: 0, label: 'Minggu' }
    ].map(function (d) {
      return '<label class="checkbox"><input type="checkbox" name="weekend" value="' + d.v + '"' +
        (weekend.indexOf(d.v) !== -1 ? ' checked' : '') + ' /> ' + d.label + '</label>';
    }).join(' ');
    var peaks = (s.peak || []).map(function (p, i) { return peakRowHTML(p, i); }).join('');
    var cateringRows = (s.catering || []).map(function (c, i) {
      return '<tr><td data-label="Paket">' + esc(c.package) + '</td>' +
        '<td data-label="1x makan"><input type="number" name="cat-' + i + '-1x" min="0" step="1000" value="' + esc(c.price1x) + '" /></td>' +
        '<td data-label="2x makan"><input type="number" name="cat-' + i + '-2x" min="0" step="1000" value="' + esc(c.price2x) + '" /></td>' +
        '<td data-label="Paket lengkap"><input type="number" name="cat-' + i + '-full" min="0" step="1000" value="' + esc(c.priceFull) + '" /></td></tr>';
    }).join('');

    var roomRows = (state.data.rooms || []).map(function (r) {
      return '<tr><td data-label="Jenis">' + esc(r.type) + '</td>' +
        '<td data-label="Jumlah">' + (r.count === null || r.count === undefined ? '—' : r.count) + '</td>' +
        '<td data-label="Kapasitas/unit">' + (r.capacityPerUnit === null || r.capacityPerUnit === undefined ? '—' : r.capacityPerUnit) + '</td>' +
        '<td data-label="Kasur">' + esc(r.bedType) + '</td>' +
        '<td data-label="Paket utama">' + esc(r.inMainPackage) + '</td>' +
        '<td data-label="Biaya tambahan">' + (typeof r.extraCost === 'number' ? L.fmtRp(r.extraCost) : esc(r.extraCost)) + '</td>' +
        '<td data-label="Catatan">' + esc(r.note || '') + '</td></tr>';
    }).join('');

    var menuHTML = (state.data.cateringMenus || []).map(function (m) {
      var menuBlock = function (label, text) {
        return '<p><strong>' + label + ':</strong><br />' + esc(text || '—').replace(/\n/g, '<br />') + '</p>';
      };
      return '<details class="menu-item"><summary><strong>' + esc(m.package) + '</strong> — ' +
        L.fmtRp(m.price1x) + ' / ' + L.fmtRp(m.price2x) + ' / ' + L.fmtRp(m.priceFull) + ' per pax</summary>' +
        '<div class="menu-body">' + menuBlock('Sarapan', m.breakfast) + menuBlock('Makan siang', m.lunch) +
        menuBlock('Sesi rehat', m.snack) + menuBlock('Makan malam', m.dinner) +
        '<p class="hint">' + esc(m.note || '') + '</p></div></details>';
    }).join('');

    var waHTML = (state.data.waTemplates || []).map(function (tpl, i) {
      return '<details class="menu-item"><summary><strong>' + esc(tpl.id) + ' — ' + esc(tpl.title) + '</strong></summary>' +
        '<div class="menu-body"><p>' + esc(tpl.text) + '</p><p class="hint">' + esc(tpl.note || '') + '</p>' +
        '<button type="button" class="btn btn-small" onclick="VTK.copyTemplate(' + i + ')">Salin teks</button></div></details>';
    }).join('');

    var hasToken = !!getToken();
    var c = state.conn;

    return '<section class="page-head"><h1>Pengaturan</h1></section>' +
      '<form class="card form-card" id="settings-form" onsubmit="return VTK.saveSettings(event)">' +
      '<h2>Profil &amp; tarif</h2>' +
      '<div class="form-row">' +
      '<label class="field field-grow"><span>Nama properti</span><input type="text" name="propertyName" value="' + esc(s.propertyName) + '" /></label>' +
      '<label class="field"><span>Jam check-in standar</span><input type="time" name="checkinTime" value="' + esc(s.checkinTime || '') + '" />' +
      '<span class="hint">Usulan: ' + esc(s.checkinTimeProposal || '14:00') + ' (belum dikonfirmasi pemilik). Kosongkan bila belum diputuskan.</span></label>' +
      '<label class="field"><span>Jam check-out</span><input type="time" name="checkoutTime" value="' + esc(s.checkoutTime || '') + '" /></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>PIC operasional</span><input type="text" name="picOperasional" value="' + esc(s.picOperasional || '') + '" /></label>' +
      '<label class="field"><span>Nomor WA utama</span><input type="tel" name="waUtama" value="' + esc(s.waUtama || '') + '" placeholder="08…" /></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>Tarif weekday 2026 (Rp)</span><input type="number" name="weekday2026" min="0" step="1000" value="' + esc(t.weekday2026) + '" /></label>' +
      '<label class="field"><span>Tarif weekend 2026 (Rp)</span><input type="number" name="weekend2026" min="0" step="1000" value="' + esc(t.weekend2026) + '" /></label>' +
      '<label class="field"><span>Tarif weekend sebelum 2026 (Rp)</span><input type="number" name="weekendPre2026" min="0" step="1000" value="' + esc(t.weekendPre2026) + '" /></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>Extra bed (Rp/bed)</span><input type="number" name="extraBed" min="0" step="1000" value="' + esc(t.extraBed) + '" /></label>' +
      '<label class="field"><span>Kamar VIP + villa (Rp)</span><input type="number" name="vipWithVilla" min="0" step="1000" value="' + esc(t.vipWithVilla) + '" /></label>' +
      '<label class="field"><span>Kamar VIP saja (Rp)</span><input type="number" name="vipOnly" min="0" step="1000" value="' + esc(t.vipOnly) + '" /></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>Kapasitas ideal (pax)</span><input type="number" name="idealPax" min="1" step="1" value="' + esc(cap.idealPax) + '" /></label>' +
      '<label class="field"><span>Kapasitas maksimum (pax)</span><input type="number" name="maxPax" min="1" step="1" value="' + esc(cap.maxPax) + '" /></label>' +
      '<label class="field"><span>DP (%)</span><input type="number" name="dpPct" min="0" max="100" step="1" value="' + Math.round((s.dpPct || 0) * 100) + '" /></label>' +
      '<label class="field"><span>Batas pelunasan</span><input type="text" name="paymentDeadline" value="' + esc(s.paymentDeadline || 'H-3') + '" /></label>' +
      '</div>' +
      '<fieldset class="field"><legend>Malam weekend (dipakai saran tarif)</legend>' +
      '<div class="checkbox-row">' + dayChecks + '</div>' +
      '<span class="hint">' + esc(s.weekendNote || '') + '</span></fieldset>' +
      '<div class="form-row">' +
      '<label class="field field-grow"><span>Kebijakan pembatalan</span><textarea name="cancellationPolicy" rows="2">' + esc(s.cancellationPolicy || '') + '</textarea></label>' +
      '<label class="field field-grow"><span>Kebijakan reschedule</span><textarea name="reschedulePolicy" rows="2">' + esc(s.reschedulePolicy || '') + '</textarea></label>' +
      '</div>' +
      '<h2>Periode peak</h2>' +
      '<div id="peak-rows">' + peaks + '</div>' +
      '<p class="hint">' + esc(s.peakNote || '') + '</p>' +
      '<p class="hint">Tanggal selesai = tanggal check-out: malam terakhir yang kena tarif peak adalah sehari sebelumnya. Contoh: Natal 24–27 Des berarti malam peak 24, 25, 26 Des.</p>' +
      '<button type="button" class="btn btn-small" onclick="VTK.addPeakRow()">+ Tambah periode peak</button>' +
      '<h2>Harga katering per paket (Rp/pax)</h2>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Paket</th><th>1x makan</th><th>2x makan</th><th>Paket lengkap</th></tr></thead>' +
      '<tbody>' + cateringRows + '</tbody></table></div>' +
      saveStatusHTML() +
      '<div class="form-actions"><button type="submit" class="btn btn-primary">Simpan pengaturan</button></div>' +
      '</form>' +

      '<section class="card"><h2>Koneksi GitHub</h2>' +
      '<p>Status token: ' + (hasToken
        ? '<strong>tersimpan di browser ini</strong> (tidak ditampilkan). Kosongkan kolom token bila tidak ingin menggantinya.'
        : '<strong>belum diatur</strong> — data hanya tersimpan di perangkat ini.') + '</p>' +
      '<form id="conn-form" onsubmit="return VTK.saveConn(event)">' +
      '<div class="form-row">' +
      '<label class="field"><span>Owner</span><input type="text" name="owner" value="' + esc(c.owner) + '" required /></label>' +
      '<label class="field"><span>Repo data</span><input type="text" name="repo" value="' + esc(c.repo) + '" required /></label>' +
      '<label class="field"><span>Branch</span><input type="text" name="branch" value="' + esc(c.branch) + '" required /></label>' +
      '</div>' +
      '<label class="field"><span>Token GitHub (fine-grained, Contents: Read and write untuk repo data)</span>' +
      '<input type="password" name="token" autocomplete="off" placeholder="' + (hasToken ? '•••••••• (tersimpan)' : 'github_pat_...') + '" /></label>' +
      '<p class="hint">Buat token di <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">github.com/settings/personal-access-tokens</a> — pilih repo data saja. Token tidak pernah ditulis ke file atau repo.</p>' +
      '<div class="form-actions">' +
      '<button type="submit" class="btn btn-primary">Simpan koneksi</button>' +
      '<button type="button" class="btn" onclick="VTK.testConn()">Tes koneksi</button>' +
      (hasToken ? '<button type="button" class="btn btn-danger" onclick="VTK.clearToken()">Hapus token</button>' : '') +
      '</div></form></section>' +

      '<section class="card"><h2>Data</h2>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn" onclick="VTK.exportJSON()">Unduh data.json (backup)</button>' +
      '<label class="btn">Impor data.json<input type="file" id="import-file" accept=".json,application/json" hidden onchange="VTK.importJSON(event)" /></label>' +
      '<button type="button" class="btn btn-danger" onclick="VTK.resetSeed()">Reset ke data master (seed)</button>' +
      '</div>' +
      '<p class="hint">Impor dan reset menimpa seluruh data (termasuk reservasi &amp; keuangan). Buat backup dulu bila ragu.</p></section>' +

      '<section class="card"><h2>Kamar &amp; kapasitas (baca-saja)</h2>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Jenis</th><th>Jumlah</th><th>Kapasitas/unit</th><th>Kasur</th><th>Paket utama</th><th>Biaya tambahan</th><th>Catatan</th></tr></thead>' +
      '<tbody>' + roomRows + '</tbody></table></div>' +
      '<p class="hint">Pengeditan kamar menyusul di tahap 2.</p></section>' +

      '<section class="card"><h2>Menu katering (baca-saja)</h2>' + (menuHTML || emptyState('Belum ada menu.')) + '</section>' +

      '<section class="card"><h2>Template WhatsApp</h2>' + (waHTML || emptyState('Belum ada template.')) +
      '<p class="hint">Ganti teks dalam {kurung kurawal} sebelum mengirim. Modul Template WA menyusul di tahap 2.</p></section>' +

      '<p class="hint version-note">Sistem Villa Taman Kelinci v' + APP_VERSION + ' — repo kode: danidwidarmawan/sistem-villa-taman-kelinci · repo data: ' + esc(c.owner) + '/' + esc(c.repo) + ' (privat).</p>';
  }

  function saveSettings(event) {
    event.preventDefault();
    var form = $('settings-form');
    var fd = new FormData(form);
    var num = function (k, def) { var n = parseFloat(fd.get(k)); return isNaN(n) ? def : n; };
    var s = state.data.settings;
    s.propertyName = (fd.get('propertyName') || '').trim() || s.propertyName;
    s.checkinTime = fd.get('checkinTime') || null;
    s.checkoutTime = fd.get('checkoutTime') || s.checkoutTime;
    s.picOperasional = (fd.get('picOperasional') || '').trim();
    s.waUtama = (fd.get('waUtama') || '').trim();
    s.tariffs = {
      weekday2026: num('weekday2026', s.tariffs.weekday2026),
      weekend2026: num('weekend2026', s.tariffs.weekend2026),
      weekendPre2026: num('weekendPre2026', s.tariffs.weekendPre2026),
      extraBed: num('extraBed', s.tariffs.extraBed),
      vipWithVilla: num('vipWithVilla', s.tariffs.vipWithVilla),
      vipOnly: num('vipOnly', s.tariffs.vipOnly)
    };
    s.capacity.idealPax = parseInt(fd.get('idealPax'), 10) || s.capacity.idealPax;
    s.capacity.maxPax = parseInt(fd.get('maxPax'), 10) || s.capacity.maxPax;
    s.dpPct = Math.min(100, Math.max(0, num('dpPct', (s.dpPct || 0) * 100))) / 100;
    s.paymentDeadline = (fd.get('paymentDeadline') || '').trim() || 'H-3';
    s.cancellationPolicy = (fd.get('cancellationPolicy') || '').trim();
    s.reschedulePolicy = (fd.get('reschedulePolicy') || '').trim();
    s.weekendNights = fd.getAll('weekend').map(function (v) { return parseInt(v, 10); }).filter(function (v) { return !isNaN(v); });
    /* Periode peak dari baris DOM. */
    var peaks = [];
    var rows = form.querySelectorAll('.peak-row');
    var peakError = '';
    rows.forEach(function (row) {
      var name = (row.querySelector('.pk-name').value || '').trim();
      var start = row.querySelector('.pk-start').value;
      var end = row.querySelector('.pk-end').value;
      var rate = parseFloat(row.querySelector('.pk-rate').value);
      var minN = parseInt(row.querySelector('.pk-min').value, 10);
      if (!name && !start && !end && isNaN(rate)) { return; } /* baris kosong diabaikan */
      if (!name || !L.isISODate(start) || !L.isISODate(end) || isNaN(rate) || rate < 0) {
        peakError = 'Periode peak tidak lengkap: nama, tanggal mulai/selesai, dan tarif wajib diisi dengan benar.';
        return;
      }
      if (end < start) { peakError = 'Periode peak "' + name + '": tanggal selesai harus setelah tanggal mulai.'; return; }
      peaks.push({ name: name, start: start, end: end, rate: rate, minNights: isNaN(minN) || minN < 1 ? 1 : minN });
    });
    if (peakError) { setSaveStatus(peakError, 'error'); return false; }
    s.peak = peaks;
    /* Harga katering. */
    (s.catering || []).forEach(function (c, i) {
      c.price1x = num('cat-' + i + '-1x', c.price1x);
      c.price2x = num('cat-' + i + '-2x', c.price2x);
      c.priceFull = num('cat-' + i + '-full', c.priceFull);
    });
    setSaveStatus('Menyimpan…', '');
    commit().then(function (res) {
      if (res.ok || res.demo) {
        setSaveStatus('Tersimpan ✓', 'ok');
        toast('Pengaturan tersimpan.');
        renderView();
      } else {
        setSaveStatus('Tersimpan di perangkat ini, belum tersinkron: ' + res.error, 'warn');
        renderView();
      }
    });
    return false;
  }

  /* ---------------- Ekspor / impor ---------------- */

  function csvEscape(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCSV(module) {
    var rows = [];
    var filename = '';
    if (module === 'reservasi') {
      filename = 'reservasi-villa-taman-kelinci.csv';
      rows.push(['Booking ID', 'Tanggal Booking', 'Check-in', 'Check-out', 'Malam', 'Nama Tamu', 'WA', 'Tamu', 'Kamar VIP', 'Extra Bed', 'Sumber', 'Status', 'Tarif/Malam', 'Biaya Tambahan', 'Diskon', 'Total', 'Terbayar', 'Sisa', 'Status Bayar', 'Lead ID']);
      reservationsSorted().forEach(function (r) {
        var c = L.reservationCalc(r, state.data.transactions, state.data.settings);
        rows.push([r.id, r.bookingDate, r.checkin, r.checkout, c.nights, r.guestName, r.wa, r.pax, r.vipRooms, r.extraBeds, r.source, r.status, r.ratePerNight, r.extraCost, r.discount, c.total, c.paid, c.remaining, c.payStatus, r.leadId]);
      });
    } else if (module === 'keuangan') {
      filename = 'keuangan-villa-taman-kelinci.csv';
      rows.push(['ID Transaksi', 'Tanggal', 'Jenis', 'Kategori', 'Booking ID', 'Deskripsi', 'Metode', 'Jumlah', 'Bulan', 'PIC', 'Status Verifikasi', 'Bukti / Referensi', 'Catatan']);
      transactionsSorted().forEach(function (tx) {
        rows.push([tx.id, tx.date, tx.type, tx.category, tx.bookingId, tx.description, tx.method, tx.amount, tx.month, tx.pic, tx.verifyStatus, tx.proof, tx.note]);
      });
    } else if (module === 'leads') {
      filename = 'leads-villa-taman-kelinci.csv';
      rows.push(['Lead ID', 'Tanggal Masuk', 'Nama', 'WA', 'Rencana Check-in', 'Rencana Check-out', 'Tamu', 'Sumber', 'Status', 'Nilai Penawaran', 'Follow-up Berikutnya', 'Alasan Kalah', 'Booking ID', 'PIC', 'Catatan']);
      leadsSorted().forEach(function (l) {
        rows.push([l.id, l.dateIn, l.name, l.wa, l.planCheckin, l.planCheckout, l.pax, l.source, l.status, l.offerValue, l.nextFollowup, l.lostReason, l.bookingId, l.pic, l.note]);
      });
    }
    var csv = '\uFEFF' + rows.map(function (row) { return row.map(csvEscape).join(';'); }).join('\r\n');
    downloadText(filename, csv, 'text/csv;charset=utf-8');
    toast('CSV ' + module + ' diunduh.');
  }

  function exportJSON() {
    var name = 'data-villa-taman-kelinci-' + L.todayISO() + '.json';
    downloadText(name, JSON.stringify(state.data, null, 2));
    toast('Backup data.json diunduh.');
  }

  function importJSON(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) { return; }
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (e) {
        toast('File bukan JSON yang valid: ' + e.message, 'error');
        return;
      }
      var errs = L.validateData(parsed);
      if (errs.length) {
        toast('File tidak valid untuk sistem ini: ' + errs.join(' '), 'error');
        return;
      }
      var counts = 'Reservasi: ' + parsed.reservations.length + ', Keuangan: ' + parsed.transactions.length + ', Leads: ' + parsed.leads.length + '.';
      if (!confirmDialog('Impor akan MENIMPA seluruh data saat ini dengan isi file ini.\n\n' + counts + '\n\nLanjutkan?')) { return; }
      state.data = parsed;
      state.conflict = null;
      renderView();
      commit().then(function (res) {
        if (res.ok || res.demo) { toast('Impor berhasil.'); }
        else { toast('Impor tersimpan lokal, belum tersinkron: ' + res.error, 'warn'); }
      });
    };
    reader.readAsText(file);
  }

  function resetSeed() {
    if (!confirmDialog('Reset akan menghapus SEMUA data transaksi (reservasi, keuangan, leads, dll) dan kembali ke data master saja. Lanjutkan?')) { return; }
    if (!confirmDialog('Yakin? Tindakan ini tidak bisa dibatalkan kecuali dari backup data.json Anda.')) { return; }
    fetchSeed().then(function (seed) {
      state.data = seed;
      state.conflict = null;
      renderView();
      commit().then(function (res) {
        if (res.ok || res.demo) { toast('Data direset ke data master.'); }
        else { toast('Reset tersimpan lokal, belum tersinkron: ' + res.error, 'warn'); }
      });
    }).catch(function (e) {
      toast('Gagal memuat seed: ' + e.message, 'error');
    });
  }

  /* ---------------- Token & koneksi ---------------- */

  function saveToken(event) {
    event.preventDefault();
    var fd = new FormData(event.target);
    var token = (fd.get('token') || '').trim();
    if (!token) { toast('Token wajib diisi.', 'error'); return false; }
    persistConn({ owner: (fd.get('owner') || '').trim(), repo: (fd.get('repo') || '').trim(), branch: (fd.get('branch') || '').trim() || 'main' });
    lsSet(LS.pat, token);
    state.syncError = '';
    state.conflict = null;
    toast('Token tersimpan di browser ini. Memuat data…');
    boot();
    return false;
  }

  function saveConn(event) {
    event.preventDefault();
    var fd = new FormData(event.target);
    var token = (fd.get('token') || '').trim();
    persistConn({ owner: (fd.get('owner') || '').trim(), repo: (fd.get('repo') || '').trim(), branch: (fd.get('branch') || '').trim() || 'main' });
    if (token) { lsSet(LS.pat, token); }
    state.syncError = '';
    toast('Koneksi tersimpan.' + (token ? ' Token baru tersimpan di browser ini.' : ''));
    if (state.mode === 'offline' && getToken()) {
      state.mode = 'online';
      state.sha = null; /* repo/branch mungkin berubah — ambil ulang */
      syncFromRemote({ silent: false }).then(function () {
        if (state.pending > 0) { pushToRemote(); }
      });
    } else if (getToken()) {
      syncFromRemote({ silent: true });
    }
    renderShell();
    renderView();
    return false;
  }

  function testConn() {
    if (!getToken()) { toast('Token belum diatur.', 'error'); return; }
    toast('Menguji koneksi…');
    apiGet().then(function (res) {
      if (res.ok) {
        toast('Koneksi berhasil. data.json ditemukan (reservasi: ' + res.data.reservations.length +
          ', transaksi: ' + res.data.transactions.length + ', leads: ' + res.data.leads.length + ').');
      } else if (res.status === 404) {
        toast('Koneksi ke GitHub berhasil, tetapi data.json belum ada di repo (404). Data lokal akan dibuat sebagai file awal saat sinkronisasi pertama.', 'warn');
      } else {
        toast('Tes koneksi gagal: ' + res.error, 'error');
      }
    });
  }

  function clearToken() {
    if (!confirmDialog('Hapus token dari browser ini? Data yang sudah tersinkron tetap ada di repo. Aplikasi akan kembali ke layar setup.')) { return; }
    lsRemove(LS.pat);
    state.mode = 'setup';
    state.route = 'setup';
    state.conflict = null;
    renderShell();
    $('view').innerHTML = setupView();
    updateSyncUI();
  }

  function startDemo() {
    showLoading('Memuat mode demo…');
    fetchSeed().then(function (seed) {
      state.data = seed;
      state.sha = null;
      state.pending = 0;
      state.conflict = null;
      state.mode = 'demo';
      state.route = 'dashboard';
      window.location.hash = '#/dashboard';
      renderShell();
      renderView();
      toast('Mode demo aktif — perubahan tidak tersimpan.', 'warn');
    }).catch(function (e) {
      toast('Gagal memuat mode demo: ' + e.message, 'error');
      $('view').innerHTML = setupView();
    });
  }

  function openOffline() {
    var cached = loadCache();
    if (!cached) { toast('Tidak ada data tersimpan di perangkat ini.', 'error'); return; }
    state.data = cached;
    state.sha = lsGet(LS.sha) || null;
    state.pending = parseInt(lsGet(LS.pending) || '0', 10) || 0;
    state.mode = 'offline';
    state.route = 'dashboard';
    window.location.hash = '#/dashboard';
    renderShell();
    renderView();
  }

  /* ---------------- Resolusi konflik ---------------- */

  function resolveConflict(choice) {
    if (!state.conflict) { return; }
    if (choice === 'later') {
      state.conflict = null;
      renderBanner();
      updateSyncUI();
      toast('Konflik ditunda. Perubahan lokal tetap tersimpan di perangkat ini.');
      return;
    }
    if (choice === 'reload') {
      /* Cadangkan edit lokal sebelum menimpa, agar bisa dipulihkan via impor. */
      try {
        lsSet(LS.backup, JSON.stringify({ savedAt: new Date().toISOString(), data: state.data }));
      } catch (e) { /* abaikan */ }
      state.data = state.conflict.remoteData;
      state.sha = state.conflict.remoteSha;
      state.pending = 0;
      state.conflict = null;
      state.lastSync = new Date();
      state.form = null;
      saveCache();
      renderShell();
      renderView();
      toast('Data terbaru dimuat. Edit lokal Anda dicadangkan di perangkat ini (bisa dipulihkan lewat impor bila perlu).', 'warn');
      return;
    }
    if (choice === 'overwrite') {
      if (!confirmDialog('Timpa data di GitHub dengan versi dari perangkat ini? Perubahan yang dibuat dari tempat lain akan HILANG.')) { return; }
      var freshSha = state.conflict.remoteSha;
      state.syncing = true;
      updateSyncUI();
      apiPut(state.data, freshSha, 'Timpa data dari perangkat ini (resolusi konflik ' + L.fmtSyncTime(new Date()) + ')')
        .then(function (res) {
          state.syncing = false;
          if (res.ok) {
            state.sha = res.sha || freshSha;
            state.pending = 0;
            state.conflict = null;
            state.lastSync = new Date();
            saveCache();
            renderShell();
            renderView();
            toast('Data di GitHub ditimpa dengan versi perangkat ini.');
          } else {
            state.syncError = res.error;
            updateSyncUI();
            toast('Gagal menimpa: ' + res.error, 'error');
          }
        });
    }
  }

  function retrySync() {
    if (state.pending > 0) {
      pushToRemote().then(function (res) {
        toast(res.ok ? 'Tersinkron ✓' : 'Masih gagal: ' + (res.error || ''), res.ok ? '' : 'error');
      });
    } else {
      syncFromRemote({ silent: false }).then(function (ok) {
        if (ok) { toast('Tersinkron ✓'); }
      });
    }
  }

  /* ---------------- API global (dipakai handler inline) ---------------- */

  window.VTK = {
    go: go,
    route: route,
    setDashMonth: function (v) { if (v) { state.dashMonth = v; renderView(); } },
    setFilter: function (module, field, value) {
      state.filters[module][field] = value;
      renderView();
      /* Kembalikan fokus ke kolom pencarian setelah re-render. */
      if (field === 'q') {
        var input = document.querySelector('input[type="search"]');
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
      }
    },
    openResForm: function (id, prefill) {
      state.form = { module: 'res', id: id || null, prefill: prefill || null };
      renderView();
      window.scrollTo(0, 0);
    },
    openTxForm: function (id, prefill) {
      state.form = { module: 'tx', id: id || null, prefill: prefill || null };
      renderView();
      window.scrollTo(0, 0);
    },
    openLeadForm: function (id) {
      state.form = { module: 'lead', id: id || null, prefill: null };
      renderView();
      window.scrollTo(0, 0);
    },
    closeForm: function () { state.form = null; renderView(); },
    saveRes: saveRes,
    delRes: delRes,
    saveTx: saveTx,
    delTx: delTx,
    saveLead: saveLead,
    delLead: delLead,
    leadToRes: leadToRes,
    leadFormToggleLostReason: leadFormToggleLostReason,
    resFormRecalc: resFormRecalc,
    markRateTouched: function () { state.rateTouched = true; },
    applySuggestedRate: function (v) {
      var input = $('rf-rate');
      if (input) { input.value = v; }
      state.rateTouched = true;
      resFormRecalc();
    },
    calNav: function (dir) {
      var d = new Date(state.calYear, state.calMonth + dir, 1);
      state.calYear = d.getFullYear();
      state.calMonth = d.getMonth();
      renderView();
    },
    calToday: function () {
      var now = new Date();
      state.calYear = now.getFullYear();
      state.calMonth = now.getMonth();
      state.calSelected = L.todayISO();
      renderView();
    },
    calDayClick: function (iso) { state.calSelected = iso; renderView(); },
    /* Dari kalender mini dashboard: buka Kalender pada bulan & hari itu. */
    miniCalGo: function (iso) {
      var d = L.parseISO(iso);
      if (d) {
        state.calYear = d.getFullYear();
        state.calMonth = d.getMonth();
        state.calSelected = iso;
      }
      go('kalender');
    },
    addResForDay: function (iso) {
      state.pendingForm = {
        module: 'res',
        id: null,
        prefill: { checkin: iso, checkout: L.addDaysISO(iso, 1), status: 'Permintaan' }
      };
      go('reservasi');
    },
    saveSettings: saveSettings,
    addPeakRow: function () {
      var wrap = $('peak-rows');
      if (wrap) {
        var div = document.createElement('div');
        div.innerHTML = peakRowHTML(null, wrap.children.length);
        wrap.appendChild(div.firstChild);
      }
    },
    delPeakRow: function (btn) {
      var row = btn.closest('.peak-row');
      if (row) { row.remove(); }
    },
    saveToken: saveToken,
    saveConn: saveConn,
    testConn: testConn,
    clearToken: clearToken,
    startDemo: startDemo,
    openOffline: openOffline,
    retryBoot: boot,
    retrySync: retrySync,
    resolveConflict: resolveConflict,
    exportJSON: exportJSON,
    importJSON: importJSON,
    resetSeed: resetSeed,
    exportCSV: exportCSV,
    copyTemplate: function (idx) {
      var tpl = (state.data.waTemplates || [])[idx];
      if (!tpl) { return; }
      var done = function () { toast('Template ' + tpl.id + ' disalin.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tpl.text).then(done, function () { fallbackCopy(tpl.text, done); });
      } else {
        fallbackCopy(tpl.text, done);
      }
    }
  };

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { toast('Gagal menyalin. Salin manual dari teks template.', 'error'); }
    ta.remove();
  }

  /* ---------------- Init ---------------- */

  document.addEventListener('DOMContentLoaded', function () {
    /* Judul dinamis dari nama properti bila data sudah ada di cache. */
    var cached = loadCache();
    if (cached && cached.settings && cached.settings.propertyName) {
      document.title = 'Sistem ' + cached.settings.propertyName;
    }
    window.addEventListener('hashchange', route);
    window.addEventListener('online', function () {
      if (state.mode === 'online' && state.pending > 0) { pushToRemote(); }
      else if (state.mode === 'online') { syncFromRemote({ silent: true }); }
    });
    boot();
  });

})();
