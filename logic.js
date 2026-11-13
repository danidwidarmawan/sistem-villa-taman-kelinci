/* logic.js — Logika hitung murni Sistem Villa Taman Kelinci.
 *
 * File ini TIDAK menyentuh DOM, jaringan, atau storage, sehingga aman
 * di-require() di Node untuk pengujian. Di browser, API tersedia sebagai
 * objek global `VTKLogic`.
 *
 * Konvensi tanggal: string ISO 'YYYY-MM-DD' (tanggal lokal, tanpa jam).
 * Malam menginap: rentang [check-in, check-out) — malam terakhir adalah
 * sehari sebelum check-out. Periode peak memakai konvensi yang sama:
 * [start, end) — tanggal `end` adalah tanggal check-out (mis. Natal
 * 24–27 Des berarti malam peak 24, 25, 26 Des; malam 27 Des sudah bukan peak).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (root) { root.VTKLogic = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var MONTHS_FULL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var DAYS_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  var LEAD_SOURCES = ['WhatsApp langsung', 'Instagram', 'Facebook', 'Google/Maps', 'Referral', 'OTA/Lainnya'];
  var LEAD_STATUSES = ['Baru', 'Follow-up', 'Menunggu DP', 'Menang', 'Kalah'];
  var LOST_REASONS = ['Tanggal tidak tersedia', 'Harga', 'Kapasitas', 'Tidak merespons', 'Butuh early check-in tidak tersedia', 'Bentrok komitmen early check-in', 'Lainnya'];
  var RES_STATUSES = ['Permintaan', 'Menunggu DP', 'Terkonfirmasi', 'Check-in', 'Selesai', 'Dibatalkan'];
  var TX_TYPES = ['Masuk', 'Keluar'];
  var TX_CATEGORIES = ['Pembayaran Tamu', 'Pembayaran Extra Bed', 'Pendapatan Katering', 'Refund Tamu', 'Honor Juru Masak', 'Belanja Bahan Katering', 'Operasional', 'Housekeeping', 'Maintenance', 'Utilitas', 'Gaji / Jasa', 'Pemasaran', 'Perlengkapan', 'Lainnya'];
  var TX_METHODS = ['Transfer Bank', 'Tunai', 'QRIS', 'E-wallet', 'Lainnya'];
  var TX_VERIFY = ['Belum Dicek', 'Terverifikasi', 'Ditolak'];

  /* Rekening (Fase 2): pembayaran villa dan pembayaran katering/extra bed
   * masuk rekening berbeda. Kunci stabil 'villa' | 'katering'; label tampil
   * bisa diedit di settings.accountLabels. */
  var ACCOUNT_KEYS = ['villa', 'katering'];
  var DEFAULT_ACCOUNT_LABELS = { villa: 'Rekening Villa', katering: 'Rekening Katering & Extra Bed' };
  /* Kategori yang rekeningnya otomatis 'katering'. Honor juru masak TIDAK
   * di sini: keputusan pemilik (2026-11-13) honor Irma/Nyai dibayar dari
   * Rekening Villa, sedangkan belanja bahan dari Rekening Katering. */
  var CATERING_ACCOUNT_CATEGORIES = ['Pendapatan Katering', 'Pembayaran Extra Bed', 'Belanja Bahan Katering'];

  var CATERING_MEALS = ['1x', '2x', 'Full'];
  var MNT_STATUSES = ['Dilaporkan', 'Dikerjakan', 'Selesai'];
  var INV_CONDITIONS = ['Baik', 'Perlu Perbaikan', 'Rusak'];
  var CK_STATUSES = ['Dipesan', 'Disiapkan', 'Selesai', 'Dibatalkan'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function pad3(n) { return (n < 10 ? '00' : n < 100 ? '0' : '') + n; }

  function isISODate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && parseISO(s) !== null;
  }

  /* 'YYYY-MM-DD' -> Date lokal tengah malam, atau null bila tidak valid. */
  function parseISO(s) {
    if (typeof s !== 'string') { return null; }
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) { return null; }
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) { return null; }
    return d;
  }

  function toISODate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayISO() { return toISODate(new Date()); }

  function addDaysISO(iso, n) {
    var d = parseISO(iso);
    if (!d) { return ''; }
    d.setDate(d.getDate() + n);
    return toISODate(d);
  }

  /* Selisih hari: b - a (bisa negatif). */
  function diffDays(aISO, bISO) {
    var a = parseISO(aISO);
    var b = parseISO(bISO);
    if (!a || !b) { return NaN; }
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  function monthKeyOf(iso) {
    return typeof iso === 'string' ? iso.slice(0, 7) : '';
  }

  function currentMonthKey() { return todayISO().slice(0, 7); }

  function daysInMonth(year, month0) {
    return new Date(year, month0 + 1, 0).getDate();
  }

  function monthLabel(monthKey) {
    var y = +monthKey.slice(0, 4);
    var m = +monthKey.slice(5, 7) - 1;
    if (!y || m < 0 || m > 11) { return monthKey; }
    return MONTHS_FULL[m] + ' ' + y;
  }

  function fmtDate(iso) {
    var d = parseISO(iso);
    if (!d) { return '—'; }
    return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear();
  }

  function fmtDateTime(isoDT) {
    if (typeof isoDT !== 'string' || !isoDT) { return '—'; }
    var datePart = isoDT.slice(0, 10);
    var timePart = isoDT.slice(11, 16);
    var base = fmtDate(datePart);
    return timePart ? base + ', ' + timePart.replace(':', '.') : base;
  }

  /* Format jam-menit sinkron: '12 Nov 16.30'. */
  function fmtSyncTime(dateObj) {
    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) { return '—'; }
    return dateObj.getDate() + ' ' + MONTHS_SHORT[dateObj.getMonth()] + ' ' +
      pad2(dateObj.getHours()) + '.' + pad2(dateObj.getMinutes());
  }

  function fmtRp(n) {
    if (n === null || n === undefined || isNaN(+n)) { return 'Rp 0'; }
    var v = Math.round(+n);
    var neg = v < 0;
    var s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-Rp ' : 'Rp ') + s;
  }

  function fmtNum(n) {
    if (n === null || n === undefined || isNaN(+n)) { return '0'; }
    return String(Math.round(+n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function fmtPct(x, digits) {
    if (x === null || x === undefined || isNaN(+x)) { return '0%'; }
    var s = (+x).toFixed(digits === undefined ? 1 : digits);
    return s.replace('.', ',') + '%';
  }

  /* Satu desimal, koma desimal Indonesia, tanpa ',0' di belakang. */
  function trimDec(x) {
    return x.toFixed(1).replace('.', ',').replace(/,0$/, '');
  }

  /* Format Rp singkat untuk label chart: 'Rp 7,5jt', 'Rp 500rb', 'Rp 1,5M'. */
  function fmtRpShort(n) {
    if (n === null || n === undefined || isNaN(+n)) { return 'Rp 0'; }
    var v = Math.round(+n);
    var neg = v < 0;
    var a = Math.abs(v);
    var out;
    if (a >= 1000000000) { out = trimDec(a / 1000000000) + 'M'; }
    else if (a >= 1000000) { out = trimDec(a / 1000000) + 'jt'; }
    else if (a >= 1000) { out = trimDec(a / 1000) + 'rb'; }
    else { out = fmtNum(a); }
    return (neg ? '-Rp ' : 'Rp ') + out;
  }

  /* ---------------- Tarif ---------------- */

  function peakForNight(iso, settings) {
    var peaks = (settings && settings.peak) || [];
    for (var i = 0; i < peaks.length; i++) {
      var p = peaks[i];
      if (p && p.start && p.end && iso >= p.start && iso < p.end) { return p; }
    }
    return null;
  }

  /* Tarif satu malam pada tanggal `iso` (peak > weekend/weekday). */
  function nightRate(iso, settings) {
    var t = (settings && settings.tariffs) || {};
    var peak = peakForNight(iso, settings);
    if (peak) { return +peak.rate || 0; }
    var d = parseISO(iso);
    if (!d) { return 0; }
    var weekend = (settings && settings.weekendNights) || [5, 6];
    var isWeekend = weekend.indexOf(d.getDay()) !== -1;
    if (isWeekend) {
      /* Tarif weekend sebelum 2026 berbeda (Rp10jt). */
      if (d.getFullYear() < 2026 && t.weekendPre2026) { return +t.weekendPre2026 || 0; }
      return +t.weekend2026 || 0;
    }
    return +t.weekday2026 || 0;
  }

  /* Saran tarif/malam = rata-rata tarif seluruh malam, dibulatkan ke ribuan
   * terdekat — input tarif di form memakai step 1000, jadi saran pecahan
   * (mis. 6.833.333 untuk campuran weekend/weekday) ditolak browser dan
   * menghambat penyimpanan. Selisih pembulatan maks Rp500/malam. */
  function suggestedRate(checkin, checkout, settings) {
    var n = nightsBetween(checkin, checkout);
    if (!n || n <= 0) { return null; }
    var sum = 0;
    for (var i = 0; i < n; i++) {
      sum += nightRate(addDaysISO(checkin, i), settings);
    }
    return Math.round(sum / n / 1000) * 1000;
  }

  function nightsBetween(checkin, checkout) {
    var n = diffDays(checkin, checkout);
    return isNaN(n) ? 0 : Math.max(0, n);
  }

  /* Jika ada malam peak dalam rentang tapi jumlah malam < min malam peak
   * tersebut, kembalikan { peak, nights, minNights }; jika tidak, null. */
  function peakMinNightsWarning(checkin, checkout, settings) {
    var n = nightsBetween(checkin, checkout);
    if (!n || n <= 0) { return null; }
    var peaks = (settings && settings.peak) || [];
    for (var i = 0; i < n; i++) {
      var p = peakForNight(addDaysISO(checkin, i), settings);
      if (p && n < (+p.minNights || 1)) {
        return { peak: p, nights: n, minNights: +p.minNights || 1 };
      }
    }
    return null;
  }

  /* Jumlah hari sebelum check-in dari string kebijakan, mis. 'H-3' -> 3. */
  function deadlineDays(settings) {
    var s = (settings && settings.paymentDeadline) || 'H-3';
    var m = /H-(\d+)/.exec(s);
    return m ? +m[1] : 3;
  }

  /* ---------------- Reservasi ---------------- */

  /* Terbayar = Pembayaran Tamu + Pembayaran Extra Bed terverifikasi
   * − Refund Tamu terverifikasi. (Biaya extra bed masuk ke total booking
   * lewat extraCost, jadi pembayarannya ikut menghitung terbayar.) */
  function paidForBooking(bookingId, transactions) {
    if (!bookingId) { return 0; }
    var paid = 0;
    (transactions || []).forEach(function (tx) {
      if (tx.bookingId !== bookingId || tx.verifyStatus !== 'Terverifikasi') { return; }
      if (tx.type === 'Masuk' && (tx.category === 'Pembayaran Tamu' || tx.category === 'Pembayaran Extra Bed')) { paid += +tx.amount || 0; }
      if (tx.type === 'Keluar' && tx.category === 'Refund Tamu') { paid -= +tx.amount || 0; }
    });
    return paid;
  }

  function reservationCalc(res, transactions, settings) {
    var nights = nightsBetween(res.checkin, res.checkout);
    var rate = +res.ratePerNight || 0;
    var extra = +res.extraCost || 0;
    var disc = +res.discount || 0;
    var total = Math.max(0, nights * rate + extra - disc);
    var paid = paidForBooking(res.id, transactions);
    var remaining = Math.max(0, total - paid);
    var payStatus;
    if (total === 0) { payStatus = 'Belum dihitung'; }
    else if (paid <= 0) { payStatus = 'Belum Bayar'; }
    else if (paid < total) { payStatus = 'Sebagian'; }
    else { payStatus = 'Lunas'; }
    var dpPct = settings && typeof settings.dpPct === 'number' ? settings.dpPct : 0.5;
    return {
      nights: nights,
      total: total,
      paid: paid,
      remaining: remaining,
      payStatus: payStatus,
      /* DP: ATURAN PEMILIK (2026-11-13) — hanya dari biaya MENGINAP
       * (malam × tarif). Extra bed, kamar VIP, dan diskon TIDAK masuk
       * perhitungan DP. */
      dpAmount: Math.round(nights * rate * dpPct),
      dueDate: res.checkin ? addDaysISO(res.checkin, -deadlineDays(settings)) : ''
    };
  }

  /* Rincian biaya tambahan reservasi: { extraBedCost, vipCost, total, nights }.
   *
   * KEPUTUSAN PEMILIK (2026-11-13, mengunci rumus): extra bed Rp50.000 per bed
   * PER MENGINAP — sekali bayar, BUKAN per malam. Jadi extraBedCost TIDAK
   * dikalikan jumlah malam. Kamar VIP tetap PER MALAM (tarif vipWithVilla,
   * 850rb/malam bila sewa villa — aturan lama).
   *
   * `res` bisa objek reservasi tersimpan atau nilai form (checkin/checkout/
   * vipRooms/extraBeds). Komponen yang sudah tersimpan di reservasi
   * (extraBedCost/vipCost) diutamakan bila ada; bila tidak ada (reservasi lama
   * atau nilai form), dihitung dari jumlah — fallback untuk data lama.
   * Komponen ini TIDAK mengubah total reservasi (total tetap memakai
   * extraCost); dipakai untuk tampilan dan pemisahan rekening extra bed. */
  function extraCostBreakdown(res, settings) {
    var r = res || {};
    var nights = nightsBetween(r.checkin, r.checkout);
    if (typeof r.extraBedCost === 'number' && typeof r.vipCost === 'number') {
      return { extraBedCost: r.extraBedCost, vipCost: r.vipCost, total: r.extraBedCost + r.vipCost, nights: nights };
    }
    var t = (settings && settings.tariffs) || {};
    var beds = Math.max(0, parseInt(r.extraBeds, 10) || 0);
    var vip = Math.max(0, parseInt(r.vipRooms, 10) || 0);
    var extraBedCost = beds * (+t.extraBed || 0); /* per menginap — tanpa × malam */
    var vipCost = vip * (+t.vipWithVilla || 0) * nights; /* VIP per malam */
    return { extraBedCost: extraBedCost, vipCost: vipCost, total: extraBedCost + vipCost, nights: nights };
  }

  /* Reservasi aktif pertama yang rentangnya tumpang tindih, atau null. */
  function findOverlap(reservations, checkin, checkout, excludeId) {
    if (!isISODate(checkin) || !isISODate(checkout) || checkout <= checkin) { return null; }
    var list = reservations || [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.id === excludeId || r.status === 'Dibatalkan') { continue; }
      if (!isISODate(r.checkin) || !isISODate(r.checkout)) { continue; }
      if (checkin < r.checkout && checkout > r.checkin) { return r; }
    }
    return null;
  }

  /* ---------------- Early check-in & turnover ----------------
   * Fakta lapangan pemilik (13 Nov 2026): tamu weekend umumnya Sabtu ke
   * Minggu; karena sistem one way Puncak, tamu Sabtu sering early check-in
   * jam 7 pagi — jadi Jumat malam tidak bisa dijual bila Sabtu sudah
   * terbooking dengan early check-in (tamu Jumat baru check-out jam 12).
   * Aturan di bawah ini UMUM (bukan khusus Jumat): berlaku untuk pasangan
   * malam berurutan mana pun. Definisi HARGA weekend tidak berubah. */

  /* 'HH:MM' -> 'HH.MM' untuk tampilan; '' bila tidak valid/kosong. */
  function fmtTimeHM(t) {
    if (typeof t !== 'string' || !/^\d{2}:\d{2}$/.test(t)) { return ''; }
    return t.replace(':', '.');
  }

  /* Jam check-in standar: pengaturan bila ada, else usulan 14:00. */
  function standardCheckinTime(settings) {
    var s = settings || {};
    var t = s.checkinTime || s.checkinTimeProposal || '14:00';
    return /^\d{2}:\d{2}$/.test(t) ? t : '14:00';
  }

  /* Apakah reservasi ini minta early check-in? Ya bila flag promo 'Ya',
   * atau jam check-in yang disepakati lebih awal dari jam standar.
   * Data lama tanpa kedua field dianggap TANPA early check-in. */
  function wantsEarlyCheckin(res, settings) {
    var r = res || {};
    if (r.promoEarlyCheckin === 'Ya') { return true; }
    var t = typeof r.agreedCheckinTime === 'string' ? r.agreedCheckinTime.trim() : '';
    if (!/^\d{2}:\d{2}$/.test(t)) { return false; }
    return t < standardCheckinTime(settings);
  }

  /* Bentrok turnover untuk booking (checkin, checkout) yang sedang diisi:
   * - KERAS (hard), arah 'checkin': check-in saya = hari check-out booking
   *   aktif lain DAN saya minta early check-in (mereka baru keluar 12.00,
   *   saya mau masuk 07.00).
   * - KERAS (hard), arah 'checkout': check-out saya = hari check-in booking
   *   aktif lain DAN booking itu minta early check-in.
   * - RINGAN (soft): turnover hari yang sama tanpa early check-in di pihak
   *   yang datang — housekeeping hanya punya 12.00-14.00.
   * Mengembalikan { hard: {reservation, direction} | null,
   *                 soft: {reservation, direction} | null }. */
  function turnoverConflict(reservations, checkin, checkout, excludeId, wantsEarly, settings) {
    var out = { hard: null, soft: null };
    if (!isISODate(checkin) || !isISODate(checkout) || checkout <= checkin) { return out; }
    var list = reservations || [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || r.id === excludeId || r.status === 'Dibatalkan') { continue; }
      if (!isISODate(r.checkin) || !isISODate(r.checkout)) { continue; }
      if (r.checkout === checkin) {
        /* Saya tiba di hari mereka pulang. */
        if (wantsEarly) { if (!out.hard) { out.hard = { reservation: r, direction: 'checkin' }; } }
        else if (!out.soft) { out.soft = { reservation: r, direction: 'checkin' }; }
      }
      if (r.checkin === checkout) {
        /* Saya pulang di hari mereka tiba. */
        if (wantsEarlyCheckin(r, settings)) { if (!out.hard) { out.hard = { reservation: r, direction: 'checkout' }; } }
        else if (!out.soft) { out.soft = { reservation: r, direction: 'checkout' }; }
      }
    }
    return out;
  }

  /* Info bila malam `dateISO` TERBLOKIR: ada booking aktif yang check-in
   * keesokan harinya dengan early check-in (tamu datang pagi, jadi malam
   * sebelumnya tidak bisa dijual). Mengembalikan
   * { reservation, checkinTime } atau null bila tidak terblokir. */
  function blockedNightInfo(reservations, dateISO, settings) {
    if (!isISODate(dateISO)) { return null; }
    var next = addDaysISO(dateISO, 1);
    var list = reservations || [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || r.status === 'Dibatalkan') { continue; }
      if (r.checkin === next && wantsEarlyCheckin(r, settings)) {
        return { reservation: r, checkinTime: typeof r.agreedCheckinTime === 'string' ? r.agreedCheckinTime : '' };
      }
    }
    return null;
  }

  /* Alasan manusiawi untuk malam terblokir, mis.
   * "Sabtu, 15 Nov 2026 — Tamu B early check-in 07.00". */
  function blockedNightReason(info) {
    if (!info || !info.reservation) { return ''; }
    var r = info.reservation;
    var d = parseISO(r.checkin);
    var day = d ? DAYS_ID[d.getDay()] + ', ' : '';
    var time = fmtTimeHM(info.checkinTime);
    return day + fmtDate(r.checkin) + ' — ' + (r.guestName || r.id || 'Tamu') +
      ' early check-in' + (time ? ' ' + time : '');
  }

  /* 'ok' | 'ideal' (di atas kapasitas ideal) | 'max' (melebihi maksimum). */
  function capacityLevel(pax, settings) {
    var cap = (settings && settings.capacity) || {};
    var ideal = +cap.idealPax || 30;
    var max = +cap.maxPax || 80;
    if (pax > max) { return 'max'; }
    if (pax > ideal) { return 'ideal'; }
    return 'ok';
  }

  /* ---------------- ID ---------------- */

  /* ID berikutnya format XX-YYYYMM-NNN, dari nomor terbesar di bulan itu + 1. */
  function nextId(prefix, items, dateISO) {
    var yyyymm = (typeof dateISO === 'string' ? dateISO.slice(0, 7) : '').replace('-', '');
    if (!/^\d{6}$/.test(yyyymm)) { yyyymm = currentMonthKey().replace('-', ''); }
    var max = 0;
    (items || []).forEach(function (it) {
      if (!it || typeof it.id !== 'string') { return; }
      var m = new RegExp('^' + prefix + '-' + yyyymm + '-(\\d+)$').exec(it.id);
      if (m) { max = Math.max(max, +m[1]); }
    });
    return prefix + '-' + yyyymm + '-' + pad3(max + 1);
  }

  /* ---------------- Biaya tetap & titik impas ---------------- */

  function fixedMonthlyCost(operationalCosts) {
    var oc = operationalCosts || {};
    var groups = [
      { label: 'Gaji karyawan', items: oc.salaries || [] },
      { label: 'Listrik & air', items: oc.utilities || [] },
      { label: 'Biaya tetap lain', items: oc.fixedOther || [] },
      { label: 'Estimasi maintenance', items: oc.maintenanceEstimates || [] }
    ];
    var total = 0;
    groups.forEach(function (g) {
      g.total = g.items.reduce(function (s, it) { return s + (+it.amount || 0); }, 0);
      total += g.total;
    });
    return { total: total, groups: groups };
  }

  function breakevenNights(totalFixed, settings) {
    var t = (settings && settings.tariffs) || {};
    var wd = +t.weekday2026 || 0;
    var we = +t.weekend2026 || 0;
    return {
      weekday: wd > 0 ? Math.ceil(totalFixed / wd) : null,
      weekend: we > 0 ? Math.ceil(totalFixed / we) : null
    };
  }

  /* ---------------- Kalender ---------------- */

  /* Sel kalender satu bulan (Senin sebagai hari pertama), termasuk hari
   * bulan tetangga untuk melengkapi grid. Setiap sel membawa reservasi
   * aktif yang mencakup hari itu. */
  function calendarCells(data, year, month0, today) {
    var first = new Date(year, month0, 1);
    var lead = (first.getDay() + 6) % 7; /* Senin = 0 */
    var dim = daysInMonth(year, month0);
    var totalCells = Math.ceil((lead + dim) / 7) * 7;
    var startDate = new Date(year, month0, 1 - lead);
    var active = (data.reservations || []).filter(function (r) { return r.status !== 'Dibatalkan'; });
    var cells = [];
    for (var i = 0; i < totalCells; i++) {
      var d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
      var iso = toISODate(d);
      var inMonth = d.getMonth() === month0;
      var res = active.filter(function (r) {
        return isISODate(r.checkin) && isISODate(r.checkout) && iso >= r.checkin && iso < r.checkout;
      });
      var pax = res.reduce(function (s, r) { return s + (+r.pax || 0); }, 0);
      /* Malam kosong yang terblokir: besok ada booking early check-in. */
      var blocked = res.length ? null : blockedNightInfo(data.reservations, iso, data.settings);
      cells.push({
        dateISO: iso,
        day: d.getDate(),
        inMonth: inMonth,
        isToday: iso === today,
        isWeekend: ((data.settings && data.settings.weekendNights) || [5, 6]).indexOf(d.getDay()) !== -1,
        peak: peakForNight(iso, data.settings),
        reservations: res,
        pax: pax,
        capacity: capacityLevel(pax, data.settings),
        blocked: blocked ? { reservation: blocked.reservation, checkinTime: blocked.checkinTime, reason: blockedNightReason(blocked) } : null
      });
    }
    return cells;
  }

  /* ---------------- Dashboard ---------------- */

  function inMonth(iso, monthKey) {
    return typeof iso === 'string' && iso.slice(0, 7) === monthKey;
  }

  function computeDashboard(data, monthKey, today) {
    var y = +monthKey.slice(0, 4);
    var m = +monthKey.slice(5, 7) - 1;
    var dim = daysInMonth(y, m);
    var monthStart = monthKey + '-01';
    var nextMonthStart = toISODate(new Date(y, m + 1, 1));

    var reservations = data.reservations || [];
    var transactions = data.transactions || [];
    var leads = data.leads || [];
    var active = reservations.filter(function (r) { return r.status !== 'Dibatalkan'; });

    var bookingsCheckin = 0;
    var nightsOccupied = 0;
    var totalOutstanding = 0;
    active.forEach(function (r) {
      if (inMonth(r.checkin, monthKey)) { bookingsCheckin++; }
      if (isISODate(r.checkin) && isISODate(r.checkout)) {
        var s = r.checkin < monthStart ? monthStart : r.checkin;
        var e = r.checkout > nextMonthStart ? nextMonthStart : r.checkout;
        var n = diffDays(s, e);
        if (n > 0) { nightsOccupied += n; }
      }
      var c = reservationCalc(r, transactions, data.settings);
      /* 'Selesai' = menginap sudah lewat & dianggap beres, jadi sisanya
         bukan tagihan berjalan (booking lama hasil impor tidak membebani
         Sisa tagihan). Check-in, malam terisi & nilai booking tetap dihitung. */
      if (r.status !== 'Selesai') { totalOutstanding += c.remaining; }
    });

    var leadsThisMonth = leads.filter(function (l) { return inMonth(l.dateIn, monthKey); }).length;

    var moneyIn = 0;
    var moneyOut = 0;
    var unverified = [];
    transactions.forEach(function (tx) {
      if (tx.verifyStatus === 'Belum Dicek') { unverified.push(tx); }
      if (!inMonth(tx.date, monthKey) || tx.verifyStatus !== 'Terverifikasi') { return; }
      if (tx.type === 'Masuk') { moneyIn += +tx.amount || 0; }
      if (tx.type === 'Keluar') { moneyOut += +tx.amount || 0; }
    });

    /* Kinerja sumber lead (bulan yang dipilih). */
    var sourcePerf = LEAD_SOURCES.map(function (src) {
      var srcLeads = leads.filter(function (l) { return inMonth(l.dateIn, monthKey) && l.source === src; });
      var won = srcLeads.filter(function (l) { return l.status === 'Menang'; }).length;
      var bookingValue = 0;
      active.forEach(function (r) {
        /* Workbook memakai Tanggal Booking (bukan check-in) untuk nilai booking per sumber. */
        if (r.source === src && inMonth(r.bookingDate || r.checkin, monthKey)) {
          bookingValue += reservationCalc(r, transactions, data.settings).total;
        }
      });
      return {
        source: src,
        leads: srcLeads.length,
        won: won,
        conversion: srcLeads.length ? (won / srcLeads.length) * 100 : 0,
        bookingValue: bookingValue
      };
    });

    /* Perlu tindakan. */
    var upcomingCheckins = active
      .filter(function (r) {
        var d = diffDays(today, r.checkin);
        return isISODate(r.checkin) && d >= 0 && d <= 7;
      })
      .sort(function (a, b) { return a.checkin < b.checkin ? -1 : 1; });

    var overdueFollowups = leads.filter(function (l) {
      return l.nextFollowup && l.nextFollowup < today &&
        l.status !== 'Menang' && l.status !== 'Kalah';
    }).sort(function (a, b) { return a.nextFollowup < b.nextFollowup ? -1 : 1; });

    var dpOverdue = [];
    active.forEach(function (r) {
      if (r.status !== 'Menunggu DP' || !isISODate(r.checkin)) { return; }
      var c = reservationCalc(r, transactions, data.settings);
      if (c.remaining > 0 && diffDays(today, r.checkin) <= 3) {
        dpOverdue.push({ reservation: r, calc: c, daysToCheckin: diffDays(today, r.checkin) });
      }
    });
    dpOverdue.sort(function (a, b) { return a.reservation.checkin < b.reservation.checkin ? -1 : 1; });

    /* Hari di atas kapasitas ideal / maksimum di bulan ini. */
    var overIdealDays = [];
    var overMaxDays = [];
    for (var day = 1; day <= dim; day++) {
      var iso = monthKey + '-' + pad2(day);
      var pax = 0;
      active.forEach(function (r) {
        if (isISODate(r.checkin) && isISODate(r.checkout) && iso >= r.checkin && iso < r.checkout) {
          pax += +r.pax || 0;
        }
      });
      var lvl = capacityLevel(pax, data.settings);
      if (lvl === 'max') { overMaxDays.push({ date: iso, pax: pax }); }
      else if (lvl === 'ideal') { overIdealDays.push({ date: iso, pax: pax }); }
    }

    var nextCheckins = active
      .filter(function (r) { return isISODate(r.checkin) && r.checkin >= today; })
      .sort(function (a, b) { return a.checkin < b.checkin ? -1 : 1; })
      .slice(0, 5);

    var recentTx = transactions.slice().sort(function (a, b) {
      if (a.date !== b.date) { return a.date < b.date ? 1 : -1; }
      return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1;
    }).slice(0, 5);

    var fixed = fixedMonthlyCost(data.operationalCosts);
    var be = breakevenNights(fixed.total, data.settings);

    /* Target bulanan vs realisasi (uang masuk terverifikasi bulan terpilih,
     * dan okupansi bulan terpilih vs settings.targetOccupancyPct). */
    var occupancyPct = dim ? (nightsOccupied / dim) * 100 : 0;
    var mt = monthlyTarget(data.settings, data.operationalCosts);
    var tp = targetProgress(moneyIn, mt.target);
    var occTargetPct = (data.settings && typeof data.settings.targetOccupancyPct === 'number' && data.settings.targetOccupancyPct > 0)
      ? +data.settings.targetOccupancyPct : null;
    var occProg = targetProgress(occupancyPct, occTargetPct || 0);
    var target = {
      target: mt.target,
      isDefault: mt.isDefault,
      actual: moneyIn,
      pct: tp.pct,
      diff: tp.diff,
      reached: tp.reached,
      hasTarget: tp.hasTarget,
      occ: {
        target: occTargetPct,
        actual: occupancyPct,
        pct: occProg.pct,
        diff: occProg.diff,
        reached: occProg.reached,
        hasTarget: occProg.hasTarget
      }
    };

    return {
      monthKey: monthKey,
      monthLabel: monthLabel(monthKey),
      daysInMonth: dim,
      bookingsCheckin: bookingsCheckin,
      nightsOccupied: nightsOccupied,
      occupancyPct: occupancyPct,
      leadsThisMonth: leadsThisMonth,
      moneyIn: moneyIn,
      moneyOut: moneyOut,
      netCash: moneyIn - moneyOut,
      totalOutstanding: totalOutstanding,
      accountBalances: accountBalances(transactions),
      target: target,
      sourcePerf: sourcePerf,
      actions: {
        unverified: unverified,
        upcomingCheckins: upcomingCheckins,
        overdueFollowups: overdueFollowups,
        dpOverdue: dpOverdue,
        overIdealDays: overIdealDays,
        overMaxDays: overMaxDays
      },
      nextCheckins: nextCheckins,
      recentTx: recentTx,
      fixedCost: fixed,
      breakeven: be
    };
  }

  /* ---------------- Agregasi chart ---------------- */

  /* Daftar kunci bulan kronologis: `count` bulan terakhir yang berakhir
   * di `endMonthKey` (inklusif). count dibatasi 1–24. */
  function monthKeysEndingAt(endMonthKey, count) {
    var n = Math.max(1, Math.min(24, count || 6));
    var y = +String(endMonthKey).slice(0, 4);
    var m = +String(endMonthKey).slice(5, 7) - 1;
    if (!y || m < 0 || m > 11) { return []; }
    var keys = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(y, m - i, 1);
      keys.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1));
    }
    return keys;
  }

  /* Label pendek bulan untuk chart: 'Jun 26'. */
  function monthShortLabel(monthKey) {
    var y = +String(monthKey).slice(0, 4);
    var m = +String(monthKey).slice(5, 7) - 1;
    if (!y || m < 0 || m > 11) { return monthKey; }
    return MONTHS_SHORT[m] + ' ' + String(y).slice(2);
  }

  /* Seri arus kas bulanan (hanya transaksi Terverifikasi).
   * Mengembalikan [{ monthKey, label, masuk, keluar, bersih }], kronologis. */
  function monthlyCashflow(transactions, endMonthKey, count) {
    var keys = monthKeysEndingAt(endMonthKey, count);
    var map = {};
    keys.forEach(function (k) {
      map[k] = { monthKey: k, label: monthShortLabel(k), masuk: 0, keluar: 0, bersih: 0 };
    });
    (transactions || []).forEach(function (tx) {
      if (!tx || tx.verifyStatus !== 'Terverifikasi') { return; }
      var k = monthKeyOf(tx.date);
      if (!map[k]) { return; }
      if (tx.type === 'Masuk') { map[k].masuk += +tx.amount || 0; }
      else if (tx.type === 'Keluar') { map[k].keluar += +tx.amount || 0; }
    });
    return keys.map(function (k) {
      var p = map[k];
      p.bersih = p.masuk - p.keluar;
      return p;
    });
  }

  /* Malam terisi dari reservasi aktif yang jatuh di bulan `monthKey`.
   * (Logika kliping yang sama dengan computeDashboard; sengaja tidak
   * memakai ulang computeDashboard agar fungsi ini tetap ringan.) */
  function nightsInMonth(reservations, monthKey) {
    var y = +String(monthKey).slice(0, 4);
    var m = +String(monthKey).slice(5, 7) - 1;
    if (!y || m < 0 || m > 11) { return 0; }
    var monthStart = monthKey + '-01';
    var nextStart = toISODate(new Date(y, m + 1, 1));
    var total = 0;
    (reservations || []).forEach(function (r) {
      if (!r || r.status === 'Dibatalkan') { return; }
      if (!isISODate(r.checkin) || !isISODate(r.checkout)) { return; }
      var s = r.checkin < monthStart ? monthStart : r.checkin;
      var e = r.checkout > nextStart ? nextStart : r.checkout;
      var n = diffDays(s, e);
      if (n > 0) { total += n; }
    });
    return total;
  }

  /* Seri okupansi bulanan: [{ monthKey, label, malam, hari, pct }]. */
  function monthlyOccupancy(reservations, endMonthKey, count) {
    return monthKeysEndingAt(endMonthKey, count).map(function (k) {
      var y = +k.slice(0, 4);
      var m = +k.slice(5, 7) - 1;
      var dim = daysInMonth(y, m);
      var nights = nightsInMonth(reservations, k);
      return { monthKey: k, label: monthShortLabel(k), malam: nights, hari: dim, pct: dim ? (nights / dim) * 100 : 0 };
    });
  }

  /* Total per kategori untuk satu jenis transaksi ('Masuk'/'Keluar'),
   * bulan `monthKey` (null/'' = semua bulan), hanya Terverifikasi.
   * Mengembalikan [{ category, total }] urut terbesar dulu; kategori
   * dengan total 0 dibuang. */
  function categoryTotals(transactions, monthKey, type) {
    var sums = {};
    (transactions || []).forEach(function (tx) {
      if (!tx || tx.verifyStatus !== 'Terverifikasi') { return; }
      if (type && tx.type !== type) { return; }
      if (monthKey && monthKeyOf(tx.date) !== monthKey) { return; }
      var c = tx.category || 'Lainnya';
      sums[c] = (sums[c] || 0) + (+tx.amount || 0);
    });
    return Object.keys(sums).filter(function (c) { return sums[c] > 0; })
      .map(function (c) { return { category: c, total: sums[c] }; })
      .sort(function (a, b) { return b.total - a.total; });
  }

  /* Komposisi pemasukan satu bulan untuk donut dashboard:
   * { monthKey, items: [{ category, total }] (urut terbesar dulu), total }.
   * Hanya transaksi Masuk + Terverifikasi (memakai categoryTotals). */
  function incomeComposition(transactions, monthKey) {
    var items = categoryTotals(transactions, monthKey, 'Masuk');
    var total = items.reduce(function (s, it) { return s + (+it.total || 0); }, 0);
    return { monthKey: monthKey, items: items, total: total };
  }

  /* ---------------- Rekening (Fase 2) ---------------- */

  /* Label rekening dari settings, dengan default bila settings lama
   * belum punya accountLabels. */
  function accountLabels(settings) {
    var l = (settings && settings.accountLabels) || {};
    return {
      villa: (l.villa && String(l.villa).trim()) || DEFAULT_ACCOUNT_LABELS.villa,
      katering: (l.katering && String(l.katering).trim()) || DEFAULT_ACCOUNT_LABELS.katering
    };
  }

  function accountLabel(settings, key) {
    return accountLabels(settings)[key] || accountLabels(settings).villa;
  }

  /* Rekening sebuah transaksi; data lama tanpa field account = 'villa'. */
  function accountOf(tx) {
    return tx && tx.account === 'katering' ? 'katering' : 'villa';
  }

  /* Saran rekening dari kategori (pengguna bisa mengubah di form). */
  function suggestedAccount(category) {
    return CATERING_ACCOUNT_CATEGORIES.indexOf(category) !== -1 ? 'katering' : 'villa';
  }

  /* Saldo per rekening (semua waktu, hanya transaksi Terverifikasi):
   * { villa: { masuk, keluar, saldo }, katering: {...}, total: {...} }. */
  function accountBalances(transactions) {
    var out = {
      villa: { masuk: 0, keluar: 0, saldo: 0 },
      katering: { masuk: 0, keluar: 0, saldo: 0 },
      total: { masuk: 0, keluar: 0, saldo: 0 }
    };
    (transactions || []).forEach(function (tx) {
      if (!tx || tx.verifyStatus !== 'Terverifikasi') { return; }
      var a = accountOf(tx);
      var amt = +tx.amount || 0;
      if (tx.type === 'Masuk') { out[a].masuk += amt; out.total.masuk += amt; }
      else if (tx.type === 'Keluar') { out[a].keluar += amt; out.total.keluar += amt; }
    });
    ['villa', 'katering', 'total'].forEach(function (k) { out[k].saldo = out[k].masuk - out[k].keluar; });
    return out;
  }

  /* Ringkasan satu rekening dalam satu bulan (hanya transaksi Terverifikasi):
   * { masuk, keluar, bersih }. Dipakai tab Rekening untuk "bulan berjalan".
   * Transaksi tanpa field account = villa (accountOf); rekening tidak
   * dikenal diperlakukan sebagai villa. */
  function accountMonthSummary(transactions, account, monthKey) {
    var out = { masuk: 0, keluar: 0, bersih: 0 };
    var a = account === 'katering' ? 'katering' : 'villa';
    (transactions || []).forEach(function (tx) {
      if (!tx || tx.verifyStatus !== 'Terverifikasi') { return; }
      if (!inMonth(tx.date, monthKey)) { return; }
      if (accountOf(tx) !== a) { return; }
      var amt = +tx.amount || 0;
      if (tx.type === 'Masuk') { out.masuk += amt; }
      else if (tx.type === 'Keluar') { out.keluar += amt; }
    });
    out.bersih = out.masuk - out.keluar;
    return out;
  }

  /* ---------------- Target bulanan (Fase 2) ---------------- */

  /* Target bulanan efektif: settings.monthlyTarget bila > 0; bila tidak,
   * default = total biaya tetap bulanan (titik impas). */
  function monthlyTarget(settings, operationalCosts) {
    var t = settings ? +settings.monthlyTarget : NaN;
    if (t > 0) { return { target: t, isDefault: false }; }
    return { target: fixedMonthlyCost(operationalCosts).total, isDefault: true };
  }

  /* Progres realisasi vs target: { pct, diff (aktual − target), reached, hasTarget }. */
  function targetProgress(actual, target) {
    var a = +actual || 0;
    var t = +target || 0;
    if (t <= 0) { return { pct: 0, diff: a, reached: false, hasTarget: false }; }
    return { pct: (a / t) * 100, diff: a - t, reached: a >= t, hasTarget: true };
  }

  /* ---------------- Pandangan ke depan (Fase 2) ---------------- */

  /* Ringkasan `days` hari ke depan dari `today` (inklusif, malam [today, today+days)):
   * malam terisi vs kosong, malam weekend (Jumat/Sabtu per settings.weekendNights)
   * yang belum terisi, dan booking aktif yang masuk jendela itu.
   * Aturan malam sama dengan kalender: [check-in, check-out). */
  function forwardOutlook(reservations, today, days, settings) {
    var n = Math.max(1, Math.min(90, days || 30));
    var start = today;
    var end = addDaysISO(today, n);
    var weekend = (settings && settings.weekendNights) || [5, 6];
    var active = (reservations || []).filter(function (r) {
      return r && r.status !== 'Dibatalkan' && isISODate(r.checkin) && isISODate(r.checkout);
    });
    var occupied = {};
    active.forEach(function (r) {
      var d = r.checkin < start ? start : r.checkin;
      var e = r.checkout > end ? end : r.checkout;
      var nights = diffDays(d, e);
      for (var i = 0; i < nights; i++) { occupied[addDaysISO(d, i)] = r; }
    });
    var nightsOccupied = 0;
    var nightsBlocked = 0;
    var emptyWeekendNights = [];
    var blockedNights = [];
    var blockedWeekendNights = [];
    for (var j = 0; j < n; j++) {
      var iso = addDaysISO(today, j);
      if (occupied[iso]) { nightsOccupied++; continue; }
      var d = parseISO(iso);
      var isWk = d && weekend.indexOf(d.getDay()) !== -1;
      /* Malam terblokir (besok ada booking early check-in) bukan malam kosong. */
      var blk = blockedNightInfo(reservations, iso, settings);
      if (blk) {
        nightsBlocked++;
        var entry = {
          dateISO: iso,
          label: fmtDate(iso) + (d ? ' (' + DAYS_ID[d.getDay()] + ')' : ''),
          reason: blockedNightReason(blk),
          bookingId: blk.reservation.id,
          guestName: blk.reservation.guestName
        };
        blockedNights.push(entry);
        if (isWk) { blockedWeekendNights.push(entry); }
        continue;
      }
      if (isWk) {
        emptyWeekendNights.push({ dateISO: iso, label: fmtDate(iso) + ' (' + DAYS_ID[d.getDay()] + ')' });
      }
    }
    var bookings = active.filter(function (r) { return r.checkin < end && r.checkout > start; })
      .sort(function (a, b) { return a.checkin < b.checkin ? -1 : 1; })
      .map(function (r) {
        return { id: r.id, guestName: r.guestName, checkin: r.checkin, checkout: r.checkout,
          nights: nightsBetween(r.checkin, r.checkout), pax: +r.pax || 0, status: r.status };
      });
    return {
      start: start,
      end: end,
      days: n,
      nightsOccupied: nightsOccupied,
      nightsBlocked: nightsBlocked,
      nightsEmpty: n - nightsOccupied - nightsBlocked,
      occupancyPct: n ? (nightsOccupied / n) * 100 : 0,
      emptyWeekendNights: emptyWeekendNights,
      blockedNights: blockedNights,
      blockedWeekendNights: blockedWeekendNights,
      bookings: bookings
    };
  }

  /* ---------------- Pesanan katering (Fase 2) ---------------- */

  /* Harga per pax dari settings.catering untuk paket + jumlah makan.
   * '1x' = 40%, '2x' = 75%, 'Full' = 100% (harga parsial tersimpan di settings). */
  function cateringPricePerPax(settings, pkg, meals) {
    var list = (settings && settings.catering) || [];
    var found = null;
    for (var i = 0; i < list.length; i++) { if (list[i].package === pkg) { found = list[i]; break; } }
    if (!found) { return 0; }
    if (meals === '1x') { return +found.price1x || 0; }
    if (meals === '2x') { return +found.price2x || 0; }
    return +found.priceFull || 0;
  }

  /* Hitung pesanan: { pricePerPax, pax, total }. */
  function cateringOrderCalc(settings, pkg, meals, pax) {
    var price = cateringPricePerPax(settings, pkg, meals);
    var n = Math.max(0, parseInt(pax, 10) || 0);
    return { pricePerPax: price, pax: n, total: price * n };
  }

  /* Perkiraan honor juru masak per event dari
   * operationalCosts.cateringLaborPerEvent: { items: [{ name, amount }], total }. */
  function cateringLaborEstimate(operationalCosts) {
    var items = ((operationalCosts || {}).cateringLaborPerEvent || []).map(function (it) {
      return { name: it.name, amount: +it.amount || 0 };
    });
    var total = items.reduce(function (s, it) { return s + it.amount; }, 0);
    return { items: items, total: total };
  }

  /* ---------------- Housekeeping turunan (Fase 2) ---------------- */

  /* Tugas turunan dari reservasi aktif: "Siapkan villa" H-1 sebelum check-in
   * dan "Bersihkan villa" pada hari check-out. Status selesai disimpan sebagai
   * daftar kunci di `doneKeys` ('prep:BK-…' / 'clean:BK-…').
   * Tugas yang sudah selesai dan tanggalnya lebih dari 7 hari lalu
   * disembunyikan; tugas yang belum selesai tetap tampil berapa pun usianya.
   * Urut: belum selesai dulu (tanggal terdekat dulu), selesai di belakang. */
  function derivedHousekeeping(reservations, doneKeys, today) {
    var done = {};
    (doneKeys || []).forEach(function (k) { done[k] = true; });
    var cutoff = addDaysISO(today, -7);
    var tasks = [];
    (reservations || []).forEach(function (r) {
      if (!r || r.status === 'Dibatalkan') { return; }
      if (!isISODate(r.checkin) || !isISODate(r.checkout)) { return; }
      var prepKey = 'prep:' + r.id;
      var cleanKey = 'clean:' + r.id;
      /* Jam check-in yang disepakati ditampilkan bila ada, agar jelas villa
       * harus sudah beres sebelum pagi (mis. early check-in 07.00). */
      var agreed = fmtTimeHM(r.agreedCheckinTime);
      tasks.push({
        key: prepKey, kind: 'prep', bookingId: r.id, guestName: r.guestName,
        date: addDaysISO(r.checkin, -1),
        title: 'Siapkan villa — ' + r.guestName,
        detail: 'Check-in ' + fmtDate(r.checkin) + (agreed ? ' ' + agreed : ''),
        done: !!done[prepKey]
      });
      tasks.push({
        key: cleanKey, kind: 'clean', bookingId: r.id, guestName: r.guestName,
        date: r.checkout,
        title: 'Bersihkan villa — ' + r.guestName,
        detail: 'Check-out ' + fmtDate(r.checkout),
        done: !!done[cleanKey]
      });
    });
    return tasks.filter(function (t) { return !t.done || t.date >= cutoff; })
      .sort(function (a, b) {
        if (a.done !== b.done) { return a.done ? 1 : -1; }
        if (a.date !== b.date) { return a.date < b.date ? -1 : 1; }
        return a.key < b.key ? -1 : 1;
      });
  }

  /* ---------------- Validasi bentuk data (untuk impor) ---------------- */

  var REQUIRED_ARRAYS = ['rooms', 'cateringMenus', 'waTemplates', 'leads', 'reservations', 'transactions', 'tasks', 'maintenance', 'inventory', 'marketing', 'guests', 'cateringOrders'];

  function validateData(d) {
    var errors = [];
    if (!d || typeof d !== 'object' || Array.isArray(d)) { return ['File bukan objek JSON yang valid.']; }
    if (typeof d.version !== 'number') { errors.push('Field "version" hilang.'); }
    if (!d.settings || typeof d.settings !== 'object') { errors.push('Field "settings" hilang.'); }
    if (!d.operationalCosts || typeof d.operationalCosts !== 'object') { errors.push('Field "operationalCosts" hilang.'); }
    REQUIRED_ARRAYS.forEach(function (k) {
      if (!Array.isArray(d[k])) { errors.push('Field "' + k + '" harus berupa daftar.'); }
    });
    return errors;
  }

  /* ---------------- Merge template WA default (V4) ---------------- */

  /* Gabung template WA default (dari seed) ke daftar saat ini: hanya
   * MENAMBAH template yang ID-nya belum ada; tidak pernah menimpa atau
   * menghapus template yang sudah ada. Mengembalikan
   * { list, added } — list adalah daftar baru (bila ada penambahan) atau
   * daftar asli bila tidak ada perubahan. Dipakai saat data dimuat, agar
   * data lama tetap mendapat template baru (mis. WA-16) tanpa edit manual. */
  function mergeWaTemplates(current, defaults) {
    var list = Array.isArray(current) ? current.slice() : [];
    var ids = {};
    list.forEach(function (t) { if (t && t.id) { ids[t.id] = true; } });
    var added = 0;
    (defaults || []).forEach(function (t) {
      if (t && t.id && !ids[t.id]) {
        ids[t.id] = true;
        list.push(t);
        added++;
      }
    });
    return { list: list, added: added };
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  return {
    MONTHS_SHORT: MONTHS_SHORT,
    MONTHS_FULL: MONTHS_FULL,
    DAYS_ID: DAYS_ID,
    LEAD_SOURCES: LEAD_SOURCES,
    LEAD_STATUSES: LEAD_STATUSES,
    LOST_REASONS: LOST_REASONS,
    RES_STATUSES: RES_STATUSES,
    TX_TYPES: TX_TYPES,
    TX_CATEGORIES: TX_CATEGORIES,
    TX_METHODS: TX_METHODS,
    TX_VERIFY: TX_VERIFY,
    ACCOUNT_KEYS: ACCOUNT_KEYS,
    DEFAULT_ACCOUNT_LABELS: DEFAULT_ACCOUNT_LABELS,
    CATERING_MEALS: CATERING_MEALS,
    MNT_STATUSES: MNT_STATUSES,
    INV_CONDITIONS: INV_CONDITIONS,
    CK_STATUSES: CK_STATUSES,
    pad2: pad2,
    pad3: pad3,
    isISODate: isISODate,
    parseISO: parseISO,
    toISODate: toISODate,
    todayISO: todayISO,
    addDaysISO: addDaysISO,
    diffDays: diffDays,
    monthKeyOf: monthKeyOf,
    currentMonthKey: currentMonthKey,
    daysInMonth: daysInMonth,
    monthLabel: monthLabel,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    fmtSyncTime: fmtSyncTime,
    fmtTimeHM: fmtTimeHM,
    fmtRp: fmtRp,
    fmtRpShort: fmtRpShort,
    fmtNum: fmtNum,
    fmtPct: fmtPct,
    monthKeysEndingAt: monthKeysEndingAt,
    monthShortLabel: monthShortLabel,
    monthlyCashflow: monthlyCashflow,
    monthlyOccupancy: monthlyOccupancy,
    nightsInMonth: nightsInMonth,
    categoryTotals: categoryTotals,
    incomeComposition: incomeComposition,
    accountLabels: accountLabels,
    accountLabel: accountLabel,
    accountOf: accountOf,
    suggestedAccount: suggestedAccount,
    accountBalances: accountBalances,
    accountMonthSummary: accountMonthSummary,
    monthlyTarget: monthlyTarget,
    targetProgress: targetProgress,
    forwardOutlook: forwardOutlook,
    cateringPricePerPax: cateringPricePerPax,
    cateringOrderCalc: cateringOrderCalc,
    cateringLaborEstimate: cateringLaborEstimate,
    derivedHousekeeping: derivedHousekeeping,
    peakForNight: peakForNight,
    peakMinNightsWarning: peakMinNightsWarning,
    nightRate: nightRate,
    suggestedRate: suggestedRate,
    nightsBetween: nightsBetween,
    deadlineDays: deadlineDays,
    paidForBooking: paidForBooking,
    reservationCalc: reservationCalc,
    extraCostBreakdown: extraCostBreakdown,
    findOverlap: findOverlap,
    wantsEarlyCheckin: wantsEarlyCheckin,
    turnoverConflict: turnoverConflict,
    blockedNightInfo: blockedNightInfo,
    blockedNightReason: blockedNightReason,
    mergeWaTemplates: mergeWaTemplates,
    capacityLevel: capacityLevel,
    nextId: nextId,
    fixedMonthlyCost: fixedMonthlyCost,
    breakevenNights: breakevenNights,
    calendarCells: calendarCells,
    computeDashboard: computeDashboard,
    validateData: validateData,
    deepClone: deepClone
  };
});
