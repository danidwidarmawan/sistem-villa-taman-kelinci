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
  var APP_VERSION = '1.9.0-header-penuh';

  var LS = {
    data: 'vtk_data',
    sha: 'vtk_sha',
    syncedAt: 'vtk_synced_at',
    pending: 'vtk_pending',
    pat: 'vtk_pat',
    conn: 'vtk_conn',
    backup: 'vtk_conflict_backup',
    navCollapsed: 'vtk_nav_collapsed'
  };

  var NAV = [
    { route: 'dashboard', label: 'Dashboard', icon: 'grid' },
    { route: 'reservasi', label: 'Reservasi', icon: 'key' },
    { route: 'keuangan', label: 'Keuangan', icon: 'banknote' },
    { route: 'rekening', label: 'Rekening', icon: 'bank' },
    { route: 'leads', label: 'Leads', icon: 'users' },
    { route: 'kalender', label: 'Kalender', icon: 'calendar' },
    { route: 'operasional', label: 'Operasional', icon: 'clipboard' },
    { route: 'pengaturan', label: 'Pengaturan', icon: 'sliders' }
  ];

  /* Kelompok navigasi sidebar desktop (v1.5.0): menu dikelompokkan agar
   * sidebar ringkas tanpa scroll. Entri tanpa `children` tampil langsung;
   * entri dengan `children` jadi grup lipat. Anak Operasional memakai
   * `tab` — klik langsung membuka sub-tab itu di halaman Operasional.
   * Navigasi mobile (bilah bawah) tetap memakai NAV yang datar. */
  var NAV_GROUPS = [
    { label: 'Dashboard', icon: 'grid', route: 'dashboard' },
    { label: 'Booking', icon: 'key', children: [
      { route: 'reservasi', label: 'Reservasi', icon: 'key' },
      { route: 'kalender', label: 'Kalender', icon: 'calendar' }
    ]},
    { label: 'Keuangan', icon: 'banknote', children: [
      { route: 'keuangan', label: 'Keuangan', icon: 'banknote' },
      { route: 'rekening', label: 'Rekening', icon: 'bank' }
    ]},
    { label: 'Leads', icon: 'users', route: 'leads' },
    { label: 'Operasional', icon: 'clipboard', children: [
      { route: 'operasional', label: 'Housekeeping', tab: 'housekeeping', icon: 'sparkles' },
      { route: 'operasional', label: 'Perawatan', tab: 'maintenance', icon: 'wrench' },
      { route: 'operasional', label: 'Inventaris', tab: 'inventory', icon: 'box' },
      { route: 'operasional', label: 'Pesanan Katering', tab: 'catering', icon: 'utensils' }
    ]},
    { label: 'Pengaturan', icon: 'sliders', children: [
      { route: 'pengaturan', label: 'Profil & Tarif', section: 'set-profil', icon: 'sliders' },
      { route: 'pengaturan', label: 'Periode Peak', section: 'set-peak', icon: 'calendar' },
      { route: 'pengaturan', label: 'Harga Katering', section: 'set-katering', icon: 'utensils' },
      { route: 'pengaturan', label: 'Target & Rekening', section: 'set-target', icon: 'target' },
      { route: 'pengaturan', label: 'Koneksi GitHub', section: 'set-koneksi', icon: 'key' },
      { route: 'pengaturan', label: 'Data', section: 'set-data', icon: 'box' },
      { route: 'pengaturan', label: 'Template WhatsApp', section: 'set-wa', icon: 'receipt' }
    ]}
  ];

  /* Ikon SVG inline (stroke, currentColor) — tanpa emoji, tanpa file gambar. */
  var ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M17 4l2 2"/><path d="M14 7l2 2"/>',
    banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>',
    bank: '<path d="M3 9l9-5 9 5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M2.5 21h19"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5a3.5 3.5 0 0 1 0 6.9"/><path d="M17.5 14.2a6.5 6.5 0 0 1 4 5.8"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>',
    percent: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6"/><path d="M9 9.5h.01M15 14.5h.01"/>',
    calendarCheck: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/><path d="M9 15l2 2 4-4"/>',
    receipt: '<path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z"/><path d="M9 8h6M9 12h6"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4a2 2 0 0 1 6 0"/><path d="M9 12l2 2 4-4"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    sparkles: '<path d="M12 3l1.7 4.8 4.8 1.7-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
    utensils: '<path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3z"/><path d="M21 15v7"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>'
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
      tx: { month: L.currentMonthKey(), type: '', category: '', status: '', account: '' },
      lead: { status: '', source: '', q: '' }
    },
    /* Sub-tab halaman Operasional: housekeeping | maintenance | inventory | catering */
    opsTab: 'housekeeping',
    /* Grup sidebar yang dibuka/tutup manual: { label: true/false }.
     * Tanpa pilihan manual, grup yang memuat rute aktif terbuka otomatis. */
    navOpen: {},
    /* Bagian Pengaturan yang dituju dari submenu sidebar (id elemen) —
     * dipakai untuk sorot aktif submenu; dikosongkan saat pindah rute. */
    settingsSection: null,
    /* Id elemen yang harus di-scroll setelah render berikutnya (dipakai
     * goSettingsSection; hashchange bisa terjadi asinkron). */
    pendingScroll: null,
    /* form aktif: { module: 'res'|'tx'|'lead'|'hk'|'mnt'|'inv'|'ck', id: string|null, prefill: object|null } */
    form: null,
    /* form yang dijadwalkan lintas-hash (mis. Leads -> Jadikan reservasi) */
    pendingForm: null,
    /* tarif reservasi sudah diubah manual (agar saran tidak menimpa) */
    rateTouched: false,
    /* biaya tambahan reservasi sudah diubah manual (agar isi otomatis tidak menimpa) */
    extraCostTouched: false,
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
      mergeDefaultTemplates();
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

  /* Anak navigasi cocok dengan rute aktif (abaikan section — dipakai untuk
   * membuka grup & menandai grup aktif). */
  function navChildRouteMatches(c) {
    var opsTab = state.opsTab || 'housekeeping';
    return state.route === c.route && (!c.tab || opsTab === c.tab);
  }

  /* Anak navigasi sedang aktif penuh (termasuk section Pengaturan). */
  function navChildActive(c) {
    return navChildRouteMatches(c) && (!c.section || state.settingsSection === c.section);
  }

  /* Apakah grup sidebar terbuka: pilihan manual menang; tanpa pilihan,
   * grup yang memuat rute (dan sub-tab) aktif terbuka otomatis. */
  function navGroupOpen(g) {
    if (state.navOpen[g.label] === true) { return true; }
    if (state.navOpen[g.label] === false) { return false; }
    return (g.children || []).some(navChildRouteMatches);
  }

  function renderNav() {
    /* Mobile (bilah bawah): tetap datar, 8 item. */
    var flat = NAV.map(function (n) {
      var active = state.route === n.route ? ' active' : '';
      return '<a href="#/' + n.route + '" class="nav-item' + active + '" data-route="' + n.route + '">' +
        '<span class="nav-ico" aria-hidden="true">' + icon(n.icon) + '</span>' +
        '<span class="nav-label">' + n.label + '</span></a>';
    }).join('');
    var m = $('nav-mobile');
    if (m) { m.innerHTML = flat; }

    /* Desktop (sidebar kiri): kelompok lipat agar ringkas. */
    var d = $('nav-desktop');
    if (!d) { return; }
    d.innerHTML = NAV_GROUPS.map(function (g) {
      if (!g.children) {
        var active = state.route === g.route ? ' active' : '';
        return '<a href="#/' + g.route + '" class="nav-item' + active + '" data-route="' + g.route + '">' +
          '<span class="nav-ico" aria-hidden="true">' + icon(g.icon) + '</span>' +
          '<span class="nav-label">' + g.label + '</span></a>';
      }
      var hasActive = g.children.some(navChildRouteMatches);
      var open = navGroupOpen(g);
      var items = g.children.map(function (c) {
        var cActive = navChildActive(c) ? ' active' : '';
        var click = c.tab ? ' onclick="VTK.goOpsTab(\'' + c.tab + '\'); return false;"'
          : c.section ? ' onclick="VTK.goSettingsSection(\'' + c.section + '\'); return false;"' : '';
        return '<a href="#/' + c.route + '" class="nav-item nav-sub' + cActive + '" data-route="' + c.route + '"' +
          (c.tab ? ' data-opstab="' + c.tab + '"' : '') +
          (c.section ? ' data-section="' + c.section + '"' : '') + click + '>' +
          '<span class="nav-ico" aria-hidden="true">' + icon(c.icon) + '</span>' +
          '<span class="nav-label">' + c.label + '</span></a>';
      }).join('');
      return '<div class="nav-group' + (open ? ' open' : '') + (hasActive ? ' has-active' : '') + '">' +
        '<button type="button" class="nav-group-head" aria-expanded="' + open + '" data-group="' + esc(g.label) + '" onclick="VTK.toggleNavGroup(\'' + g.label + '\')">' +
        '<span class="nav-ico" aria-hidden="true">' + icon(g.icon) + '</span>' +
        '<span class="nav-label">' + g.label + '</span>' +
        '<span class="nav-chev" aria-hidden="true">' + icon('chevron') + '</span></button>' +
        '<div class="nav-sublist">' + items + '</div></div>';
    }).join('');
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
    applyNavCollapsed();
    renderNav();
    renderBanner();
    updateSyncUI();
  }

  /* Sidebar minimize: ciutkan ke strip ikon (72px). Pilihan disimpan di
   * localStorage agar bertahan saat halaman dibuka lagi. */
  function setNavCollapsed(collapsed) {
    document.body.classList.toggle('nav-collapsed', collapsed);
    lsSet(LS.navCollapsed, collapsed ? '1' : '0');
    var btn = document.querySelector('.nav-collapse-btn');
    if (btn) { btn.setAttribute('aria-label', collapsed ? 'Bentangkan sidebar' : 'Ciutkan sidebar'); }
  }

  function applyNavCollapsed() {
    var collapsed = false;
    try { collapsed = window.localStorage.getItem(LS.navCollapsed) === '1'; } catch (e) { collapsed = false; }
    document.body.classList.toggle('nav-collapsed', collapsed);
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

    /* Navigasi ke rute di dalam grup membuka grup itu (menghapus pilihan
     * tutup manual untuk grup tersebut) — item aktif tidak boleh
     * tersembunyi di dalam grup yang tertutup. */
    NAV_GROUPS.forEach(function (g) {
      if (!g.children) { return; }
      if (g.children.some(navChildRouteMatches)) { delete state.navOpen[g.label]; }
    });
    /* Sorot section Pengaturan hanya berlaku selama di halaman Pengaturan. */
    if (state.route !== 'pengaturan') { state.settingsSection = null; }
    /* Hormati form yang dijadwalkan lintas-hash (mis. Leads -> Jadikan
     * reservasi, Kalender -> tambah reservasi); selain itu tutup form. */
    /* Lompat ke bagian (mis. submenu Pengaturan) harus bertahan:
     * tangkap sebelum renderView mengonsumsinya di afterRender, lalu
     * jangan scroll ke atas bila ada lompatan (bug v1.5.1: scrollTo
     * di akhir route() membatalkan scrollIntoView dari afterRender). */
    var jumpTo = state.pendingScroll;
    state.form = state.pendingForm || null;
    state.pendingForm = null;
    renderShell();
    renderView();
    if (!jumpTo) { window.scrollTo(0, 0); }
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

  /* Tambahkan template WA baru dari seed ke data yang sedang dimuat (mis.
   * WA-16 untuk Jumat terblokir) — hanya MENAMBAH yang ID-nya belum ada,
   * tidak pernah menimpa template yang sudah ada (lihat
   * L.mergeWaTemplates). Data live lama otomatis mendapat template baru
   * tanpa edit manual. Hasil merge disimpan ke cache lokal dan ikut
   * ter-push saat commit berikutnya; tidak ada push otomatis di sini.
   * Gagal memuat seed (offline) diabaikan diam-diam. Mengembalikan
   * Promise jumlah template yang ditambahkan. */
  function mergeDefaultTemplates() {
    if (!state.data || state.mode === 'demo') { return Promise.resolve(0); }
    return fetchSeed().then(function (seed) {
      var m = L.mergeWaTemplates(state.data.waTemplates, seed.waTemplates);
      if (m.added > 0) {
        state.data.waTemplates = m.list;
        saveCache();
        /* Jangan me-render ulang saat form sedang diisi. */
        if (!state.form) { renderView(); }
      }
      return m.added;
    }).catch(function () { return 0; });
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
      mergeDefaultTemplates();
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
        mergeDefaultTemplates();
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

  /* Koleksi Fase 2 belum ada di data.json lama — pastikan selalu berupa
   * array sebelum dipakai (hanya di memori; tersimpan permanen saat commit
   * berikutnya). */
  function ensureOpsCollections() {
    var d = state.data;
    if (!d) { return; }
    if (!Array.isArray(d.housekeepingDone)) { d.housekeepingDone = []; }
    if (!Array.isArray(d.housekeepingTasks)) { d.housekeepingTasks = []; }
    if (!Array.isArray(d.maintenanceLogs)) { d.maintenanceLogs = []; }
    if (!Array.isArray(d.inventoryItems)) { d.inventoryItems = []; }
    if (!Array.isArray(d.cateringOrders)) { d.cateringOrders = []; }
    if (!d.settings) { d.settings = {}; }
  }

  /* Label rekening dari settings (dengan default bila settings lama). */
  function accountLabel(key) {
    return L.accountLabel(state.data ? state.data.settings : null, key);
  }

  function accountOptions(selected) {
    return L.ACCOUNT_KEYS.map(function (k) {
      return '<option value="' + k + '"' + (k === selected ? ' selected' : '') + '>' +
        esc(accountLabel(k)) + '</option>';
    }).join('');
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
    ensureOpsCollections();
    switch (state.route) {
      case 'reservasi': v.innerHTML = state.form && state.form.module === 'res' ? reservationFormHTML() : reservationsViewHTML(); break;
      case 'keuangan': v.innerHTML = state.form && state.form.module === 'tx' ? transactionFormHTML() : financeViewHTML(); break;
      case 'rekening': v.innerHTML = state.form && state.form.module === 'tx' ? transactionFormHTML() : accountsViewHTML(); break;
      case 'leads': v.innerHTML = state.form && state.form.module === 'lead' ? leadFormHTML() : leadsViewHTML(); break;
      case 'kalender': v.innerHTML = calendarViewHTML(); break;
      case 'operasional': v.innerHTML = opsRouteHTML(); break;
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
    if (state.form && state.form.module === 'ck') { ckFormRecalc(); }
    /* Lompat ke bagian Pengaturan yang diminta submenu sidebar. */
    if (state.pendingScroll) {
      var el = document.getElementById(state.pendingScroll);
      state.pendingScroll = null;
      if (el && typeof el.scrollIntoView === 'function') { el.scrollIntoView(); }
    }
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
    /* Kartu KPI hero: ikon kecil + label + angka besar. extraCls memberi
     * aksen warna per kartu ('kpi-accent-teal' dst: chip ikon bertinta
     * lembut + nilai berwarna; kartu tetap putih). */
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
      '</section>' +
      '<div class="dash-layout"><div class="dash-main">';

    /* Layout: kolom utama + rel kanan (desktop 2:1; HP menumpuk, isi rel
     * turun ke bawah isi kolom utama). Semua komponen lama tetap ada —
     * hanya susunannya berubah; kartu Saldo rekening pindah ke tab Rekening. */

    /* 4 kartu KPI hero — tiap kartu aksen warna sendiri */
    html += '<section class="kpi-grid kpi-hero-grid">' +
      hero('Uang masuk', L.fmtRp(d.moneyIn), d.monthLabel + ' • terverifikasi', 'banknote', '', 'kpi-accent-teal') +
      hero('Okupansi', L.fmtPct(d.occupancyPct), d.monthLabel, 'percent', '', 'kpi-accent-blue') +
      hero('Booking check-in', L.fmtNum(d.bookingsCheckin), d.monthLabel, 'calendarCheck', '', 'kpi-accent-violet') +
      hero('Sisa tagihan', L.fmtRp(d.totalOutstanding), 'semua reservasi aktif', 'receipt', '', 'kpi-accent-amber') +
      '</section>';

    /* 4 KPI pendukung sebagai strip ringkas (tidak ada data yang dihilangkan) */
    html += '<section class="kpi-grid kpi-strip">' +
      kpi('Malam terisi', L.fmtNum(d.nightsOccupied) + ' malam', 'dari ' + d.daysInMonth + ' hari') +
      kpi('Leads masuk', L.fmtNum(d.leadsThisMonth), d.monthLabel) +
      kpi('Uang keluar (terverifikasi)', L.fmtRp(d.moneyOut), d.monthLabel) +
      kpi('Arus kas bersih', L.fmtRp(d.netCash), d.monthLabel) +
      '</section>';

    /* Arus kas — kartu besar selebar kolom utama. Grafik memakai 6 bulan
     * terakhir, berakhir di bulan yang dipilih. */
    var cf = L.monthlyCashflow(state.data.transactions, state.dashMonth, 6);
    html += '<section class="card chart-card"><h2>Arus kas 6 bulan terakhir</h2>' +
      '<p class="hint">Hanya transaksi Terverifikasi. Bulan terakhir: ' + esc(d.monthLabel) + '.</p>' +
      VTKCharts.cashflowChart(cf) + '</section>';

    /* Donut komposisi pemasukan + tren okupansi, berdampingan. */
    var comp = L.incomeComposition(state.data.transactions, state.dashMonth);
    var donutItems = comp.items.map(function (c) { return { label: c.category, value: c.total }; });
    var occ = L.monthlyOccupancy(state.data.reservations, state.dashMonth, 6);
    html += '<section class="two-col">' +
      '<div class="card chart-card donut-card"><h2>Komposisi pemasukan</h2>' +
      '<p class="hint">' + esc(d.monthLabel) + ' — hanya transaksi Terverifikasi.</p>' +
      VTKCharts.donutChart(donutItems, { total: comp.total, totalLabel: 'Pemasukan',
        ariaLabel: 'Grafik donut komposisi pemasukan per kategori.',
        emptyMsg: 'Belum ada pemasukan terverifikasi di bulan ini.' }) +
      '<div class="card-foot"><button type="button" class="btn btn-small btn-primary" onclick="VTK.go(\'keuangan\')">Lihat Keuangan</button></div>' +
      '</div>' +
      '<div class="card chart-card"><h2>Tren okupansi</h2>' +
      '<p class="hint">6 bulan terakhir, berakhir ' + esc(d.monthLabel) + '.</p>' +
      VTKCharts.occupancyChart(occ) + '</div></section>';

    /* Target bulan ini (kartu Saldo rekening sudah pindah ke tab Rekening). */
    html += targetCardHTML(d);

    /* Perlu tindakan (rel kanan) + kinerja sumber lead (kolom utama). */
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
    var actionsCardHTML = '<div class="card"><h2>Perlu tindakan ' +
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
      VTKCharts.hBarChart(srcItems, { color: 'multi', ariaLabel: 'Grafik batang nilai booking per sumber lead.',
        emptyMsg: 'Belum ada data — grafik muncul setelah ada reservasi.' }) +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Sumber</th><th>Leads</th><th>Menang</th><th>Konversi</th><th>Nilai booking</th></tr></thead>' +
      '<tbody>' + srcRows + '</tbody></table></div></div>';

    html += '</div>'; /* Tutup .dash-main */

    /* Rel kanan: kalender mini -> Perlu tindakan -> outlook 30 hari. */
    html += '<aside class="dash-rail">' +
      '<div class="card mini-cal-card"><div class="mini-cal-head">' +
      '<button type="button" class="btn btn-small btn-ghost mini-cal-nav" aria-label="Bulan sebelumnya" onclick="VTK.miniCalNav(-1)">‹</button>' +
      '<h2>' + esc(d.monthLabel) + '</h2>' +
      '<button type="button" class="btn btn-small btn-ghost mini-cal-nav" aria-label="Bulan berikutnya" onclick="VTK.miniCalNav(1)">›</button>' +
      '</div>' +
      miniCalHTML(state.dashMonth) +
      '<div class="card-foot"><button type="button" class="btn btn-small btn-primary" onclick="VTK.go(\'kalender\')">Lihat Kalender</button></div>' +
      '</div>' +
      actionsCardHTML +
      forwardOutlookCardHTML() +
      '</aside></div>'; /* Tutup .dash-rail + .dash-layout */

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

  /* Kartu "Target bulan ini" — target vs uang masuk terverifikasi bulan terpilih,
   * plus target okupansi bila diisi (settings.targetOccupancyPct). */
  function targetCardHTML(d) {
    var t = d.target;
    var occ = t.occ || { hasTarget: false };
    if (!t.hasTarget && !occ.hasTarget) {
      return '<div class="card"><h2>Target bulan ini</h2>' +
        '<p class="empty">Belum ada target. Isi target bulanan di Pengaturan (atau lengkapi ' +
        'biaya tetap agar target default = titik impas bisa dihitung).</p>' +
        '<div class="card-foot"><button type="button" class="btn btn-small btn-primary" onclick="VTK.go(\'pengaturan\')">Atur target</button></div></div>';
    }
    var html = '<div class="card"><h2>Target bulan ini</h2>';
    if (t.hasTarget) {
      var pct = Math.min(100, Math.max(0, t.pct));
      var diffText = t.reached
        ? 'Melebihi target <strong>' + L.fmtRp(t.diff) + '</strong>'
        : 'Kurang <strong>' + L.fmtRp(Math.abs(t.diff)) + '</strong> lagi';
      html += '<p>Realisasi <strong>' + L.fmtRp(t.actual) + '</strong> dari target <strong>' + L.fmtRp(t.target) + '</strong> ' +
        '(' + L.fmtPct(t.pct) + ')</p>' +
        '<div class="progress" role="progressbar" aria-valuenow="' + Math.round(t.pct) + '" aria-valuemin="0" aria-valuemax="100" aria-label="Progres target bulanan">' +
        '<div class="progress-fill' + (t.reached ? ' reached' : '') + '" style="width:' + pct.toFixed(1) + '%"></div></div>' +
        '<p class="hint">' + diffText + ' • ' + esc(d.monthLabel) + ' (uang masuk terverifikasi).' +
        (t.isDefault ? ' Target default = total biaya tetap; ubah di Pengaturan.' : '') + '</p>';
    }
    if (occ.hasTarget) {
      var opct = Math.min(100, Math.max(0, occ.pct));
      html += '<p>Okupansi <strong>' + L.fmtPct(occ.actual) + '</strong> dari target <strong>' + L.fmtPct(occ.target) + '</strong> ' +
        '(' + L.fmtPct(occ.pct) + ')</p>' +
        '<div class="progress" role="progressbar" aria-valuenow="' + Math.round(occ.pct) + '" aria-valuemin="0" aria-valuemax="100" aria-label="Progres target okupansi">' +
        '<div class="progress-fill' + (occ.reached ? ' reached' : '') + '" style="width:' + opct.toFixed(1) + '%"></div></div>' +
        '<p class="hint">' + (occ.reached ? 'Target okupansi tercapai.' : 'Kurang ' + L.fmtPct(occ.target - occ.actual) + ' lagi.') +
        ' • ' + esc(d.monthLabel) + ' (' + L.fmtNum(d.nightsOccupied) + ' dari ' + L.fmtNum(d.daysInMonth) + ' malam).</p>';
    }
    html += '<div class="card-foot"><button type="button" class="btn btn-small btn-primary" onclick="VTK.go(\'pengaturan\')">Ubah target</button></div>' +
      '</div>';
    return html;
  }

  /* Kartu "30 hari ke depan" — malam terisi/kosong, weekend belum terisi,
   * dan booking yang sudah masuk dalam jendela. */
  function forwardOutlookCardHTML() {
    var today = L.todayISO();
    var o = L.forwardOutlook(state.data.reservations, today, 30, state.data.settings);
    var weekendItems = o.emptyWeekendNights.length
      ? o.emptyWeekendNights.map(function (w) {
          return '<li>' + esc(w.label) + ' — <span class="muted">belum terisi</span></li>';
        }).join('')
      : '<li class="muted">Semua malam weekend dalam 30 hari ke depan sudah terisi.</li>';
    /* Malam weekend terblokir (besoknya ada booking early check-in) tampil
     * terpisah dari "belum terisi" — tidak bisa dijual, beserta alasannya. */
    var blockedItems = o.blockedWeekendNights.length
      ? o.blockedWeekendNights.map(function (w) {
          return '<li>' + esc(w.label) + ' — <span class="muted">terblokir: ' + esc(w.reason) + '</span></li>';
        }).join('')
      : '';
    var bookingItems = o.bookings.length
      ? o.bookings.map(function (b) {
          return '<li><a href="#/reservasi">' + esc(b.guestName) + '</a> — ' + L.fmtDate(b.checkin) +
            ' s.d. ' + L.fmtDate(b.checkout) + ' (' + b.nights + ' malam, ' + L.fmtNum(b.pax) + ' tamu) ' +
            resStatusBadge(b.status) + '</li>';
        }).join('')
      : '<li class="muted">Belum ada reservasi dalam 30 hari ke depan.</li>';
    return '<section class="card"><h2>30 hari ke depan</h2>' +
      '<p><strong>' + o.nightsOccupied + ' dari ' + o.days + ' malam terisi</strong> (' + L.fmtPct(o.occupancyPct) + ') • ' +
      '<strong>' + o.nightsBlocked + ' malam terblokir</strong> • ' +
      '<strong>' + o.nightsEmpty + ' malam kosong</strong> • ' + L.fmtDate(o.start) + ' s.d. ' + L.fmtDate(L.addDaysISO(o.end, -1)) + '</p>' +
      '<div class="two-col"><div><h3>Weekend belum terisi</h3><ul class="simple-list">' + weekendItems + '</ul>' +
      (blockedItems ? '<h3>Weekend terblokir</h3><ul class="simple-list">' + blockedItems + '</ul>' +
        '<p class="hint">Malam terblokir tidak bisa dijual: tamu keesokan paginya early check-in.</p>' : '') + '</div>' +
      '<div><h3>Booking dalam 30 hari</h3><ul class="simple-list">' + bookingItems + '</ul></div></div>' +
      '<div class="card-foot"><button type="button" class="btn btn-small btn-primary" onclick="VTK.go(\'kalender\')">Lihat Kalender</button></div></section>';
  }

  /* Kalender mini dashboard: grid ringkas bulan yang dipilih (Senin dulu).
   * Hari terisi ditandai tosca, hari ini dilingkari; klik hari membuka
   * halaman Kalender pada bulan & hari tersebut. */
  function miniCalHTML(monthKey) {
    var y = +String(monthKey).slice(0, 4);
    var m0 = +String(monthKey).slice(5, 7) - 1;
    var cells = L.calendarCells(state.data, y, m0, L.todayISO());
    var dows = ['S', 'S', 'R', 'K', 'J', 'S', 'M'];
    var occupied = 0;
    var blocked = 0;
    var h = '<div class="mini-cal" role="grid" aria-label="Kalender mini ' + esc(L.monthLabel(monthKey)) + '">';
    dows.forEach(function (dow) { h += '<div class="mini-cal-dow">' + dow + '</div>'; });
    cells.forEach(function (c) {
      var cls = 'mini-cal-cell';
      if (!c.inMonth) { cls += ' other'; }
      if (c.isToday) { cls += ' today'; }
      if (c.reservations.length) {
        cls += ' occupied';
        if (c.inMonth) { occupied++; }
      } else if (c.blocked) {
        cls += ' blocked';
        if (c.inMonth) { blocked++; }
      }
      var label = L.fmtDate(c.dateISO) + (c.reservations.length ? ' — terisi (' + c.reservations.length + ' reservasi)'
        : c.blocked ? ' — terblokir (' + c.blocked.reason + ')' : ' — kosong');
      h += '<button type="button" class="' + cls + '" title="' + esc(label) + '" aria-label="' + esc(label) +
        '" onclick="VTK.miniCalGo(\'' + c.dateISO + '\')">' + c.day + '</button>';
    });
    h += '</div>';
    /* Legenda warna (sama gayanya dengan kalender utama) — menggantikan
     * keterangan kalimat "Hari tosca = terisi..." (permintaan pemilik
     * v1.5.2). Swatch memakai warna sel kalender mini yang sebenarnya. */
    h += '<p class="hint legend"><span class="sw mini-occupied"></span> Terisi &nbsp; ' +
      '<span class="sw mini-blocked"></span> Terblokir &nbsp; <span class="sw today"></span> Hari ini</p>';
    if (!occupied && !blocked) { h += '<p class="hint">Belum ada reservasi di bulan ini.</p>'; }
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
      var bd = L.extraCostBreakdown(r, state.data.settings);
      return '<tr class="clickable" onclick="VTK.openResForm(\'' + esc(r.id) + '\')">' +
        '<td data-label="Booking ID">' + esc(r.id) + '</td>' +
        '<td data-label="Tamu">' + esc(r.guestName) + '</td>' +
        '<td data-label="Check-in">' + L.fmtDate(r.checkin) + '</td>' +
        '<td data-label="Check-out">' + L.fmtDate(r.checkout) + '</td>' +
        '<td data-label="Malam">' + c.nights + '</td>' +
        '<td data-label="Tamu (pax)">' + L.fmtNum(r.pax) + '</td>' +
        '<td data-label="Total">' + L.fmtRp(c.total) +
        (bd.extraBedCost > 0 ? '<br /><span class="muted">extra bed ' + L.fmtRp(bd.extraBedCost) + '</span>' : '') + '</td>' +
        '<td data-label="Terbayar">' + L.fmtRp(c.paid) + '</td>' +
        '<td data-label="Sisa">' + L.fmtRp(c.remaining) + '</td>' +
        '<td data-label="Status Bayar">' + payBadge(c.payStatus) + '</td>' +
        '<td data-label="Status">' + resStatusBadge(r.status) + '</td></tr>';
    }).join('');

    return '<section class="page-head"><h1>Reservasi</h1>' +
      '<div class="page-head-actions"><a class="btn" href="form-tamu.html" target="_blank" rel="noopener">Form tamu (link untuk tamu)</a>' +
      '<button type="button" class="btn btn-primary" onclick="VTK.openResForm()">+ Tambah reservasi</button></div></section>' +
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

  /* Opsi paket katering di form reservasi, dari settings.catering. */
  function cateringPackageOptions(selected) {
    var opts = '<option value="">Tanpa katering</option>';
    (state.data.settings.catering || []).forEach(function (c) {
      opts += '<option value="' + esc(c.package) + '"' + (c.package === selected ? ' selected' : '') + '>' +
        esc(c.package) + ' — ' + L.fmtRp(+c.priceFull || 0) + '/pax</option>';
    });
    return opts;
  }

  function cateringMealsOptions(selected) {
    var list = [['Full', 'Full (3x)'], ['2x', '2x (75%)'], ['1x', '1x (40%)']];
    return list.map(function (m) {
      return '<option value="' + m[0] + '"' + (m[0] === selected ? ' selected' : '') + '>' + m[1] + '</option>';
    }).join('');
  }

  function reservationFormHTML() {
    var f = state.form;
    var isNew = !f.id;
    var r = f.id ? reservationById(f.id) : null;
    var p = f.prefill || {};
    var v = r || {
      bookingDate: L.todayISO(), checkin: p.checkin || '', checkout: p.checkout || '',
      guestName: p.guestName || '', wa: p.wa || '', pax: p.pax || '',
      groupName: p.groupName || '', adults: '', children: '',
      cateringPackage: '', cateringMeals: 'Full', cateringPax: '',
      vipRooms: 0, extraBeds: 0, source: p.source || 'WhatsApp',
      status: p.status || 'Permintaan', ratePerNight: '', extraCost: 0, discount: 0,
      leadId: p.leadId || '', specialRequest: '', internalNote: '',
      promoEarlyCheckin: 'Tidak', agreedCheckinTime: '', h1Confirmation: '',
      h1EmptyVerified: 'Belum', promoHelped: 'Tidak Ditanya', promoDirectCost: 0
    };
    state.rateTouched = !!r; /* saat edit, saran tidak menimpa tarif tersimpan */
    state.extraCostTouched = !!r; /* saat edit, isi otomatis tidak menimpa biaya tersimpan */
    state.paxTouched = !!r; /* saat edit, Dewasa/Anak tidak menimpa total tersimpan */
    /* Form dirender ulang (DOM baru) — kunci konfirmasi bentrok direset agar
     * checkbox konfirmasi dirender lagi saat bentrok muncul. */
    state._overlapConfirmKey = state._turnoverConfirmKey = null;
    var title = isNew ? 'Reservasi baru' : 'Ubah reservasi ' + esc(r.id);
    var existingCalc = r ? L.reservationCalc(r, state.data.transactions, state.data.settings) : null;
    var existingBd = r ? L.extraCostBreakdown(r, state.data.settings) : null;

    return '<section class="page-head"><h1>' + title + '</h1>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">← Kembali ke daftar</button></section>' +
      '<form class="card form-card" id="res-form" onsubmit="return VTK.saveRes(event)" oninput="VTK.resFormRecalc()">' +
      '<input type="hidden" name="id" value="' + (r ? esc(r.id) : '') + '" />' +
      '<h3 class="sec"><span class="sec-num">1</span>Data Tamu</h3>' +
      '<div class="form-row">' +
      '<label class="field field-grow"><span>Nama tamu *</span><input type="text" name="guestName" value="' + esc(v.guestName) + '" required /></label>' +
      '<label class="field"><span>Nomor WhatsApp</span><input type="tel" name="wa" value="' + esc(v.wa) + '" placeholder="08…" /></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field field-grow"><span>Nama grup / acara <span class="baru">BARU</span></span><input type="text" name="groupName" value="' + esc(v.groupName) + '" placeholder="cth: Cilskid Taekwondo, Keluarga Besar H. Sabani" /><span class="hint">Bila tamu datang sebagai rombongan/komunitas — nama kontak tetap di kolom Nama tamu.</span></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>Dewasa <span class="baru">BARU</span></span><input type="number" name="adults" min="0" step="1" value="' + esc(v.adults) + '" /><span class="hint">Opsional — bila rincian tidak diketahui, kosongkan saja.</span></label>' +
      '<label class="field"><span>Anak-anak <span class="baru">BARU</span></span><input type="number" name="children" min="0" step="1" value="' + esc(v.children) + '" /><span class="hint">Opsional.</span></label>' +
      '<label class="field"><span>Jumlah tamu (pax) *</span><input type="number" name="pax" id="rf-pax" min="1" step="1" value="' + esc(v.pax) + '" required oninput="VTK.markPaxTouched()" /><span class="hint">Diisi manual. Bila Dewasa/Anak diisi, total terisi otomatis — tapi tetap bisa diubah.</span></label>' +
      '</div>' +
      '<h3 class="sec"><span class="sec-num">2</span>Jadwal Menginap</h3>' +
      '<div class="form-row">' +
      '<label class="field"><span>Tanggal booking *</span><input type="date" name="bookingDate" value="' + esc(v.bookingDate) + '" required /></label>' +
      '<label class="field"><span>Check-in *</span><input type="date" name="checkin" value="' + esc(v.checkin) + '" required /></label>' +
      '<label class="field"><span>Check-out *</span><input type="date" name="checkout" value="' + esc(v.checkout) + '" required /></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>Jam check-in disepakati</span><input type="time" name="agreedCheckinTime" value="' + esc(v.agreedCheckinTime) + '" /><span class="hint">Standar 14.00. Di bawah itu = early check-in.</span></label>' +
      '<label class="field"><span>Promo early check-in</span><select name="promoEarlyCheckin">' + optList(['Ya', 'Tidak'], v.promoEarlyCheckin) + '</select></label>' +
      '<label class="field"><span>Konfirmasi H-1</span><input type="datetime-local" name="h1Confirmation" value="' + esc(v.h1Confirmation) + '" /><span class="hint">Kapan early check-in dikonfirmasi final ke tamu.</span></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>H-1: villa kosong terverifikasi</span><select name="h1EmptyVerified">' + optList(['Belum', 'Terverifikasi'], v.h1EmptyVerified) + '</select></label>' +
      '<label class="field"><span>Promo membantu booking?</span><select name="promoHelped">' + optList(['Ya', 'Tidak', 'Tidak Ditanya'], v.promoHelped) + '</select></label>' +
      '<label class="field"><span>Biaya langsung promo (Rp)</span><input type="number" name="promoDirectCost" min="0" step="1000" value="' + esc(v.promoDirectCost) + '" /></label>' +
      '</div>' +
      '<div id="res-warnings"></div>' +
      '<h3 class="sec"><span class="sec-num">3</span>Kamar &amp; Tambahan</h3>' +
      '<div class="form-row">' +
      '<label class="field"><span>Extra bed dipakai</span><input type="number" name="extraBeds" min="0" step="1" value="' + esc(v.extraBeds) + '" /><span class="hint">Rp 50.000 per bed per menginap (sekali bayar).</span></label>' +
      '<label class="field"><span>Kamar VIP dipakai (0–4)</span><input type="number" name="vipRooms" min="0" max="4" step="1" value="' + esc(v.vipRooms) + '" /><span class="hint">Rp 850.000 per kamar per malam.</span></label>' +
      '<label class="field"><span>Biaya tambahan (Rp)</span>' +
      '<input type="number" name="extraCost" id="rf-extra-cost" min="0" step="1000" value="' + esc(v.extraCost) + '" oninput="VTK.markExtraCostTouched()" />' +
      '<span class="hint" id="rf-extra-hint"></span></label>' +
      '<label class="field"><span>Diskon (Rp)</span><input type="number" name="discount" min="0" step="1000" value="' + esc(v.discount) + '" /></label>' +
      '</div>' +
      '<h3 class="sec"><span class="sec-num">4</span>Katering <span class="baru">BARU</span></h3>' +
      '<div class="form-row">' +
      '<label class="field"><span>Paket katering</span><select name="cateringPackage">' + cateringPackageOptions(v.cateringPackage) + '</select></label>' +
      '<label class="field"><span>Jumlah makan</span><select name="cateringMeals">' + cateringMealsOptions(v.cateringMeals) + '</select></label>' +
      '<label class="field"><span>Pax katering</span><input type="number" name="cateringPax" min="0" step="1" value="' + esc(v.cateringPax) + '" placeholder="= total tamu bila dikosongkan" /></label>' +
      '</div>' +
      '<div class="calc-box" id="res-kat-calc"></div>' +
      '<p class="hint">Bila paket dipilih, pesanan katering otomatis dibuat/diperbarui di modul Operasional saat reservasi disimpan.</p>' +
      '<h3 class="sec"><span class="sec-num">5</span>Pembayaran</h3>' +
      '<div class="form-row">' +
      '<label class="field"><span>Tarif / malam (Rp) *</span>' +
      '<input type="number" name="ratePerNight" id="rf-rate" min="0" step="1000" value="' + esc(v.ratePerNight) + '" required oninput="VTK.markRateTouched()" />' +
      '<span class="hint" id="rf-rate-hint"></span></label>' +
      '<label class="field"><span>Status reservasi</span><select name="status">' + optList(L.RES_STATUSES, v.status) + '</select></label>' +
      '<label class="field"><span>Sumber booking</span><select name="source">' + optList(L.LEAD_SOURCES, v.source) + '</select></label>' +
      '<label class="field"><span>Lead terkait</span><select name="leadId">' + leadOptions(v.leadId) + '</select></label>' +
      '</div>' +
      '<div class="calc-box" id="res-calc"></div>' +
      '<h3 class="sec"><span class="sec-num">6</span>Catatan</h3>' +
      '<div class="form-row">' +
      '<label class="field field-grow"><span>Permintaan khusus (dari tamu)</span><textarea name="specialRequest" rows="2" placeholder="cth: minta karaoke disiapkan, ada tamu lansia">' + esc(v.specialRequest) + '</textarea></label>' +
      '<label class="field field-grow"><span>Catatan internal (tidak terlihat tamu)</span><textarea name="internalNote" rows="2">' + esc(v.internalNote) + '</textarea></label>' +
      '</div>' +
      (existingCalc ? '<p class="hint">Terbayar saat ini (dari transaksi terverifikasi): <strong>' + L.fmtRp(existingCalc.paid) +
        '</strong> — sisa ' + L.fmtRp(existingCalc.remaining) + ' (' + esc(existingCalc.payStatus) + '). ' +
        'Untuk mencatat pembayaran, tambah transaksi di modul Keuangan dengan Booking ID ini.' +
        (existingBd && existingBd.extraBedCost > 0 ? ' Porsi extra bed <strong>' + L.fmtRp(existingBd.extraBedCost) +
          '</strong> dibayar ke ' + esc(accountLabel('katering')) + ' — catat sebagai transaksi "Pendapatan Extra Bed" terpisah.' : '') + '</p>' : '') +
      '<div id="res-overlap-confirm"></div>' +
      '<div id="res-turnover-confirm"></div>' +
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
    /* Field opsional (Dewasa/Anak/Pax katering): kosong tetap kosong, bukan 0. */
    var intOrEmpty = function (k) { var n = parseInt(fd.get(k), 10); return isNaN(n) ? '' : n; };
    return {
      id: fd.get('id') || '',
      bookingDate: fd.get('bookingDate') || '',
      checkin: fd.get('checkin') || '',
      checkout: fd.get('checkout') || '',
      guestName: (fd.get('guestName') || '').trim(),
      wa: (fd.get('wa') || '').trim(),
      groupName: (fd.get('groupName') || '').trim(),
      adults: intOrEmpty('adults'),
      children: intOrEmpty('children'),
      pax: parseInt(fd.get('pax'), 10) || 0,
      vipRooms: parseInt(fd.get('vipRooms'), 10) || 0,
      extraBeds: parseInt(fd.get('extraBeds'), 10) || 0,
      cateringPackage: fd.get('cateringPackage') || '',
      cateringMeals: fd.get('cateringMeals') || 'Full',
      cateringPax: intOrEmpty('cateringPax'),
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
    /* Total tamu: isi otomatis dari Dewasa + Anak selama belum diubah manual
     * (pola yang sama seperti tarif & biaya tambahan). Dilakukan SEBELUM
     * readResForm agar hitungan di bawah memakai total terbaru. */
    if (!state.paxTouched) {
      var adEl = form.querySelector('[name="adults"]');
      var anEl = form.querySelector('[name="children"]');
      var pxEl = $('rf-pax');
      if (adEl && anEl && pxEl) {
        var ad = parseInt(adEl.value, 10), an = parseInt(anEl.value, 10);
        if (!isNaN(ad) || !isNaN(an)) { pxEl.value = (isNaN(ad) ? 0 : ad) + (isNaN(an) ? 0 : an); }
      }
    }
    var v = readResForm();
    var s = state.data.settings;
    var calcEl = $('res-calc');
    var warnEl = $('res-warnings');
    var hintEl = $('rf-rate-hint');
    var overlapEl = $('res-overlap-confirm');
    var turnoverEl = $('res-turnover-confirm');

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

    /* Rincian biaya tambahan: extra bed (PER MENGINAP, bukan per malam) +
     * kamar VIP (per malam). Isi otomatis hanya untuk reservasi baru &
     * biaya belum disentuh manual — seperti pola rateTouched. */
    var bd = L.extraCostBreakdown(v, s);
    var extraHintEl = $('rf-extra-hint');
    if (extraHintEl) {
      var bdParts = [];
      var t = s.tariffs || {};
      if (bd.extraBedCost > 0) {
        bdParts.push('Extra bed ' + L.fmtNum(v.extraBeds) + ' × ' + L.fmtRp(+t.extraBed || 0) + ' = ' + L.fmtRp(bd.extraBedCost) + ' (per menginap)');
      }
      if (bd.vipCost > 0) {
        bdParts.push('VIP ' + L.fmtNum(v.vipRooms) + ' kamar × ' + bd.nights + ' malam × ' + L.fmtRp(+t.vipWithVilla || 0) + ' = ' + L.fmtRp(bd.vipCost));
      }
      /* Rincian per baris (bukan satu kalimat): tiap komponen satu baris,
       * lalu totalnya ditebalkan. Label rekening di-escape karena hint kini
       * memakai innerHTML. */
      extraHintEl.innerHTML = bdParts.length
        ? bdParts.join('<br>') + '<br><strong>Total biaya tambahan: ' + L.fmtRp(bd.total) + '</strong>' +
          ' — diisi otomatis di bawah ini; bisa diubah bila ada biaya tambahan lain.' +
          (bd.extraBedCost > 0 ? '<br>Porsi extra bed dicatat terpisah sebagai Pendapatan Extra Bed (' + esc(accountLabel('katering')) + ').' : '')
        : 'Tidak ada extra bed / kamar VIP. Isi bila ada biaya tambahan lain.';
    }
    if (!v.id && !state.extraCostTouched && bd.total > 0) {
      var extraInput = $('rf-extra-cost');
      if (extraInput) { extraInput.value = bd.total; v.extraCost = bd.total; }
    }

    /* Katering: hitung dari paket + jumlah makan + pax (pax kosong = total
     * tamu). Ditagih terpisah — tidak masuk total booking & DP. */
    var katEl = $('res-kat-calc');
    var katCalc = null;
    if (v.cateringPackage) {
      var katPax = (v.cateringPax !== '' && v.cateringPax > 0) ? v.cateringPax : (v.pax || 0);
      katCalc = L.cateringOrderCalc(s, v.cateringPackage, v.cateringMeals || 'Full', katPax);
    }
    if (katEl) {
      if (katCalc && katCalc.total > 0) {
        var labor = L.cateringLaborEstimate(state.data.operationalCosts);
        var makanTxt = v.cateringMeals === '1x' ? '1x makan (40%)' : (v.cateringMeals === '2x' ? '2x makan (75%)' : 'Full (3x)');
        katEl.innerHTML =
          '<div><span>Paket</span><strong>' + esc(v.cateringPackage) + ' — ' + makanTxt + '</strong></div>' +
          '<div><span>Harga/pax</span><strong>' + L.fmtRp(katCalc.pricePerPax) + '</strong></div>' +
          '<div><span>' + L.fmtNum(katCalc.pax) + ' pax × ' + L.fmtRp(katCalc.pricePerPax) + '</span><strong>' + L.fmtRp(katCalc.total) + '</strong></div>' +
          '<div><span>Total katering</span><strong>' + L.fmtRp(katCalc.total) + '</strong></div>' +
          '<div><span>Perkiraan honor juru masak (Irma + Nyai)</span><strong>' + L.fmtRp(labor.total) + '</strong></div>' +
          '<p class="hint">Ditagih terpisah ke ' + esc(accountLabel('katering')) + ' — tidak masuk Total booking &amp; DP. Honor juru masak dibayar dari ' + esc(accountLabel('villa')) + '.</p>';
      } else {
        katEl.innerHTML = '<div><span>Katering</span><strong>Tidak ada</strong></div>';
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
    /* Bentrok turnover: check-in = hari check-out booking lain (atau sebaliknya).
     * KERAS bila pihak yang datang minta early check-in (tamu lama baru keluar
     * 12.00, tamu baru mau masuk 07.00); RINGAN bila tidak — housekeeping hanya
     * punya 12.00–14.00. Pola konfirmasi sama seperti bentrok tanggal. */
    var tc = L.turnoverConflict(state.data.reservations, v.checkin, v.checkout, v.id || null, L.wantsEarlyCheckin(v, s), s);
    if (tc.hard) {
      var hr = tc.hard.reservation;
      warnings.push('<div class="alert bad"><strong>Bentrok turnover!</strong> ' +
        (tc.hard.direction === 'checkin'
          ? 'Anda minta early check-in pada ' + L.fmtDate(v.checkin) + ', tetapi ' + esc(hr.guestName) + ' (' + esc(hr.id) + ') baru check-out siang hari itu (12.00) — villa belum bisa dimasuki pagi hari.'
          : esc(hr.guestName) + ' (' + esc(hr.id) + ') early check-in pada ' + L.fmtDate(v.checkout) + ', tetapi reservasi ini baru check-out siang hari itu (12.00).') +
        '</div>');
    }
    if (tc.soft) {
      var sr = tc.soft.reservation;
      warnings.push('<div class="alert warn"><strong>Turnover hari yang sama.</strong> ' +
        (tc.soft.direction === 'checkin'
          ? 'Check-in ' + L.fmtDate(v.checkin) + ' bertepatan dengan check-out ' + esc(sr.guestName) + ' (' + esc(sr.id) + ').'
          : 'Check-out ' + L.fmtDate(v.checkout) + ' bertepatan dengan check-in ' + esc(sr.guestName) + ' (' + esc(sr.id) + ').') +
        ' Housekeeping hanya punya waktu 12.00–14.00 untuk menyiapkan villa.</div>');
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
    /* Checkbox konfirmasi hanya dirender ulang bila bentroknya BERUBAH.
     * Alasan: form memakai oninput="resFormRecalc()" dan checkbox juga
     * memicu event input — tanpa penjaga ini, mengklik checkbox akan
     * membangun ulang container-nya dan centang langsung hilang (checkbox
     * jadi tidak pernah bisa dicentang). Bila bentrok berubah ke reservasi
     * lain, kunci berubah sehingga checkbox dirender ulang tanpa centang. */
    if (overlapEl) {
      var okKey = overlap ? overlap.id : '';
      if (state._overlapConfirmKey !== okKey) {
        state._overlapConfirmKey = okKey;
        overlapEl.innerHTML = overlap
          ? '<label class="field checkbox"><input type="checkbox" id="rf-overlap-ok" /> ' +
            '<span>Saya yakin, simpan meski bentrok dengan ' + esc(overlap.id) + '</span></label>'
          : '';
      }
    }
    if (turnoverEl) {
      var tcKey = tc.hard ? tc.hard.reservation.id : '';
      if (state._turnoverConfirmKey !== tcKey) {
        state._turnoverConfirmKey = tcKey;
        turnoverEl.innerHTML = tc.hard
          ? '<label class="field checkbox"><input type="checkbox" id="rf-turnover-ok" /> ' +
            '<span>Saya yakin, simpan meski bentrok turnover dengan ' + esc(tc.hard.reservation.id) + '</span></label>'
          : '';
      }
    }

    /* Ringkasan hitung */
    if (calcEl) {
      var c = L.reservationCalc(v, state.data.transactions, s);
      var paidNow = v.id ? L.paidForBooking(v.id, state.data.transactions) : 0;
      var remainingNow = Math.max(0, c.total - paidNow);
      calcEl.innerHTML =
        '<div><span>Malam</span><strong>' + c.nights + '</strong></div>' +
        '<div><span>Total booking</span><strong>' + L.fmtRp(c.total) + '</strong></div>' +
        (katCalc && katCalc.total > 0 ? '<div><span>Katering (dibayar terpisah)</span><strong>' + L.fmtRp(katCalc.total) + '</strong></div>' : '') +
        '<div><span>DP 50% (menginap saja)</span><strong>' + L.fmtRp(c.dpAmount) + '</strong></div>' +
        '<div><span>Jatuh tempo pelunasan (H-3)</span><strong>' + L.fmtDate(c.dueDate) + '</strong></div>' +
        (bd.extraBedCost > 0 ? '<div><span>Extra bed (per menginap)</span><strong>' + L.fmtRp(bd.extraBedCost) + '</strong></div>' : '') +
        (bd.vipCost > 0 ? '<div><span>Kamar VIP</span><strong>' + L.fmtRp(bd.vipCost) + '</strong></div>' : '') +
        (v.id ? '<div><span>Terbayar</span><strong>' + L.fmtRp(paidNow) + '</strong></div>' +
          '<div><span>Sisa tagihan</span><strong>' + L.fmtRp(remainingNow) + '</strong></div>' : '');
    }
  }

  /* Katering dari form reservasi -> pesanan di Operasional (otomatis, satu
   * pesanan per booking). Bila pesanan untuk booking ini sudah ada, paket/
   * makan/pax/harga diperbarui (status & catatan dipertahankan). Bila paket
   * dikosongkan, pesanan yang sudah ada TIDAK dihapus otomatis — hapus
   * manual di Operasional bila memang batal (pesanan mungkin sudah
   * disiapkan). */
  function upsertCateringOrder(v) {
    if (!v.cateringPackage) { return; }
    var pax = (v.cateringPax !== '' && v.cateringPax > 0) ? v.cateringPax : (v.pax || 0);
    if (pax < 1) { return; }
    var calc = L.cateringOrderCalc(state.data.settings, v.cateringPackage, v.cateringMeals || 'Full', pax);
    if (!calc || calc.total <= 0) { return; }
    var orders = state.data.cateringOrders || [];
    var existing = null;
    for (var i = 0; i < orders.length; i++) { if (orders[i].bookingId === v.id) { existing = orders[i]; break; } }
    if (existing) {
      existing.package = v.cateringPackage;
      existing.meals = v.cateringMeals || 'Full';
      existing.pax = calc.pax;
      existing.pricePerPax = calc.pricePerPax;
      existing.total = calc.total;
      touch(existing);
    } else {
      orders.push(touch({
        id: L.nextId('CK', orders, L.todayISO()),
        bookingId: v.id,
        package: v.cateringPackage,
        meals: v.cateringMeals || 'Full',
        pax: calc.pax,
        pricePerPax: calc.pricePerPax,
        total: calc.total,
        status: 'Dipesan',
        note: ''
      }));
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
    var tcSave = L.turnoverConflict(state.data.reservations, v.checkin, v.checkout, v.id || null, L.wantsEarlyCheckin(v, state.data.settings), state.data.settings);
    if (tcSave.hard) {
      var tcBox = $('rf-turnover-ok');
      if (!tcBox || !tcBox.checked) {
        errors.push('Bentrok turnover dengan ' + tcSave.hard.reservation.id + '. Centang konfirmasi bila tetap ingin menyimpan.');
      }
    }
    if (errors.length) { setSaveStatus(errors.join(' '), 'error'); return false; }

    /* Simpan komponen biaya tambahan (extra bed per menginap + VIP per malam)
     * agar porsi extra bed bisa dipisahkan ke rekening katering. Total tetap
     * memakai extraCost (rumus total tidak berubah). */
    var bdSave = L.extraCostBreakdown(v, state.data.settings);
    v.extraBedCost = bdSave.extraBedCost;
    v.vipCost = bdSave.vipCost;

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
    /* Katering ikut tersimpan sebagai pesanan di Operasional (satu commit). */
    upsertCateringOrder(v);
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
      if (f.account && L.accountOf(tx) !== f.account) { return false; }
      return true;
    });
    var sumIn = 0;
    var sumOut = 0;
    var perAcct = { villa: { masuk: 0, keluar: 0 }, katering: { masuk: 0, keluar: 0 } };
    list.forEach(function (tx) {
      var amt = +tx.amount || 0;
      var a = L.accountOf(tx);
      if (tx.type === 'Masuk') { sumIn += amt; perAcct[a].masuk += amt; }
      else { sumOut += amt; perAcct[a].keluar += amt; }
    });
    var rows = list.map(function (tx) {
      return '<tr class="clickable" onclick="VTK.openTxForm(\'' + esc(tx.id) + '\')">' +
        '<td data-label="ID">' + esc(tx.id) + '</td>' +
        '<td data-label="Tanggal">' + L.fmtDate(tx.date) + '</td>' +
        '<td data-label="Jenis">' + badge(tx.type, tx.type === 'Masuk' ? 'ok' : 'bad') + '</td>' +
        '<td data-label="Kategori">' + esc(tx.category) + '</td>' +
        '<td data-label="Rekening">' + esc(accountLabel(L.accountOf(tx))) + '</td>' +
        '<td data-label="Booking ID">' + esc(tx.bookingId || '—') + '</td>' +
        '<td data-label="Deskripsi">' + esc(tx.description) + '</td>' +
        '<td data-label="Metode">' + esc(tx.method) + '</td>' +
        '<td data-label="Jumlah">' + L.fmtRp(tx.amount) + '</td>' +
        '<td data-label="Status Verifikasi">' + verifyBadge(tx.verifyStatus) + '</td></tr>';
    }).join('');

    /* Subtotal per rekening (daftar yang sama dengan ringkasan di atas). */
    var acctSubRows = L.ACCOUNT_KEYS.map(function (k) {
      var x = perAcct[k];
      return '<tr><td data-label="Rekening">' + esc(accountLabel(k)) + '</td>' +
        '<td data-label="Masuk">' + L.fmtRp(x.masuk) + '</td>' +
        '<td data-label="Keluar">' + L.fmtRp(x.keluar) + '</td>' +
        '<td data-label="Bersih">' + L.fmtRp(x.masuk - x.keluar) + '</td></tr>';
    }).join('');
    var acctSub = '<section class="card"><h2>Subtotal per rekening</h2>' +
      '<p class="hint">Sesuai filter yang aktif (semua status verifikasi, seperti ringkasan di atas).</p>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Rekening</th><th>Masuk</th><th>Keluar</th><th>Bersih</th></tr></thead>' +
      '<tbody>' + acctSubRows + '</tbody></table></div></section>';

    /* Grafik per kategori (mengikuti SEMUA filter yang aktif, termasuk rekening;
     * hanya transaksi Terverifikasi — categoryTotals menyaringnya sendiri). */
    var catMonth = f.month || null;
    var catLabel = catMonth ? L.monthLabel(catMonth) : 'Semua bulan';
    if (f.account) { catLabel += ' • ' + accountLabel(f.account); }
    var inCats = L.categoryTotals(list, catMonth, 'Masuk');
    var outCats = L.categoryTotals(list, catMonth, 'Keluar');
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
      '<label class="field"><span>Rekening</span><select onchange="VTK.setFilter(\'tx\',\'account\',this.value)">' +
      '<option value="">Semua</option>' + accountOptions(f.account || '') + '</select></label>' +
      '<button type="button" class="btn btn-small" onclick="VTK.exportCSV(\'keuangan\')">Unduh CSV</button>' +
      '</section>' +
      catCharts +
      acctSub +
      '<section class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>ID</th><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Rekening</th><th>Booking ID</th><th>Deskripsi</th><th>Metode</th><th>Jumlah</th><th>Status Verifikasi</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="10" class="empty">Belum ada transaksi.</td></tr>') + '</tbody></table></div></section>';
  }

  /* ---------------- 2b. Rekening ----------------
   * Saldo per rekening pindah dari Dashboard ke tab sendiri (v1.3.0):
   * kartu per rekening (saldo + masuk/keluar semua waktu + ringkasan bulan
   * berjalan + jumlah transaksi) + transaksi terakhir per rekening.
   * Saldo memakai perhitungan yang sama persis dengan kartu Saldo lama:
   * L.accountBalances (hanya transaksi Terverifikasi). Klik baris transaksi
   * membuka form ubah transaksi; tombol "Lihat di Keuangan" membuka
   * Keuangan dengan filter rekening itu. */
  function accountsViewHTML() {
    var monthKey = L.currentMonthKey();
    var monthLabel = L.monthLabel(monthKey);
    var b = L.accountBalances(state.data.transactions);
    var txs = transactionsSorted();
    var html = '<section class="page-head"><h1>Rekening</h1></section>' +
      '<p class="hint">Saldo hanya menghitung transaksi Terverifikasi, semua waktu. ' +
      'Ringkasan bulanan memakai bulan berjalan (' + esc(monthLabel) + ').</p>' +
      '<section class="kpi-grid kpi-grid-3">' +
      '<div class="kpi card"><div class="kpi-label">Total saldo gabungan</div><div class="kpi-value">' + L.fmtRp(b.total.saldo) + '</div><div class="kpi-sub">semua rekening • terverifikasi</div></div>' +
      '<div class="kpi card"><div class="kpi-label">Total masuk</div><div class="kpi-value">' + L.fmtRp(b.total.masuk) + '</div><div class="kpi-sub">semua waktu • terverifikasi</div></div>' +
      '<div class="kpi card"><div class="kpi-label">Total keluar</div><div class="kpi-value">' + L.fmtRp(b.total.keluar) + '</div><div class="kpi-sub">semua waktu • terverifikasi</div></div>' +
      '</section>';
    L.ACCOUNT_KEYS.forEach(function (key) {
      var x = b[key];
      var sum = L.accountMonthSummary(state.data.transactions, key, monthKey);
      var all = txs.filter(function (tx) { return L.accountOf(tx) === key; });
      var recent = all.slice(0, 10);
      var rows = recent.length ? recent.map(function (tx) {
        var sign = tx.type === 'Masuk' ? '+' : '−';
        var amtCls = tx.type === 'Masuk' ? 'acct-in' : 'acct-out';
        return '<li class="acct-tx" onclick="VTK.openTxForm(\'' + esc(tx.id) + '\')">' +
          '<span class="acct-tx-date">' + L.fmtDate(tx.date) + '</span>' +
          '<span class="acct-tx-desc">' + esc(tx.description || tx.category) +
          ' <span class="muted">• ' + esc(tx.category) + '</span></span>' +
          '<strong class="nowrap ' + amtCls + '">' + sign + L.fmtRp(tx.amount) + '</strong> ' +
          verifyBadge(tx.verifyStatus) + '</li>';
      }).join('') : '<li class="muted">Belum ada transaksi di rekening ini.</li>';
      var saldoCls = x.saldo < 0 ? 'bad-text' : '';
      html += '<section class="card acct-card"><h2>' + esc(accountLabel(key)) + '</h2>' +
        '<div class="acct-big">Saldo <strong class="' + saldoCls + '">' + L.fmtRp(x.saldo) + '</strong></div>' +
        '<div class="acct-row"><div class="acct-name">Semua waktu</div>' +
        '<div class="acct-nums"><span>Masuk <strong>' + L.fmtRp(x.masuk) + '</strong></span>' +
        '<span>Keluar <strong>' + L.fmtRp(x.keluar) + '</strong></span>' +
        '<span>' + L.fmtNum(all.length) + ' transaksi</span></div></div>' +
        '<div class="acct-row"><div class="acct-name">' + esc(monthLabel) + '</div>' +
        '<div class="acct-nums"><span>Masuk <strong>' + L.fmtRp(sum.masuk) + '</strong></span>' +
        '<span>Keluar <strong>' + L.fmtRp(sum.keluar) + '</strong></span>' +
        '<span>Bersih <strong>' + L.fmtRp(sum.bersih) + '</strong></span></div></div>' +
        '<h3>Transaksi terakhir</h3>' +
        '<ul class="simple-list">' + rows + '</ul>' +
        '<div class="card-foot"><button type="button" class="btn btn-small btn-primary" data-acct-link="' + key +
        '" onclick="VTK.goFinanceAccount(\'' + key + '\')">Lihat di Keuangan</button></div>' +
        '</section>';
    });
    return html;
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
      account: p.account || L.suggestedAccount(p.category || 'Pembayaran Tamu'),
      bookingId: p.bookingId || '', description: p.description || '', method: 'Transfer Bank',
      amount: p.amount || '', pic: '', verifyStatus: 'Belum Dicek', proof: '', note: ''
    };
    var acctVal = tx ? L.accountOf(tx) : (v.account || 'villa');
    return '<section class="page-head"><h1>' + (tx ? 'Ubah transaksi ' + esc(tx.id) : 'Transaksi baru') + '</h1>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">← Kembali ke daftar</button></section>' +
      '<form class="card form-card" id="tx-form" onsubmit="return VTK.saveTx(event)">' +
      '<input type="hidden" name="id" value="' + (tx ? esc(tx.id) : '') + '" />' +
      '<div class="form-row">' +
      '<label class="field"><span>Tanggal *</span><input type="date" name="date" value="' + esc(v.date) + '" required /></label>' +
      '<label class="field"><span>Jenis *</span><select name="type">' + optList(L.TX_TYPES, v.type) + '</select></label>' +
      '<label class="field"><span>Kategori *</span><select name="category" id="tf-category" onchange="VTK.txFormSuggestAccount()">' + optList(L.TX_CATEGORIES, v.category) + '</select></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>Rekening *</span><select name="account" id="tf-account">' + accountOptions(acctVal) + '</select>' +
      '<span class="hint">Terisi otomatis dari kategori (katering &amp; extra bed → ' + esc(accountLabel('katering')) + '); bisa diubah.</span></label>' +
      '<label class="field"><span>Jumlah (Rp) *</span><input type="number" name="amount" min="0" step="1000" value="' + esc(v.amount) + '" required /></label>' +
      '<label class="field"><span>Metode</span><select name="method">' + optList(L.TX_METHODS, v.method) + '</select></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field field-grow"><span>Booking ID</span><select name="bookingId">' + bookingOptions(v.bookingId) + '</select>' +
      '<span class="hint">Wajib untuk kategori Pembayaran Tamu / Pembayaran Extra Bed / Refund Tamu (dipakai menghitung Terbayar).</span></label>' +
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

  /* Isi rekening otomatis dari kategori yang dipilih (saran — bisa diubah). */
  function txFormSuggestAccount() {
    var catEl = $('tf-category');
    var acctEl = $('tf-account');
    if (!catEl || !acctEl) { return; }
    acctEl.value = L.suggestedAccount(catEl.value);
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
    if ((category === 'Pembayaran Tamu' || category === 'Pembayaran Extra Bed' || category === 'Refund Tamu') && !bookingId) {
      errors.push('Booking ID wajib diisi untuk kategori ' + category + '.');
    }
    if (errors.length) { setSaveStatus(errors.join(' '), 'error'); return false; }

    setSaveStatus('Menyimpan…', '');
    var id = fd.get('id') || '';
    var acct = fd.get('account');
    if (acct !== 'villa' && acct !== 'katering') { acct = L.suggestedAccount(category); }
    var obj = {
      id: id,
      date: fd.get('date'),
      type: fd.get('type'),
      category: category,
      account: acct,
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
      pax: '', source: 'WhatsApp', status: 'Baru', offerValue: '',
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
      if (c.blocked) { cls += ' blocked'; }
      if (c.capacity === 'ideal') { cls += ' over-ideal'; }
      if (c.capacity === 'max') { cls += ' over-max'; }
      if (state.calSelected === c.dateISO) { cls += ' selected'; }
      var body = '<span class="cal-day">' + c.day + '</span>';
      if (c.peak) { body += '<span class="cal-tag peak-tag">' + esc(c.peak.name) + '</span>'; }
      if (c.blocked) { body += '<span class="cal-tag blocked-tag">Terblokir</span>'; }
      if (c.reservations.length === 1) {
        var r = c.reservations[0];
        body += '<span class="cal-guest">' + esc(r.guestName) + '</span><span class="cal-pax">' + L.fmtNum(c.pax) + ' tamu</span>';
      } else if (c.reservations.length > 1) {
        body += '<span class="cal-guest">' + c.reservations.length + ' reservasi</span><span class="cal-pax">' + L.fmtNum(c.pax) + ' tamu</span>';
      }
      if (c.capacity !== 'ok' && c.reservations.length) {
        body += '<span class="cal-tag cap-tag">' + (c.capacity === 'max' ? 'Melebihi maks' : 'Di atas ideal') + '</span>';
      }
      var title = c.blocked ? ' title="Terblokir: ' + esc(c.blocked.reason) + '"' : '';
      return '<button type="button" class="' + cls + '"' + title + ' onclick="VTK.calDayClick(\'' + c.dateISO + '\')">' + body + '</button>';
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
      }).join('') : (sel && sel.blocked
        ? '<li><strong>Malam terblokir (tidak bisa dijual):</strong> ' + esc(sel.blocked.reason) + '.</li>'
        : '<li class="muted">Villa kosong pada hari ini.</li>');
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
      '<p class="hint legend"><span class="sw occupied"></span> Terisi &nbsp; <span class="sw blocked"></span> Terblokir &nbsp; <span class="sw peak"></span> Peak &nbsp; ' +
      '<span class="sw weekend"></span> Weekend &nbsp; <span class="sw today"></span> Hari ini &nbsp; ' +
      '<span class="sw over-ideal"></span> Di atas kapasitas ideal &nbsp; <span class="sw over-max"></span> Melebihi maksimum</p></section>' +
      detail +
      '<section class="card"><h2>Reservasi bulan ini</h2><ul class="simple-list">' + monthList + '</ul></section>';
  }

  /* ---------------- 6. Operasional (Fase 2) ---------------- */

  function opsRouteHTML() {
    if (state.form) {
      if (state.form.module === 'hk') { return hkFormHTML(); }
      if (state.form.module === 'mnt') { return mntFormHTML(); }
      if (state.form.module === 'inv') { return invFormHTML(); }
      if (state.form.module === 'ck') { return ckFormHTML(); }
    }
    return opsViewHTML();
  }

  function mntStatusBadge(status) {
    var kind = { 'Dilaporkan': 'warn', 'Dikerjakan': 'info', 'Selesai': 'ok' }[status] || '';
    return badge(status, kind);
  }

  function invConditionBadge(cond) {
    var kind = { 'Baik': 'ok', 'Perlu Perbaikan': 'warn', 'Rusak': 'bad' }[cond] || '';
    return badge(cond, kind);
  }

  function ckStatusBadge(status) {
    var kind = { 'Dipesan': 'info', 'Disiapkan': 'warn', 'Selesai': 'ok', 'Dibatalkan': 'bad' }[status] || '';
    return badge(status, kind);
  }

  function opsViewHTML() {
    var tab = state.opsTab || 'housekeeping';
    var today = L.todayISO();
    var hkOpen = hkMergedTasks().filter(function (t) { return !t.done; }).length;
    var mntOpen = (state.data.maintenanceLogs || []).filter(function (m) { return m.status !== 'Selesai'; }).length;
    var invAttention = (state.data.inventoryItems || []).filter(function (it) { return it.condition && it.condition !== 'Baik'; }).length;
    var ckActive = (state.data.cateringOrders || []).filter(function (o) { return o.status === 'Dipesan' || o.status === 'Disiapkan'; }).length;
    var tabs = [
      { key: 'housekeeping', label: 'Housekeeping', count: hkOpen },
      { key: 'maintenance', label: 'Perawatan', count: mntOpen },
      { key: 'inventory', label: 'Inventaris', count: invAttention },
      { key: 'catering', label: 'Pesanan Katering', count: ckActive }
    ];
    var tabBar = '<div class="tabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" role="tab" aria-selected="' + (tab === t.key) + '" class="tab-btn' + (tab === t.key ? ' active' : '') + '" onclick="VTK.setOpsTab(\'' + t.key + '\')">' +
        esc(t.label) + (t.count ? ' <span class="count-badge">' + t.count + '</span>' : '') + '</button>';
    }).join('') + '</div>';
    var body = '';
    if (tab === 'maintenance') { body = mntListHTML(); }
    else if (tab === 'inventory') { body = invListHTML(); }
    else if (tab === 'catering') { body = ckListHTML(); }
    else { body = hkListHTML(); }
    return '<section class="page-head"><h1>Operasional</h1></section>' + tabBar + body;
  }

  /* ---- Housekeeping ---- */

  /* Gabungan tugas turunan (dari reservasi) + tugas manual, urut:
   * belum selesai dulu (tanggal terdekat dulu), selesai di belakang. */
  function hkMergedTasks() {
    var today = L.todayISO();
    var derived = L.derivedHousekeeping(state.data.reservations, state.data.housekeepingDone, today);
    var manual = (state.data.housekeepingTasks || []).map(function (t) {
      return { key: 'manual:' + t.id, kind: 'manual', id: t.id, title: t.title,
        date: t.date, detail: t.note || '', done: !!t.done };
    });
    var all = derived.concat(manual);
    all.sort(function (a, b) {
      if (a.done !== b.done) { return a.done ? 1 : -1; }
      if (a.date !== b.date) { return a.date < b.date ? -1 : 1; }
      return a.key < b.key ? -1 : 1;
    });
    return all;
  }

  function hkTaskById(id) {
    return (state.data.housekeepingTasks || []).find(function (t) { return t.id === id; }) || null;
  }

  function hkListHTML() {
    var today = L.todayISO();
    var tomorrow = L.addDaysISO(today, 1);
    var tasks = hkMergedTasks();
    var items = tasks.length ? tasks.map(function (t) {
      var overdue = !t.done && t.date < today;
      var isToday = t.date === today;
      var isTomorrow = t.date === tomorrow;
      var cls = 'hk-item' + (t.done ? ' done' : '') + (overdue ? ' overdue' : '');
      var when = overdue ? badge('Terlambat', 'bad') :
        isToday ? badge('Hari ini', 'info') :
        isTomorrow ? badge('Besok', 'muted') : '';
      var actions = t.kind === 'manual'
        ? '<button type="button" class="btn btn-small" onclick="VTK.openHkForm(\'' + esc(t.id) + '\')">Ubah</button> ' +
          '<button type="button" class="btn btn-small btn-danger" onclick="VTK.delHkTask(\'' + esc(t.id) + '\')">Hapus</button>'
        : '';
      return '<li class="' + cls + '">' +
        '<button type="button" class="hk-check" aria-label="' + (t.done ? 'Tandai belum selesai' : 'Tandai selesai') + '" ' +
        'onclick="VTK.hkToggle(\'' + esc(t.key) + '\')">' + (t.done ? '✓' : '') + '</button>' +
        '<div class="hk-body"><div class="hk-title">' + esc(t.title) + '</div>' +
        '<div class="hk-meta">' + L.fmtDate(t.date) + (t.detail ? ' • ' + esc(t.detail) : '') + ' ' + when + '</div></div>' +
        (actions ? '<div class="hk-actions">' + actions + '</div>' : '') +
        '</li>';
    }).join('') : '<li class="muted">Belum ada tugas housekeeping. Tugas "Siapkan villa" dan "Bersihkan villa" muncul otomatis dari reservasi.</li>';
    return '<section class="card"><div class="page-head"><h2>Housekeeping</h2>' +
      '<button type="button" class="btn btn-primary btn-small" onclick="VTK.openHkForm()">+ Tugas manual</button></div>' +
      '<p class="hint">Tugas "Siapkan villa" (H-1 check-in) dan "Bersihkan villa" (hari check-out) dibuat otomatis dari reservasi aktif. Ketuk kotak untuk menandai selesai.</p>' +
      '<ul class="hk-list">' + items + '</ul></section>';
  }

  function hkFormHTML() {
    var f = state.form;
    var t = f.id ? hkTaskById(f.id) : null;
    var v = t || { title: '', date: L.todayISO(), note: '', done: false };
    return '<section class="page-head"><h1>' + (t ? 'Ubah tugas ' + esc(t.id) : 'Tugas housekeeping baru') + '</h1>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">← Kembali ke Operasional</button></section>' +
      '<form class="card form-card" id="hk-form" onsubmit="return VTK.saveHkTask(event)">' +
      '<input type="hidden" name="id" value="' + (t ? esc(t.id) : '') + '" />' +
      '<div class="form-row">' +
      '<label class="field field-grow"><span>Judul tugas *</span><input type="text" name="title" value="' + esc(v.title) + '" required placeholder="cth: Cuci sprei kamar VIP" /></label>' +
      '<label class="field"><span>Tanggal *</span><input type="date" name="date" value="' + esc(v.date) + '" required /></label>' +
      '</div>' +
      '<label class="field"><span>Catatan</span><textarea name="note" rows="2">' + esc(v.note) + '</textarea></label>' +
      (t ? '<label class="field checkbox"><input type="checkbox" name="done"' + (v.done ? ' checked' : '') + ' /> <span>Sudah selesai</span></label>' : '') +
      saveStatusHTML() +
      '<div class="form-actions">' +
      '<button type="submit" class="btn btn-primary">Simpan tugas</button>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">Batal</button>' +
      (t ? '<button type="button" class="btn btn-danger" onclick="VTK.delHkTask(\'' + esc(t.id) + '\')">Hapus</button>' : '') +
      '</div></form>';
  }

  function saveHkTask(event) {
    event.preventDefault();
    var fd = new FormData($('hk-form'));
    var errors = [];
    if (!(fd.get('title') || '').trim()) { errors.push('Judul tugas wajib diisi.'); }
    if (!L.isISODate(fd.get('date'))) { errors.push('Tanggal wajib diisi.'); }
    if (errors.length) { setSaveStatus(errors.join(' '), 'error'); return false; }
    var id = fd.get('id') || '';
    var obj = {
      id: id,
      title: (fd.get('title') || '').trim(),
      date: fd.get('date'),
      note: (fd.get('note') || '').trim(),
      done: !!fd.get('done')
    };
    if (!id) {
      obj.id = L.nextId('OPS', state.data.housekeepingTasks, obj.date);
      state.data.housekeepingTasks.push(touch(obj));
    } else {
      var existing = hkTaskById(id);
      if (!existing) { setSaveStatus('Tugas tidak ditemukan.', 'error'); return false; }
      var createdAt = existing.createdAt;
      Object.assign(existing, obj);
      existing.createdAt = createdAt;
      touch(existing);
    }
    commit().then(function () {
      toast('Tugas housekeeping tersimpan.');
      state.form = null;
      renderView();
    });
    return false;
  }

  function delHkTask(id) {
    var t = hkTaskById(id);
    if (!t) { return; }
    if (!confirmDialog('Hapus tugas "' + t.title + '" (' + L.fmtDate(t.date) + ')?')) { return; }
    state.data.housekeepingTasks = state.data.housekeepingTasks.filter(function (x) { return x.id !== id; });
    commit().then(function () {
      toast('Tugas dihapus.');
      state.form = null;
      renderView();
    });
  }

  function hkToggle(key) {
    if (key.indexOf('manual:') === 0) {
      var t = hkTaskById(key.slice(7));
      if (!t) { return; }
      t.done = !t.done;
      touch(t);
    } else {
      var done = state.data.housekeepingDone;
      var idx = done.indexOf(key);
      if (idx === -1) { done.push(key); }
      else { done.splice(idx, 1); }
    }
    commit().then(function () { renderView(); });
    renderView();
  }

  /* ---- Perawatan (maintenance) ---- */

  function mntById(id) {
    return (state.data.maintenanceLogs || []).find(function (m) { return m.id === id; }) || null;
  }

  function mntSorted() {
    return (state.data.maintenanceLogs || []).slice().sort(function (a, b) {
      if (a.date !== b.date) { return a.date < b.date ? 1 : -1; }
      return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1;
    });
  }

  function mntListHTML() {
    var rows = mntSorted().map(function (m) {
      var expenseBtn = (!m.expensedTxId && (+m.cost || 0) > 0)
        ? '<button type="button" class="btn btn-small" onclick="event.stopPropagation();VTK.mntToExpense(\'' + esc(m.id) + '\')">Catat sebagai pengeluaran</button>'
        : (m.expensedTxId ? '<span class="badge ok">Sudah dicatat (' + esc(m.expensedTxId) + ')</span>' : '<span class="muted">—</span>');
      return '<tr class="clickable" onclick="VTK.openMntForm(\'' + esc(m.id) + '\')">' +
        '<td data-label="Tanggal">' + L.fmtDate(m.date) + '</td>' +
        '<td data-label="Item/Area">' + esc(m.item) + '</td>' +
        '<td data-label="Deskripsi">' + esc(m.description || '—') + '</td>' +
        '<td data-label="Biaya">' + L.fmtRp(m.cost) + '</td>' +
        '<td data-label="Status">' + mntStatusBadge(m.status) + '</td>' +
        '<td data-label="Pengeluaran">' + expenseBtn + '</td></tr>';
    }).join('');
    return '<section class="card"><div class="page-head"><h2>Perawatan</h2>' +
      '<button type="button" class="btn btn-primary btn-small" onclick="VTK.openMntForm()">+ Catat perawatan</button></div>' +
      '<p class="hint">Biaya perawatan bisa dicatat sebagai pengeluaran (rekening Villa, kategori Maintenance, status Belum Dicek) lewat tombol di tiap baris.</p>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Tanggal</th><th>Item/Area</th><th>Deskripsi</th><th>Biaya</th><th>Status</th><th>Pengeluaran</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="6" class="empty">Belum ada catatan perawatan.</td></tr>') + '</tbody></table></div></section>';
  }

  function mntFormHTML() {
    var f = state.form;
    var m = f.id ? mntById(f.id) : null;
    var v = m || { date: L.todayISO(), item: '', description: '', cost: '', status: 'Dilaporkan' };
    var expenseHint = '';
    if (m && !m.expensedTxId && (+m.cost || 0) > 0) {
      expenseHint = '<p class="hint">Setelah disimpan, biaya ini bisa dicatat sebagai pengeluaran dari daftar Perawatan.</p>';
    } else if (m && m.expensedTxId) {
      expenseHint = '<p class="hint">Sudah dicatat sebagai pengeluaran ' + esc(m.expensedTxId) + '.</p>';
    }
    return '<section class="page-head"><h1>' + (m ? 'Ubah catatan ' + esc(m.id) : 'Catatan perawatan baru') + '</h1>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">← Kembali ke Operasional</button></section>' +
      '<form class="card form-card" id="mnt-form" onsubmit="return VTK.saveMnt(event)">' +
      '<input type="hidden" name="id" value="' + (m ? esc(m.id) : '') + '" />' +
      '<div class="form-row">' +
      '<label class="field"><span>Tanggal *</span><input type="date" name="date" value="' + esc(v.date) + '" required /></label>' +
      '<label class="field field-grow"><span>Item / area *</span><input type="text" name="item" value="' + esc(v.item) + '" required placeholder="cth: Pompa kolam renang" /></label>' +
      '<label class="field"><span>Biaya (Rp)</span><input type="number" name="cost" min="0" step="1000" value="' + esc(v.cost) + '" /></label>' +
      '<label class="field"><span>Status</span><select name="status">' + optList(L.MNT_STATUSES, v.status) + '</select></label>' +
      '</div>' +
      '<label class="field"><span>Deskripsi</span><textarea name="description" rows="2">' + esc(v.description) + '</textarea></label>' +
      expenseHint +
      saveStatusHTML() +
      '<div class="form-actions">' +
      '<button type="submit" class="btn btn-primary">Simpan catatan</button>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">Batal</button>' +
      (m ? '<button type="button" class="btn btn-danger" onclick="VTK.delMnt(\'' + esc(m.id) + '\')">Hapus</button>' : '') +
      '</div></form>';
  }

  function readMntForm() {
    var fd = new FormData($('mnt-form'));
    return {
      id: fd.get('id') || '',
      date: fd.get('date') || '',
      item: (fd.get('item') || '').trim(),
      description: (fd.get('description') || '').trim(),
      cost: parseFloat(fd.get('cost')) || 0,
      status: fd.get('status') || 'Dilaporkan'
    };
  }

  function saveMnt(event) {
    event.preventDefault();
    var v = readMntForm();
    var errors = [];
    if (!L.isISODate(v.date)) { errors.push('Tanggal wajib diisi.'); }
    if (!v.item) { errors.push('Item/area wajib diisi.'); }
    if (v.cost < 0) { errors.push('Biaya tidak boleh negatif.'); }
    if (errors.length) { setSaveStatus(errors.join(' '), 'error'); return false; }
    if (!v.id) {
      v.id = L.nextId('MNT', state.data.maintenanceLogs, v.date);
      state.data.maintenanceLogs.push(touch(v));
    } else {
      var existing = mntById(v.id);
      if (!existing) { setSaveStatus('Catatan tidak ditemukan.', 'error'); return false; }
      var createdAt = existing.createdAt;
      var expensedTxId = existing.expensedTxId;
      Object.assign(existing, v);
      existing.createdAt = createdAt;
      if (expensedTxId) { existing.expensedTxId = expensedTxId; }
      touch(existing);
    }
    commit().then(function () {
      toast('Catatan perawatan tersimpan.');
      state.form = null;
      renderView();
    });
    return false;
  }

  function delMnt(id) {
    var m = mntById(id);
    if (!m) { return; }
    var msg = 'Hapus catatan perawatan ' + id + ' (' + m.item + ')?' +
      (m.expensedTxId ? '\n\nTransaksi pengeluaran ' + m.expensedTxId + ' yang sudah dicatat TIDAK ikut terhapus.' : '');
    if (!confirmDialog(msg)) { return; }
    state.data.maintenanceLogs = state.data.maintenanceLogs.filter(function (x) { return x.id !== id; });
    commit().then(function () {
      toast('Catatan perawatan dihapus.');
      state.form = null;
      renderView();
    });
  }

  /* Buat transaksi Keluar dari log perawatan (sekali saja; ditandai expensedTxId). */
  function mntToExpense(id) {
    var m = mntById(id);
    if (!m || m.expensedTxId) { return; }
    var cost = +m.cost || 0;
    if (cost <= 0) { toast('Biaya 0 — tidak ada pengeluaran untuk dicatat.', 'warn'); return; }
    var tx = {
      id: L.nextId('TRX', state.data.transactions, m.date),
      date: m.date,
      type: 'Keluar',
      category: 'Maintenance',
      account: 'villa',
      bookingId: '',
      description: 'Perawatan: ' + m.item + (m.description ? ' — ' + m.description : ''),
      method: 'Lainnya',
      amount: cost,
      month: (m.date || '').slice(0, 7),
      pic: '',
      verifyStatus: 'Belum Dicek',
      proof: '',
      note: 'Dari log perawatan ' + m.id
    };
    state.data.transactions.push(touch(tx));
    m.expensedTxId = tx.id;
    touch(m);
    commit().then(function () {
      toast('Pengeluaran ' + tx.id + ' (' + L.fmtRp(cost) + ') dicatat — status Belum Dicek.');
      renderView();
    });
  }

  /* ---- Inventaris ---- */

  function invById(id) {
    return (state.data.inventoryItems || []).find(function (it) { return it.id === id; }) || null;
  }

  function invSorted() {
    return (state.data.inventoryItems || []).slice().sort(function (a, b) {
      var condRank = { 'Rusak': 0, 'Perlu Perbaikan': 1, 'Baik': 2 };
      var ra = condRank[a.condition] === undefined ? 3 : condRank[a.condition];
      var rb = condRank[b.condition] === undefined ? 3 : condRank[b.condition];
      if (ra !== rb) { return ra - rb; }
      return (a.name || '') < (b.name || '') ? -1 : 1;
    });
  }

  function invListHTML() {
    var rows = invSorted().map(function (it) {
      return '<tr class="clickable" onclick="VTK.openInvForm(\'' + esc(it.id) + '\')">' +
        '<td data-label="Nama barang">' + esc(it.name) + '</td>' +
        '<td data-label="Kategori">' + esc(it.category || '—') + '</td>' +
        '<td data-label="Jumlah">' + L.fmtNum(it.qty) + ' ' + esc(it.unit || '') + '</td>' +
        '<td data-label="Kondisi">' + invConditionBadge(it.condition) + '</td>' +
        '<td data-label="Catatan">' + esc(it.note || '—') + '</td></tr>';
    }).join('');
    return '<section class="card"><div class="page-head"><h2>Inventaris</h2>' +
      '<button type="button" class="btn btn-primary btn-small" onclick="VTK.openInvForm()">+ Tambah barang</button></div>' +
      '<p class="hint">Barang yang Rusak / Perlu Perbaikan tampil paling atas.</p>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Nama barang</th><th>Kategori</th><th>Jumlah</th><th>Kondisi</th><th>Catatan</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="5" class="empty">Belum ada barang inventaris.</td></tr>') + '</tbody></table></div></section>';
  }

  function invFormHTML() {
    var f = state.form;
    var it = f.id ? invById(f.id) : null;
    var v = it || { name: '', category: '', qty: '', unit: '', condition: 'Baik', note: '' };
    return '<section class="page-head"><h1>' + (it ? 'Ubah barang ' + esc(it.id) : 'Barang inventaris baru') + '</h1>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">← Kembali ke Operasional</button></section>' +
      '<form class="card form-card" id="inv-form" onsubmit="return VTK.saveInv(event)">' +
      '<input type="hidden" name="id" value="' + (it ? esc(it.id) : '') + '" />' +
      '<div class="form-row">' +
      '<label class="field field-grow"><span>Nama barang *</span><input type="text" name="name" value="' + esc(v.name) + '" required placeholder="cth: Sprei king size" /></label>' +
      '<label class="field"><span>Kategori</span><input type="text" name="category" value="' + esc(v.category) + '" placeholder="cth: Kamar tidur" /></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>Jumlah *</span><input type="number" name="qty" min="0" step="1" value="' + esc(v.qty) + '" required /></label>' +
      '<label class="field"><span>Satuan</span><input type="text" name="unit" value="' + esc(v.unit) + '" placeholder="cth: pcs, set, buah" /></label>' +
      '<label class="field"><span>Kondisi</span><select name="condition">' + optList(L.INV_CONDITIONS, v.condition) + '</select></label>' +
      '</div>' +
      '<label class="field"><span>Catatan</span><textarea name="note" rows="2">' + esc(v.note) + '</textarea></label>' +
      saveStatusHTML() +
      '<div class="form-actions">' +
      '<button type="submit" class="btn btn-primary">Simpan barang</button>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">Batal</button>' +
      (it ? '<button type="button" class="btn btn-danger" onclick="VTK.delInv(\'' + esc(it.id) + '\')">Hapus</button>' : '') +
      '</div></form>';
  }

  function saveInv(event) {
    event.preventDefault();
    var fd = new FormData($('inv-form'));
    var qty = parseInt(fd.get('qty'), 10);
    var errors = [];
    if (!(fd.get('name') || '').trim()) { errors.push('Nama barang wajib diisi.'); }
    if (isNaN(qty) || qty < 0) { errors.push('Jumlah wajib diisi (0 atau lebih).'); }
    if (errors.length) { setSaveStatus(errors.join(' '), 'error'); return false; }
    var id = fd.get('id') || '';
    var obj = {
      id: id,
      name: (fd.get('name') || '').trim(),
      category: (fd.get('category') || '').trim(),
      qty: qty,
      unit: (fd.get('unit') || '').trim(),
      condition: fd.get('condition') || 'Baik',
      note: (fd.get('note') || '').trim()
    };
    if (!id) {
      obj.id = L.nextId('INV', state.data.inventoryItems, L.todayISO());
      state.data.inventoryItems.push(touch(obj));
    } else {
      var existing = invById(id);
      if (!existing) { setSaveStatus('Barang tidak ditemukan.', 'error'); return false; }
      var createdAt = existing.createdAt;
      Object.assign(existing, obj);
      existing.createdAt = createdAt;
      touch(existing);
    }
    commit().then(function () {
      toast('Barang inventaris tersimpan.');
      state.form = null;
      renderView();
    });
    return false;
  }

  function delInv(id) {
    var it = invById(id);
    if (!it) { return; }
    if (!confirmDialog('Hapus barang "' + it.name + '" dari inventaris?')) { return; }
    state.data.inventoryItems = state.data.inventoryItems.filter(function (x) { return x.id !== id; });
    commit().then(function () {
      toast('Barang inventaris dihapus.');
      state.form = null;
      renderView();
    });
  }

  /* ---- Pesanan katering ---- */

  function ckById(id) {
    return (state.data.cateringOrders || []).find(function (o) { return o.id === id; }) || null;
  }

  function ckSorted() {
    return (state.data.cateringOrders || []).slice().sort(function (a, b) {
      return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1;
    });
  }

  function ckBookingOptions(selectedId) {
    var opts = '<option value="">— Pilih booking —</option>';
    reservationsSorted().forEach(function (r) {
      if (r.status === 'Dibatalkan') { return; }
      opts += '<option value="' + esc(r.id) + '"' + (r.id === selectedId ? ' selected' : '') + '>' +
        esc(r.id) + ' — ' + esc(r.guestName) + ' (' + L.fmtDate(r.checkin) + ')</option>';
    });
    return opts;
  }

  function ckLaborInfoHTML() {
    var labor = L.cateringLaborEstimate(state.data.operationalCosts);
    var parts = labor.items.map(function (it) { return esc(it.name) + ' ' + L.fmtRp(it.amount); }).join(' + ');
    return '<p class="hint">Perkiraan honor juru masak per event: <strong>' + L.fmtRp(labor.total) + '</strong>' +
      (parts ? ' (' + parts + ')' : '') + ', dibayar dari ' + esc(accountLabel('villa')) + '. Ini info biaya saja — bukan transaksi otomatis. ' +
      'Catat pembayaran katering di Keuangan (kategori Pendapatan Katering), honor juru masak ' +
      'sebagai pengeluaran (kategori Honor Juru Masak, ' + esc(accountLabel('villa')) + '), dan belanja bahan ' +
      'sebagai pengeluaran (kategori Belanja Bahan Katering, ' + esc(accountLabel('katering')) + ').</p>';
  }

  function ckListHTML() {
    var rows = ckSorted().map(function (o) {
      var r = reservationById(o.bookingId);
      return '<tr class="clickable" onclick="VTK.openCkForm(\'' + esc(o.id) + '\')">' +
        '<td data-label="ID">' + esc(o.id) + '</td>' +
        '<td data-label="Booking">' + esc(o.bookingId) + (r ? '<br /><span class="muted">' + esc(r.guestName) + '</span>' : '') + '</td>' +
        '<td data-label="Paket">' + esc(o.package) + '</td>' +
        '<td data-label="Makan">' + esc(o.meals) + '</td>' +
        '<td data-label="Pax">' + L.fmtNum(o.pax) + '</td>' +
        '<td data-label="Harga/pax">' + L.fmtRp(o.pricePerPax) + '</td>' +
        '<td data-label="Total">' + L.fmtRp(o.total) + '</td>' +
        '<td data-label="Status">' + ckStatusBadge(o.status) + '</td></tr>';
    }).join('');
    return '<section class="card"><div class="page-head"><h2>Pesanan Katering</h2>' +
      '<button type="button" class="btn btn-primary btn-small" onclick="VTK.openCkForm()">+ Pesanan katering</button></div>' +
      ckLaborInfoHTML() +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Booking</th><th>Paket</th><th>Makan</th><th>Pax</th><th>Harga/pax</th><th>Total</th><th>Status</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="8" class="empty">Belum ada pesanan katering.</td></tr>') + '</tbody></table></div></section>';
  }

  function ckFormHTML() {
    var f = state.form;
    var o = f.id ? ckById(f.id) : null;
    var s = state.data.settings;
    var v = o || {
      bookingId: '', package: (s.catering && s.catering[0] ? s.catering[0].package : ''),
      meals: 'Full', pax: '', status: 'Dipesan', note: ''
    };
    var pkgOpts = (s.catering || []).map(function (c) {
      return '<option value="' + esc(c.package) + '"' + (c.package === v.package ? ' selected' : '') + '>' +
        esc(c.package) + ' (' + L.fmtRp(c.price1x) + ' / ' + L.fmtRp(c.price2x) + ' / ' + L.fmtRp(c.priceFull) + ')</option>';
    }).join('');
    var res = reservationById(v.bookingId);
    return '<section class="page-head"><h1>' + (o ? 'Ubah pesanan ' + esc(o.id) : 'Pesanan katering baru') + '</h1>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">← Kembali ke Operasional</button></section>' +
      '<form class="card form-card" id="ck-form" onsubmit="return VTK.saveCk(event)" oninput="VTK.ckFormRecalc()">' +
      '<input type="hidden" name="id" value="' + (o ? esc(o.id) : '') + '" />' +
      '<div class="form-row">' +
      '<label class="field field-grow"><span>Booking *</span><select name="bookingId">' + ckBookingOptions(v.bookingId) + '</select>' +
      (res ? '<span class="hint">' + esc(res.guestName) + ' — ' + L.fmtDate(res.checkin) + ' s.d. ' + L.fmtDate(res.checkout) + ' (' + L.fmtNum(res.pax) + ' tamu).</span>' : '') + '</label>' +
      '<label class="field"><span>Paket katering *</span><select name="package">' + pkgOpts + '</select></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>Jumlah makan *</span><select name="meals">' + optList(L.CATERING_MEALS, v.meals) + '</select>' +
      '<span class="hint">1x = 40%, 2x = 75% dari harga paket lengkap.</span></label>' +
      '<label class="field"><span>Jumlah pax *</span><input type="number" name="pax" min="1" step="1" value="' + esc(v.pax) + '" required /></label>' +
      '<label class="field"><span>Status</span><select name="status">' + optList(L.CK_STATUSES, v.status) + '</select></label>' +
      '</div>' +
      '<div class="calc-box" id="ck-calc"></div>' +
      '<label class="field"><span>Catatan</span><textarea name="note" rows="2">' + esc(v.note) + '</textarea></label>' +
      ckLaborInfoHTML() +
      saveStatusHTML() +
      '<div class="form-actions">' +
      '<button type="submit" class="btn btn-primary">Simpan pesanan</button>' +
      '<button type="button" class="btn" onclick="VTK.closeForm()">Batal</button>' +
      (o ? '<button type="button" class="btn btn-danger" onclick="VTK.delCk(\'' + esc(o.id) + '\')">Hapus</button>' : '') +
      '</div></form>';
  }

  /* Hitung ulang dinamis total pesanan katering dari paket + makan + pax. */
  function ckFormRecalc() {
    var form = $('ck-form');
    var calcEl = $('ck-calc');
    if (!form || !calcEl) { return; }
    var fd = new FormData(form);
    var calc = L.cateringOrderCalc(state.data.settings, fd.get('package'), fd.get('meals'), fd.get('pax'));
    var labor = L.cateringLaborEstimate(state.data.operationalCosts);
    calcEl.innerHTML =
      '<div><span>Harga/pax</span><strong>' + L.fmtRp(calc.pricePerPax) + '</strong></div>' +
      '<div><span>Pax</span><strong>' + L.fmtNum(calc.pax) + '</strong></div>' +
      '<div><span>Total pesanan</span><strong>' + L.fmtRp(calc.total) + '</strong></div>' +
      '<div><span>Perkiraan honor juru masak</span><strong>' + L.fmtRp(labor.total) + '</strong></div>';
  }

  function saveCk(event) {
    event.preventDefault();
    var fd = new FormData($('ck-form'));
    var errors = [];
    var bookingId = fd.get('bookingId') || '';
    if (!bookingId) { errors.push('Booking wajib dipilih.'); }
    else if (!reservationById(bookingId)) { errors.push('Booking tidak ditemukan.'); }
    if (!fd.get('package')) { errors.push('Paket katering wajib dipilih.'); }
    var pax = parseInt(fd.get('pax'), 10);
    if (isNaN(pax) || pax < 1) { errors.push('Jumlah pax minimal 1.'); }
    if (errors.length) { setSaveStatus(errors.join(' '), 'error'); return false; }
    var calc = L.cateringOrderCalc(state.data.settings, fd.get('package'), fd.get('meals'), pax);
    var id = fd.get('id') || '';
    var obj = {
      id: id,
      bookingId: bookingId,
      package: fd.get('package'),
      meals: fd.get('meals') || 'Full',
      pax: calc.pax,
      pricePerPax: calc.pricePerPax,
      total: calc.total,
      status: fd.get('status') || 'Dipesan',
      note: (fd.get('note') || '').trim()
    };
    if (!id) {
      obj.id = L.nextId('CK', state.data.cateringOrders, L.todayISO());
      state.data.cateringOrders.push(touch(obj));
    } else {
      var existing = ckById(id);
      if (!existing) { setSaveStatus('Pesanan tidak ditemukan.', 'error'); return false; }
      var createdAt = existing.createdAt;
      Object.assign(existing, obj);
      existing.createdAt = createdAt;
      touch(existing);
    }
    commit().then(function () {
      toast('Pesanan katering tersimpan.');
      state.form = null;
      renderView();
    });
    return false;
  }

  function delCk(id) {
    var o = ckById(id);
    if (!o) { return; }
    if (!confirmDialog('Hapus pesanan katering ' + id + ' (' + o.package + ', ' + o.pax + ' pax)?')) { return; }
    state.data.cateringOrders = state.data.cateringOrders.filter(function (x) { return x.id !== id; });
    commit().then(function () {
      toast('Pesanan katering dihapus.');
      state.form = null;
      renderView();
    });
  }

  /* ---------------- 7. Pengaturan ---------------- */

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
    var fixedTotal = L.fixedMonthlyCost(state.data.operationalCosts).total;
    var labels = L.accountLabels(s);

    return '<section class="page-head"><h1>Pengaturan</h1></section>' +
      '<form class="card form-card" id="settings-form" onsubmit="return VTK.saveSettings(event)">' +
      '<h2 id="set-profil">Profil &amp; tarif</h2>' +
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
      '<h2 id="set-peak">Periode peak</h2>' +
      '<div id="peak-rows">' + peaks + '</div>' +
      '<p class="hint">' + esc(s.peakNote || '') + '</p>' +
      '<p class="hint">Tanggal selesai = tanggal check-out: malam terakhir yang kena tarif peak adalah sehari sebelumnya. Contoh: Natal 24–27 Des berarti malam peak 24, 25, 26 Des.</p>' +
      '<button type="button" class="btn btn-small" onclick="VTK.addPeakRow()">+ Tambah periode peak</button>' +
      '<h2 id="set-katering">Harga katering per paket (Rp/pax)</h2>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>Paket</th><th>1x makan</th><th>2x makan</th><th>Paket lengkap</th></tr></thead>' +
      '<tbody>' + cateringRows + '</tbody></table></div>' +
      '<h2 id="set-target">Target &amp; rekening</h2>' +
      '<div class="form-row">' +
      '<label class="field"><span>Target pemasukan bulanan (Rp)</span><input type="number" name="monthlyTarget" min="0" step="100000" value="' + esc(s.monthlyTarget || '') + '" />' +
      '<span class="hint">Kosongkan untuk memakai total biaya tetap (' + L.fmtRp(fixedTotal) + '/bulan) sebagai target = titik impas.</span></label>' +
      '<label class="field"><span>Target okupansi bulanan (%)</span><input type="number" name="targetOccupancyPct" min="0" max="100" step="1" value="' + esc(s.targetOccupancyPct || '') + '" />' +
      '<span class="hint">Mis. 33 = 10 malam dari 30 hari. Kosongkan bila tidak memakai target okupansi.</span></label>' +
      '</div>' +
      '<div class="form-row">' +
      '<label class="field"><span>Label rekening villa</span><input type="text" name="accountLabelVilla" value="' + esc(labels.villa) + '" /></label>' +
      '<label class="field"><span>Label rekening katering &amp; extra bed</span><input type="text" name="accountLabelKatering" value="' + esc(labels.katering) + '" /></label>' +
      '</div>' +
      '<p class="hint">Pembayaran katering &amp; extra bed masuk rekening terpisah dari pembayaran villa. Label di atas hanya nama tampilan; rekening yang dipilih di tiap transaksi tetap tersimpan.</p>' +
      saveStatusHTML() +
      '<div class="form-actions"><button type="submit" class="btn btn-primary">Simpan pengaturan</button></div>' +
      '</form>' +

      '<section class="card" id="set-koneksi"><h2>Koneksi GitHub</h2>' +
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

      '<section class="card" id="set-data"><h2>Data</h2>' +
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

      '<section class="card" id="set-wa"><h2>Template WhatsApp</h2>' + (waHTML || emptyState('Belum ada template.')) +
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
    /* Target bulanan & label rekening (Fase 2). */
    var mtRaw = (fd.get('monthlyTarget') || '').trim();
    var mtNum = parseFloat(mtRaw);
    s.monthlyTarget = (mtRaw === '' || isNaN(mtNum) || mtNum <= 0) ? null : mtNum;
    var occRaw = (fd.get('targetOccupancyPct') || '').trim();
    var occNum = parseFloat(occRaw);
    s.targetOccupancyPct = (occRaw === '' || isNaN(occNum) || occNum <= 0) ? null : Math.min(100, occNum);
    var labV = (fd.get('accountLabelVilla') || '').trim();
    var labK = (fd.get('accountLabelKatering') || '').trim();
    s.accountLabels = {
      villa: labV || L.DEFAULT_ACCOUNT_LABELS.villa,
      katering: labK || L.DEFAULT_ACCOUNT_LABELS.katering
    };
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
      rows.push(['ID Transaksi', 'Tanggal', 'Jenis', 'Kategori', 'Rekening', 'Booking ID', 'Deskripsi', 'Metode', 'Jumlah', 'Bulan', 'PIC', 'Status Verifikasi', 'Bukti / Referensi', 'Catatan']);
      transactionsSorted().forEach(function (tx) {
        rows.push([tx.id, tx.date, tx.type, tx.category, accountLabel(L.accountOf(tx)), tx.bookingId, tx.description, tx.method, tx.amount, tx.month, tx.pic, tx.verifyStatus, tx.proof, tx.note]);
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
      /* Merge template baru dulu, agar ikut tersimpan dalam commit impor. */
      mergeDefaultTemplates().then(function () {
        commit().then(function (res) {
          if (res.ok || res.demo) { toast('Impor berhasil.'); }
          else { toast('Impor tersimpan lokal, belum tersinkron: ' + res.error, 'warn'); }
        });
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
    mergeDefaultTemplates();
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
      mergeDefaultTemplates();
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
    /* Dari halaman Rekening: buka Keuangan dengan filter rekening itu. */
    goFinanceAccount: function (acct) {
      state.filters.tx.account = (acct === 'katering' || acct === 'villa') ? acct : '';
      go('keuangan');
    },
    setDashMonth: function (v) { if (v) { state.dashMonth = v; renderView(); } },
    /* Panah bulan di kalender mini dashboard: geser bulan dashboard. */
    miniCalNav: function (dir) {
      var parts = (state.dashMonth || L.currentMonthKey()).split('-');
      var d = new Date(+parts[0], +parts[1] - 1 + dir, 1);
      state.dashMonth = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
      renderView();
    },
    /* Buka/tutup grup di sidebar desktop. */
    toggleNavGroup: function (label) {
      var g = null;
      for (var i = 0; i < NAV_GROUPS.length; i++) { if (NAV_GROUPS[i].label === label) { g = NAV_GROUPS[i]; break; } }
      if (!g) { return; }
      /* Sidebar sedang diminimize: klik kepala grup membentangkan
       * sidebar dan membuka grup itu (bukan menutupnya). */
      if (document.body.classList.contains('nav-collapsed')) {
        setNavCollapsed(false);
        state.navOpen[label] = true;
        renderNav();
        return;
      }
      state.navOpen[label] = !navGroupOpen(g);
      renderNav();
    },
    /* Tombol minimize di header: ciutkan/bentangkan sidebar kiri. */
    toggleNavCollapse: function () {
      setNavCollapsed(!document.body.classList.contains('nav-collapsed'));
    },
    /* Dari submenu sidebar: buka halaman Operasional pada sub-tab itu. */
    goOpsTab: function (tab) {
      state.opsTab = tab;
      go('operasional');
    },
    /* Dari submenu sidebar Pengaturan: buka halaman Pengaturan lalu
     * lompat ke bagian itu (scroll terjadi di afterRender setelah
     * halaman ter-render, karena hashchange bisa asinkron). */
    goSettingsSection: function (sectionId) {
      state.settingsSection = sectionId;
      state.pendingScroll = sectionId;
      go('pengaturan');
    },
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
    openHkForm: function (id) {
      state.form = { module: 'hk', id: id || null, prefill: null };
      state.opsTab = 'housekeeping';
      renderView();
      window.scrollTo(0, 0);
    },
    openMntForm: function (id) {
      state.form = { module: 'mnt', id: id || null, prefill: null };
      state.opsTab = 'maintenance';
      renderView();
      window.scrollTo(0, 0);
    },
    openInvForm: function (id) {
      state.form = { module: 'inv', id: id || null, prefill: null };
      state.opsTab = 'inventory';
      renderView();
      window.scrollTo(0, 0);
    },
    openCkForm: function (id) {
      state.form = { module: 'ck', id: id || null, prefill: null };
      state.opsTab = 'catering';
      renderView();
      window.scrollTo(0, 0);
    },
    setOpsTab: function (tab) {
      state.opsTab = tab;
      state.form = null;
      renderView();
    },
    closeForm: function () { state.form = null; renderView(); },
    saveRes: saveRes,
    delRes: delRes,
    saveTx: saveTx,
    delTx: delTx,
    txFormSuggestAccount: txFormSuggestAccount,
    saveLead: saveLead,
    delLead: delLead,
    saveHkTask: saveHkTask,
    delHkTask: delHkTask,
    hkToggle: hkToggle,
    saveMnt: saveMnt,
    delMnt: delMnt,
    mntToExpense: mntToExpense,
    saveInv: saveInv,
    delInv: delInv,
    saveCk: saveCk,
    delCk: delCk,
    ckFormRecalc: ckFormRecalc,
    leadToRes: leadToRes,
    leadFormToggleLostReason: leadFormToggleLostReason,
    resFormRecalc: resFormRecalc,
    markRateTouched: function () { state.rateTouched = true; },
    markExtraCostTouched: function () { state.extraCostTouched = true; },
    markPaxTouched: function () { state.paxTouched = true; },
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
