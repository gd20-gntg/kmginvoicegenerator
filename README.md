# Invoice Generator — Melanao & Omoji

Web app buat admin generate invoice DP / Lunas untuk Melanao & Omoji,
langsung preview, download PDF, sinkron ke database Notion **INVOICE 2026**,
dan lihat daftar invoice yang udah pernah dibuat per bulan.

## Isi project
```
index.html                               → halaman utama (tab: Buat Invoice / Daftar Invoice)
style.css                                → styling
app.js                                   → logic form, kalkulasi, preview, PDF, daftar invoice
netlify/functions/save-invoice.mts       → backend: nulis invoice baru ke Notion
netlify/functions/list-invoices.mts      → backend: ambil daftar invoice per bulan dari Notion
netlify/functions/update-payment-status.mts → backend: tandai DP/Lunas + catat ke Cashflow CV
netlify/functions/get-invoice-items.mts  → backend: tarik ulang item dari invoice DP saat lanjut ke Invoice Lunas
netlify/functions/delete-invoice.mts     → backend: arsipkan (soft-delete) invoice di Notion
assets/                                  → logo & QR code (perlu kamu isi manual, lihat assets/README.md)
```

## 1. Siapin assets
Baca `assets/README.md` — download logo Melanao, logo Omoji, dan QR code BCA dari
Notion, rename, taruh di folder `assets/`.

## 2. Bikin Notion Integration
1. Buka https://www.notion.so/profile/integrations → **New integration**.
2. Kasih nama (misal "Invoice Generator"), workspace = workspace CV Karya Mudra
   Gemilang kamu, capabilities: centang **Read content**, **Insert content**,
   **Update content**.
3. Setelah dibuat, copy **Internal Integration Secret** (diawali `secret_...`) —
   ini yang nanti jadi `NOTION_TOKEN`.
4. Buka database **INVOICE 2026** di Notion → klik `···` di kanan atas →
   **Connections** → connect ke integration yang barusan dibuat. Ini wajib,
   kalau kelewat nanti API-nya error 401/403 pas nyimpen.

## 3. Deploy ke Netlify
Paling gampang lewat GitHub:
1. Push folder ini ke repo GitHub baru.
2. Di Netlify → **Add new site → Import an existing project** → pilih repo itu.
3. Build command: kosongin. Publish directory: `.` (udah otomatis kebaca dari
   `netlify.toml`).
4. Deploy.

*(Drag-and-drop manual di Netlify Drop TIDAK bisa dipakai untuk app ini karena
fitur "Simpan ke Notion" butuh serverless function — harus lewat Git deploy atau
Netlify CLI `netlify deploy`.)*

## 4. Set Environment Variables
Di Netlify: **Site configuration → Environment variables**, tambahin:

| Key | Value |
|---|---|
| `NOTION_TOKEN` | secret integration dari langkah 2 |
| `NOTION_DATA_SOURCE_ID` | `2e2ca0f3-d681-80fc-b823-000b45bfb140` (udah default, cuma perlu diisi kalau database-nya pindah) |
| `NOTION_CASHFLOW_DATA_SOURCE_ID` | `342ca0f3-d681-82c5-b915-0708d152c4d8` (udah default juga, data source database "Cashflow CV") |
| `ADMIN_PASSCODE` | passcode bebas, ini yang diketik admin pas klik "Simpan ke Notion" — biar ga sembarang orang yang tau link web app-nya bisa nulis ke Notion kamu |

Redeploy setelah env var ke-set. **Penting:** integration Notion-nya juga perlu di-connect ke database **Cashflow CV** juga (bukan cuma INVOICE 2026) — caranya sama, buka database Cashflow CV → `···` → Connections → connect ke integration yang sama.

## Cara pakai
1. Pilih Brand, lalu **Jenis Dokumen**: Quotation atau Invoice (kalau Invoice, pilih lagi DP / Lunas).
2. Isi info klien, item/jasa (bisa lebih dari satu baris), biaya tambahan kalau ada.
3. Preview di kanan otomatis update — layoutnya otomatis nyesuaiin sama jenis dokumennya (Quotation gak ada Due Date & DP split, cuma Total Quotation).
4. **Download PDF** → dokumen langsung ke-download, siap dikirim ke klien.
5. **Simpan ke Notion** → masukin passcode admin → dokumen otomatis kebuat sebagai
   row baru di database INVOICE 2026, lengkap dengan isi dokumennya juga.

### DP vs Lunas: 1 klien = 1 row, dokumennya bisa 1 atau 2
Dua pilihan di "Jenis Invoice" itu buat dua skenario pembayaran yang beda:
- **Invoice DP** — klien bayar sebagian dulu (uang muka), sisanya nanti. Ini
  cuma langkah pertama; masih ada dokumen susulan pas pelunasan.
- **Invoice Lunas** — dokumen yang menyelesaikan pembayaran. Dipakai buat DUA
  kondisi: (a) klien **langsung bayar penuh dari awal** tanpa DP sama sekali
  (isi 0 di "DP yang Sudah Diterima", kosongin link Notion — otomatis cuma
  jadi 1 dokumen/1 row), atau (b) klien **melunasi sisa tagihan** setelah
  sebelumnya DP (isi nominal DP yang udah masuk + link ke invoice DP-nya,
  paling gampang lewat tombol "Lanjut ke Pelunasan" di bawah).

Jadi: klien yang bayar lunas langsung → cuma 1 invoice/1 row. Klien yang DP
dulu → 2 dokumen (Invoice DP, lalu Invoice Lunas), tapi tetap **1 row yang
sama** di Notion (dokumen keduanya numpuk di page yang sama), bukan 2 row
terpisah.

