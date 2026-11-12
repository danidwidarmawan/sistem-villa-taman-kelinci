# Sistem Villa Taman Kelinci

Web app statis (tanpa build step, tanpa framework, tanpa CDN) untuk operasional
harian Villa Taman Kelinci — reservasi, keuangan, leads, kalender, dan dashboard
monitoring. Di-host gratis di GitHub Pages.

- **URL live:** https://danidwidarmawan.github.io/sistem-villa-taman-kelinci/
- **Repo kode (publik):** `danidwidarmawan/sistem-villa-taman-kelinci`
- **Repo data (privat):** `danidwidarmawan/sistem-villa-taman-kelinci-data`
  (berisi `data.json` — JANGAN PERNAH dipublikasikan: berisi nama tamu,
  nomor WhatsApp, dan data keuangan.)

## Cara kerja

Aplikasi ini statis, jadi data disimpan sebagai file `data.json` di repo
privat terpisah dan disinkronkan lewat GitHub REST API dari browser:

- **Buka:** tampilkan cache lokal dulu (cepat, bisa offline), lalu sinkron di
  latar belakang.
- **Simpan:** simpan lokal dulu, lalu dorong ke GitHub (PUT contents API
  dengan `sha` terakhir). Gagal jaringan tidak pernah menghilangkan edit —
  perubahan ditandai "belum tersinkron" dan bisa dicoba lagi.
- **Konflik (409):** aplikasi TIDAK menimpa. Versi terbaru diambil, pengguna
  memilih: muat ulang versi terbaru (edit lokal dicadangkan), timpa dengan
  versi sendiri, atau tunda.

## Cara membuat token (sekali saja)

1. Buka https://github.com/settings/personal-access-tokens
   lalu klik **Generate new token**.
2. Pada **Repository access**, pilih **Only select repositories** lalu pilih
   repo `sistem-villa-taman-kelinci-data` saja.
3. Pada **Permissions → Repository permissions → Contents**, pilih
   **Read and write**, lalu generate dan salin tokennya.
4. Tempel token di layar setup aplikasi (atau Pengaturan → Koneksi).

Token hanya disimpan di `localStorage` browser perangkat itu dan tidak pernah
dikirim ke mana pun selain `api.github.com`. Jangan membagikan token atau
menulisnya ke file/repo mana pun.

Tanpa token, aplikasi tetap bisa dibuka dalam **mode demo** (data master saja,
perubahan tidak tersimpan) atau **offline** dari data tersimpan di perangkat.

## Fitur Tahap 1

- **Dashboard:** KPI bulanan (booking check-in, malam terisi, okupansi, leads,
  uang masuk/keluar terverifikasi, arus kas bersih, sisa tagihan), kinerja
  sumber lead, daftar perlu tindakan, check-in berikutnya, transaksi terakhir,
  biaya tetap & titik impas.
- **Reservasi:** tambah/ubah/hapus, hitung otomatis (malam, total, terbayar
  dari transaksi terverifikasi, sisa, status bayar), saran tarif
  peak/weekend/weekday, peringatan bentrok tanggal & kapasitas, info DP 50%
  dan jatuh tempo H-3.
- **Keuangan:** transaksi masuk/keluar, kategori, status verifikasi,
  ringkasan per bulan, ekspor CSV.
- **Leads:** tambah/ubah/hapus, status & alasan kalah, badge follow-up
  terlewat, tombol "Jadikan reservasi".
- **Kalender:** tampilan bulan (terisi/kosong, peak, weekend, kapasitas),
  detail per hari, daftar reservasi bulan ini.
- **Pengaturan:** tarif, periode peak, harga katering, kebijakan DP,
  definisi weekend, koneksi GitHub, ekspor/impor JSON, reset ke data master,
  kamar & menu katering (baca-saja), template WhatsApp (salin teks).

## Struktur file

| File | Isi |
| --- | --- |
| `index.html` | Struktur + shell SPA (navigasi hash `#/dashboard` dst) |
| `styles.css` | Seluruh styling (mobile-first) |
| `logic.js` | Logika hitung murni (tanpa DOM) — bisa diuji di Node |
| `app.js` | UI + sinkronisasi GitHub API |
| `seed.json` | Data master (tarif, kamar, katering, template WA) — tanpa transaksi |
| `.nojekyll` | Agar GitHub Pages menyajikan file apa adanya |

## Pengembangan lokal

Tidak ada build step. Jalankan server statis apa pun dari direktori ini, misal:

```sh
python3 -m http.server 8000
```

lalu buka http://localhost:8000/.

Cek sintaks:

```sh
node --check logic.js && node --check app.js
```

## Tahap 2 (belum dikerjakan)

Modul Operasional (tugas/checklist), Maintenance, Inventaris, Pemasaran,
Tamu & Ulasan, Pesanan Katering, kalkulator Paket Segmen & Paket Peak,
Analisis Promo, edit kamar/menu katering, dan modul Template WA.
Struktur data untuk modul-modul itu sudah disiapkan di `data.json`
(`tasks`, `maintenance`, `inventory`, `marketing`, `guests`,
`cateringOrders`) — saat ini masih kosong.
