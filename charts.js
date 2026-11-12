/* charts.js — Grafik SVG murni Sistem Villa Taman Kelinci.
 *
 * Tanpa dependensi, tanpa CDN, tanpa library chart. Fungsi-fungsi di sini
 * hanya mengubah data menjadi string HTML/SVG (tidak menyentuh DOM),
 * sehingga bisa diuji di Node. Di browser, API tersedia sebagai objek
 * global `VTKCharts`; format angka memakai VTKLogic bila tersedia.
 *
 * Palet selaras dengan styles.css: oranye primer #e8590c dan navy #16324f
 * (identitas navy + oranye seperti referensi dashboard); hijau hanya
 * untuk makna positif di luar chart arus kas, merah untuk negatif.
 * Semua chart responsif: SVG memakai viewBox dan melebar mengikuti kartu.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (root) { root.VTKCharts = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var C = {
    orange: '#e8590c',
    orangeDark: '#c2410c',
    orangeArea: '#ffedd5',
    navy: '#16324f',
    navyLight: '#1d4568',
    green: '#2f9e44',
    red: '#e03131',
    gold: '#e9a13b',
    blue: '#1c5d99',
    teal: '#0f766e',
    ink: '#292524',
    muted: '#78716c',
    grid: '#e7e0d3',
    track: '#f5efe4'
  };

  /* Warna segmen donut (dipakai berurutan, terbesar dulu). */
  var DONUT_COLORS = [C.orange, C.navy, C.green, C.gold, C.blue, C.teal];

  var W = 560; /* lebar viewBox untuk chart vertikal */

  function esc(s) {
    if (s === null || s === undefined) { return ''; }
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function logic() {
    return (typeof VTKLogic !== 'undefined') ? VTKLogic : null;
  }

  /* 'Rp 7,5jt' — pakai VTKLogic bila ada, fallback sederhana bila tidak. */
  function fmtShort(n) {
    var L = logic();
    if (L && L.fmtRpShort) { return L.fmtRpShort(n); }
    var v = Math.round(+n || 0);
    return 'Rp ' + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  /* Nilai singkat tanpa awalan 'Rp ' (label di atas batang, agar ringkas). */
  function fmtShortNum(n) {
    return fmtShort(n).replace(/^-?Rp /, '');
  }

  /* Langkah sumbu yang 'cantik' (1 / 2 / 2,5 / 5 / 10 x pangkat 10). */
  function niceStep(raw) {
    if (!(raw > 0)) { return 1; }
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / pow;
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nf * pow;
  }

  function emptyHTML(msg) {
    return '<div class="chart-empty"><p>' + esc(msg) + '</p></div>';
  }

  function legendHTML(items) {
    var parts = items.map(function (it) {
      return '<span class="lg"><i style="background:' + esc(it.color) + '"></i>' + esc(it.label) + '</span>';
    }).join('');
    return '<div class="chart-legend">' + parts + '</div>';
  }

  function svgOpen(h, ariaLabel) {
    return '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + h + '" role="img" aria-label="' + esc(ariaLabel) + '">';
  }

  /* ---------------- Batang berkelompok: arus kas ----------------
   * points: [{ label, masuk, keluar }] */

  function cashflowChart(points, opts) {
    opts = opts || {};
    var list = points || [];
    var hasData = list.some(function (p) { return (+p.masuk || 0) > 0 || (+p.keluar || 0) > 0; });
    if (!list.length || !hasData) {
      return emptyHTML(opts.emptyMsg || 'Belum ada data — grafik muncul setelah ada transaksi terverifikasi.');
    }
    var maxVal = 0;
    list.forEach(function (p) {
      maxVal = Math.max(maxVal, +p.masuk || 0, +p.keluar || 0);
    });
    var step = niceStep(maxVal / 4);
    var top = step * 4;
    var H = 270;
    var mL = 66, mR = 12, mT = 30, mB = 30;
    var plotW = W - mL - mR;
    var plotH = H - mT - mB;
    var n = list.length;
    var groupW = plotW / n;
    var barW = Math.min(30, groupW * 0.32);
    var gap = 4;

    var y = function (v) { return mT + plotH - (v / top) * plotH; };

    var s = svgOpen(H, 'Grafik batang arus kas per bulan: uang masuk dan uang keluar.');
    /* Garis grid + label sumbu Y */
    for (var t = 0; t <= 4; t++) {
      var val = step * t;
      var yy = y(val);
      s += '<line x1="' + mL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - mR) + '" y2="' + yy.toFixed(1) +
        '" stroke="' + C.grid + '" stroke-width="' + (t === 0 ? 1.5 : 1) + '" />';
      s += '<text x="' + (mL - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="' + C.muted + '">' +
        esc(fmtShort(val)) + '</text>';
    }
    /* Batang + label nilai + label bulan */
    list.forEach(function (p, i) {
      var gx = mL + i * groupW;
      var totalW = barW * 2 + gap;
      var x0 = gx + (groupW - totalW) / 2;
      var masuk = +p.masuk || 0;
      var keluar = +p.keluar || 0;
      var bars = [
        { v: masuk, x: x0, color: C.orange, name: 'Masuk' },
        { v: keluar, x: x0 + barW + gap, color: C.navy, name: 'Keluar' }
      ];
      bars.forEach(function (b) {
        if (b.v <= 0) { return; }
        var bh = (b.v / top) * plotH;
        var by = mT + plotH - bh;
        s += '<g><title>' + esc(p.label) + ' — ' + b.name + ' ' + esc(fmtShort(b.v)) + '</title>' +
          '<rect x="' + b.x.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + barW.toFixed(1) +
          '" height="' + Math.max(bh, 2).toFixed(1) + '" rx="3" fill="' + b.color + '" /></g>';
        s += '<text x="' + (b.x + barW / 2).toFixed(1) + '" y="' + (by - 6).toFixed(1) +
          '" text-anchor="middle" font-size="11" font-weight="600" fill="' + C.ink + '">' +
          esc(fmtShortNum(b.v)) + '</text>';
      });
      s += '<text x="' + (gx + groupW / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="12" fill="' + C.muted + '">' +
        esc(p.label) + '</text>';
    });
    s += '</svg>';
    return '<div class="chart-wrap">' +
      legendHTML([{ color: C.orange, label: 'Uang masuk' }, { color: C.navy, label: 'Uang keluar' }]) +
      s + '</div>';
  }

  /* ---------------- Garis: okupansi ----------------
   * points: [{ label, pct, malam, hari }] */

  function occupancyChart(points, opts) {
    opts = opts || {};
    var list = points || [];
    var hasData = list.some(function (p) { return (+p.pct || 0) > 0; });
    if (!list.length || !hasData) {
      return emptyHTML(opts.emptyMsg || 'Belum ada data — grafik muncul setelah ada reservasi.');
    }
    var H = 240;
    var mL = 46, mR = 18, mT = 26, mB = 30;
    var plotW = W - mL - mR;
    var plotH = H - mT - mB;
    var n = list.length;
    /* Sumbu-Y dinamis (nice steps) agar area terisi tetap terlihat jelas
     * saat okupansi kecil — sumbu 0–100% membuat area 6,7% hampir tak terlihat. */
    var maxPct = 0;
    list.forEach(function (p) { maxPct = Math.max(maxPct, +p.pct || 0); });
    var step = maxPct <= 10 ? 2.5 : maxPct <= 20 ? 5 : maxPct <= 40 ? 10 : 25;
    var axisMax = step * 4;
    var fmtAxis = function (v) {
      var r = Math.round(v * 10) / 10;
      return (r % 1 === 0 ? String(r) : String(r).replace('.', ','));
    };
    var xAt = function (i) { return mL + plotW * (i + 0.5) / n; };
    var yAt = function (pct) { return mT + plotH * (1 - Math.min(axisMax, Math.max(0, pct)) / axisMax); };

    var s = svgOpen(H, 'Grafik garis okupansi per bulan dalam persen.');
    [0, 1, 2, 3, 4].forEach(function (k) {
      var t = step * k;
      var yy = yAt(t);
      s += '<line x1="' + mL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - mR) + '" y2="' + yy.toFixed(1) +
        '" stroke="' + C.grid + '" stroke-width="' + (t === 0 ? 1.5 : 1) + '" />';
      s += '<text x="' + (mL - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="' + C.muted + '">' +
        fmtAxis(t) + '%</text>';
    });
    /* Area gradasi oranye di bawah garis navy. */
    s += '<defs><linearGradient id="vtg-occ-grad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + C.orange + '" stop-opacity="0.35" />' +
      '<stop offset="100%" stop-color="' + C.orange + '" stop-opacity="0.03" />' +
      '</linearGradient></defs>';
    var area = 'M ' + xAt(0).toFixed(1) + ',' + yAt(0).toFixed(1);
    list.forEach(function (p, i) { area += ' L ' + xAt(i).toFixed(1) + ',' + yAt(p.pct).toFixed(1); });
    area += ' L ' + xAt(n - 1).toFixed(1) + ',' + yAt(0).toFixed(1) + ' Z';
    s += '<path d="' + area + '" fill="url(#vtg-occ-grad)" />';
    /* Garis navy */
    var line = '';
    list.forEach(function (p, i) {
      line += (i === 0 ? 'M ' : ' L ') + xAt(i).toFixed(1) + ',' + yAt(p.pct).toFixed(1);
    });
    s += '<path d="' + line + '" fill="none" stroke="' + C.navy + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />';
    /* Titik + label nilai + label bulan */
    list.forEach(function (p, i) {
      var cx = xAt(i);
      var cy = yAt(p.pct);
      var pctLabel = Math.round(p.pct) + '%';
      var L = logic();
      var exact = L && L.fmtPct ? L.fmtPct(p.pct) : pctLabel;
      s += '<g><title>' + esc(p.label) + ' — okupansi ' + esc(exact) + ' (' + esc(p.malam) + ' dari ' + esc(p.hari) + ' malam)</title>' +
        '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="4.5" fill="#fff" stroke="' + C.navy + '" stroke-width="2.5" /></g>';
      s += '<text x="' + cx.toFixed(1) + '" y="' + (cy - 10).toFixed(1) +
        '" text-anchor="middle" font-size="11" font-weight="600" fill="' + C.ink + '">' + pctLabel + '</text>';
      s += '<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="12" fill="' + C.muted + '">' +
        esc(p.label) + '</text>';
    });
    s += '</svg>';
    return '<div class="chart-wrap">' + s + '</div>';
  }

  /* ---------------- Batang horizontal: peringkat ----------------
   * items: [{ label, value }] (urut terbesar dulu). opts: { color, emptyMsg, ariaLabel } */

  function hBarChart(items, opts) {
    opts = opts || {};
    var list = items || [];
    var maxVal = 0;
    list.forEach(function (it) { maxVal = Math.max(maxVal, +it.value || 0); });
    if (!list.length || maxVal <= 0) {
      return emptyHTML(opts.emptyMsg || 'Belum ada data.');
    }
    var color = C[opts.color] || opts.color || C.orange;
    var labelW = 150;
    var barX = labelW + 8;
    var barMaxW = 290;
    var rowH = 34;
    var H = 12 + list.length * rowH + 8;
    var s = svgOpen(H, opts.ariaLabel || 'Grafik batang horizontal.');
    list.forEach(function (it, i) {
      var v = +it.value || 0;
      var yTop = 12 + i * rowH;
      var yMid = yTop + rowH / 2;
      var bw = Math.max(v > 0 ? 2 : 0, (v / maxVal) * barMaxW);
      var label = String(it.label || '');
      if (label.length > 22) { label = label.slice(0, 21) + '…'; }
      s += '<text x="' + (barX - 10) + '" y="' + (yMid + 4).toFixed(1) + '" text-anchor="end" font-size="12" fill="' + C.ink + '">' +
        esc(label) + '</text>';
      s += '<rect x="' + barX + '" y="' + (yMid - 10).toFixed(1) + '" width="' + barMaxW + '" height="20" rx="3" fill="' + C.track + '" />';
      if (v > 0) {
        s += '<g><title>' + esc(it.label) + ' — ' + esc(fmtShort(v)) + '</title>' +
          '<rect x="' + barX + '" y="' + (yMid - 10).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="20" rx="3" fill="' + color + '" /></g>';
      }
      s += '<text x="' + (barX + bw + 8).toFixed(1) + '" y="' + (yMid + 4).toFixed(1) + '" font-size="12" font-weight="600" fill="' + C.ink + '">' +
        esc(fmtShort(v)) + '</text>';
    });
    s += '</svg>';
    return '<div class="chart-wrap">' + s + '</div>';
  }

  /* ---------------- Donut: komposisi ----------------
   * items: [{ label, value }] (urut terbesar dulu).
   * opts: { total, totalLabel, emptyMsg, ariaLabel }
   * Mengembalikan SVG donut + daftar legenda (swatch + label + nilai + %). */

  function donutChart(items, opts) {
    opts = opts || {};
    var list = (items || []).filter(function (it) { return (+it.value || 0) > 0; });
    var total = (typeof opts.total === 'number') ? opts.total :
      list.reduce(function (s, it) { return s + (+it.value || 0); }, 0);
    if (!list.length || total <= 0) {
      return emptyHTML(opts.emptyMsg || 'Belum ada data.');
    }
    var size = 220;
    var cx = size / 2;
    var cy = size / 2;
    var r = 78;
    var circ = 2 * Math.PI * r;
    var gap = list.length > 1 ? 2 : 0; /* celah kecil antar segmen */
    var offset = 0;

    var s = '<svg class="chart-svg donut-svg" viewBox="0 0 ' + size + ' ' + size +
      '" role="img" aria-label="' + esc(opts.ariaLabel || 'Grafik donut komposisi.') + '">';
    /* Latar cincin penuh */
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + C.track + '" stroke-width="34" />';
    list.forEach(function (it, i) {
      var frac = (+it.value || 0) / total;
      var len = Math.max(0, frac * circ - gap);
      var color = DONUT_COLORS[i % DONUT_COLORS.length];
      var pctLabel = Math.round(frac * 100) + '%';
      s += '<g><title>' + esc(it.label) + ' — ' + esc(fmtShort(it.value)) + ' (' + pctLabel + ')</title>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color +
        '" stroke-width="34" stroke-dasharray="' + len.toFixed(1) + ' ' + (circ - len).toFixed(1) +
        '" stroke-dashoffset="' + (-offset).toFixed(1) +
        '" transform="rotate(-90 ' + cx + ' ' + cy + ')" /></g>';
      offset += frac * circ;
    });
    /* Teks tengah: total + label */
    s += '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" font-size="19" font-weight="800" fill="' + C.ink + '">' +
      esc(fmtShort(total)) + '</text>';
    s += '<text x="' + cx + '" y="' + (cy + 18) + '" text-anchor="middle" font-size="11" fill="' + C.muted + '">' +
      esc(opts.totalLabel || 'Total') + '</text>';
    s += '</svg>';

    var legend = '<ul class="donut-legend">' + list.map(function (it, i) {
      var frac = (+it.value || 0) / total;
      var color = DONUT_COLORS[i % DONUT_COLORS.length];
      return '<li><i class="sw" style="background:' + color + '"></i>' +
        '<span class="dl-label">' + esc(it.label) + '</span>' +
        '<span class="dl-pct">' + Math.round(frac * 100) + '%</span>' +
        '<span class="dl-val">' + esc(fmtShort(it.value)) + '</span></li>';
    }).join('') + '</ul>';

    return '<div class="chart-wrap donut-wrap">' + s + legend + '</div>';
  }

  return {
    COLORS: C,
    DONUT_COLORS: DONUT_COLORS,
    cashflowChart: cashflowChart,
    occupancyChart: occupancyChart,
    hBarChart: hBarChart,
    donutChart: donutChart
  };
});
