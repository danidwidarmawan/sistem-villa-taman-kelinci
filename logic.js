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
  var TX_CATEGORIES = ['Pembayaran Tamu', 'Pendapatan Katering', 'Refund Tamu', 'Biaya Katering', 'Operasional', 'Housekeeping', 'Maintenance', 'Utilitas', 'Gaji / Jasa', 'Pemasaran', 'Perlengkapan', 'Lainnya'];
  var TX_METHODS = ['Transfer Bank', 'Tunai', 'QRIS', 'E-wallet', 'Lainnya'];
  var TX_VERIFY = ['Belum Dicek', 'Terverifikasi', 'Ditolak'];

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

  /* Saran tarif/malam = rata-rata tarif seluruh malam, dibulatkan ke rupiah. */
  function suggestedRate(checkin, checkout, settings) {
    var n = nightsBetween(checkin, checkout);
    if (!n || n <= 0) { return null; }
    var sum = 0;
    for (var i = 0; i < n; i++) {
      sum += nightRate(addDaysISO(checkin, i), settings);
    }
    return Math.round(sum / n);
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

  /* Terbayar = Pembayaran Tamu terverifikasi − Refund Tamu terverifikasi. */
  function paidForBooking(bookingId, transactions) {
    if (!bookingId) { return 0; }
    var paid = 0;
    (transactions || []).forEach(function (tx) {
      if (tx.bookingId !== bookingId || tx.verifyStatus !== 'Terverifikasi') { return; }
      if (tx.type === 'Masuk' && tx.category === 'Pembayaran Tamu') { paid += +tx.amount || 0; }
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
      dpAmount: Math.round(total * dpPct),
      dueDate: res.checkin ? addDaysISO(res.checkin, -deadlineDays(settings)) : ''
    };
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
      cells.push({
        dateISO: iso,
        day: d.getDate(),
        inMonth: inMonth,
        isToday: iso === today,
        isWeekend: ((data.settings && data.settings.weekendNights) || [5, 6]).indexOf(d.getDay()) !== -1,
        peak: peakForNight(iso, data.settings),
        reservations: res,
        pax: pax,
        capacity: capacityLevel(pax, data.settings)
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
      totalOutstanding += c.remaining;
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

    return {
      monthKey: monthKey,
      monthLabel: monthLabel(monthKey),
      daysInMonth: dim,
      bookingsCheckin: bookingsCheckin,
      nightsOccupied: nightsOccupied,
      occupancyPct: dim ? (nightsOccupied / dim) * 100 : 0,
      leadsThisMonth: leadsThisMonth,
      moneyIn: moneyIn,
      moneyOut: moneyOut,
      netCash: moneyIn - moneyOut,
      totalOutstanding: totalOutstanding,
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
    fmtRp: fmtRp,
    fmtNum: fmtNum,
    fmtPct: fmtPct,
    peakForNight: peakForNight,
    peakMinNightsWarning: peakMinNightsWarning,
    nightRate: nightRate,
    suggestedRate: suggestedRate,
    nightsBetween: nightsBetween,
    deadlineDays: deadlineDays,
    paidForBooking: paidForBooking,
    reservationCalc: reservationCalc,
    findOverlap: findOverlap,
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