### Nyambungin Quotation → Invoice DP → Invoice Lunas
Supaya satu klien/project cuma jadi 1 row di Notion (bukan dobel-dobel), tiap
kali lanjut ke tahap berikutnya tempel link page Notion dari dokumen
sebelumnya di field **"Sinkron Notion (opsional)"**. Nanti yang diupdate row
yang sama: dokumen baru ditambahin di bawah dokumen sebelumnya di page yang
sama, dan properti yang relevan (misal DP) ikut ke-update. Kalau field itu
dikosongin, tetap akan dibuatkan row baru.

Buat lanjut dari **Invoice DP ke Invoice Lunas**, gak perlu copy-paste
link manual — di tab Daftar Invoice, invoice yang statusnya "DP Masuk" ada
tombol **"Lanjut ke Pelunasan"**. Klik itu, otomatis pindah ke form Buat
Invoice dengan Brand, Jenis Invoice (Lunas), Nama Klien, link Notion,
dan nominal DP udah ke-prefill — **tabel item-nya juga otomatis ditarik ulang**
dari isi invoice DP-nya di Notion (lewat `get-invoice-items.mts`), jadi gak
perlu ketik ulang manual. Tinggal lengkapin contact person, dan tambahin
item/biaya baru kalau ada (misal overtime, belanja bahan tambahan). Kalau
gagal ditarik (misal formatnya gak biasa), tinggal isi manual — form tetap
kepakai normal. Kalau kamu isi "DP yang Sudah Diterima" tapi belum isi link
(baik manual maupun lewat tombol ini), ada konfirmasi pop-up dulu biar gak
kejadian tanpa sadar bikin row baru yang terpisah — konfirmasi ini gak
muncul kalau "DP yang Sudah Diterima"-nya 0 (berarti emang lunas langsung).

### Tab "Daftar Invoice"
Nampilin semua invoice di database INVOICE 2026 untuk bulan & tahun yang
dipilih (default: bulan berjalan) — lengkap sama ringkasan jumlah invoice,
total nilai, dan status Lunas/Belum Lunas. Klik "Buka" di tiap baris buat
langsung ke page Notion-nya. Pakai passcode admin yang sama, sekali masuk
langsung kepakai buat sisa sesi (gak perlu masukin ulang tiap ganti bulan).

Ada juga:
- **Urutkan** — dropdown "Terbaru dulu" / "Terlama dulu", berdasarkan tanggal invoice.
- **Cari** — kotak search buat cari nama klien atau brand, jalan bareng sama filter Brand/Status yang udah ada.
- **Hapus** — tiap baris ada tombol "Hapus", bakal minta konfirmasi dulu.
  Yang kejadi bukan hapus permanen, tapi **archived** di Notion (masuk Trash
  Notion, masih bisa dipulihkan manual dari situ kalau salah hapus) —
  begitu diarsipkan, otomatis ilang dari daftar invoice di web app ini.

### Tandai status pembayaran ≠ bikin dokumen baru
Ini beda hal sama "Jenis Invoice" di atas. Tab Daftar Invoice punya tombol
buat **nyatet uangnya udah beneran masuk** (bookkeeping), bukan buat generate
PDF baru:
- **Belum Bayar** → "Tandai DP" atau "Tandai Lunas"
- **DP Masuk** → "Tandai Lunas" atau "Batalkan DP" (buat koreksi)
- **Lunas** → "Batalkan Lunas" (buat koreksi)

Klik salah satu, isi tanggal pembayarannya (default hari ini), lalu Simpan —
langsung update `DP Status`/`DP Date` atau `Pelunasan Status`/`Full Payment Date`
di Notion, dan daftar invoice-nya auto-refresh.

### Auto-catat ke Cashflow CV
Begitu "Tandai DP" atau "Tandai Lunas" berhasil, sistem juga otomatis bikin
1 row baru di database **Cashflow CV** (Jenis Transaksi = Income), dengan:
- **Nama Transaksi**: `{DP/Pelunasan/Full Payment} - {Nama Klien} - {tanggal}`
- **Kategori Pemasukan**: `DP` (pas tandai DP), `Settlement` (pas tandai Lunas
  dan sebelumnya ada DP), atau `Full Payment` (pas tandai Lunas tapi gak ada
  DP sama sekali)
- **Nominal**: nominal yang beneran masuk saat itu — DP amount pas tandai DP,
  atau sisa tagihan (total - DP) pas tandai Lunas kalau sebelumnya ada DP,
  atau total penuh kalau langsung lunas tanpa DP
- **Brand**, **Kategori** (Project Photoshoot untuk Melanao / Kelas/Workshop
  untuk Omoji), **Tanggal Transaksi**, **Bulan Income** — semuanya ikut keisi

Kalau pencatatan ke Cashflow CV gagal (misal integration belum di-connect ke
database itu), status invoice-nya tetap kesimpan, cuma bakal ada pesan warning
di layar biar kamu tau perlu nambahin manual. Klik "Batalkan DP"/"Batalkan
Lunas" cuma ngebalikin status invoice-nya — row Cashflow yang udah kebuat
gak otomatis kehapus, jadi kalau salah klik perlu dihapus manual di Notion.

## Yang belum di-handle (v1)
- Relasi **Project** dan **👥 CRM Kontak** di Notion belum otomatis ke-link —
  masih perlu di-link manual di Notion kalau perlu.
- Varian invoice Omoji (Soap Series, Natural Cosmetic) belum ada template
  khusus di generator ini — kalau perlu, tinggal bilang aja nanti ditambahin.
- Daftar Invoice cuma bisa difilter per bulan/tahun/status, belum ada search
  per nama klien.
