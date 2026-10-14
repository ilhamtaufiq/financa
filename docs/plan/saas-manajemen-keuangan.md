# Plan: SaaS Manajemen Keuangan (Cendera)

Status: draft v2. Stack sudah dikonfirmasi. Dibuat dari analisa modul yang sudah ada di `arumanis-hq`.

## 1. Ringkasan

SaaS pencatatan dan pelaporan keuangan untuk perorangan atau pelaku usaha, dikembangkan oleh Cendera dan ditawarkan di bawah Cianjur Space (lihat `landing-page/src/pages/index.astro`, yang sudah menyiapkan bagian "Produk SaaS buatan Cendera").

Fokus MVP: pencatatan transaksi harian, saldo per rekening/kas, kategori, dan laporan bulanan yang bisa diekspor.

## 2. Stack

| Lapisan | Pilihan | Catatan |
|---|---|---|
| Backend | Rust, axum 0.8, sqlx 0.8 (driver MySQL, kompatibel MariaDB), tokio | Pola sudah ada di `apiamis/rust` (workspace `api`, `auth`, `shared`). |
| Frontend | Astro + React island + Tailwind, PWA offline-first (Dexie) | Basis shell dari `jurnal/frontend`. |
| Database | MariaDB | Migrasi dengan `sqlx migrate`. Prefiks tabel `fn_`. |
| Deploy | Docker (image backend dan frontend terpisah), Coolify | Pola mengikuti `apiamis/Dockerfile` dan `docker/onlyoffice/docker-compose.coolify.yml`. |
| Brand | Cendera / Cianjur Space | Token warna dari `landing-page/design-system/cianjur-space/MASTER.md`. |

## 3. Analisa MVP yang tersedia (reuse)

| Sumber | Yang bisa dipakai | Catatan |
|---|---|---|
| `apiamis/rust` | Struktur workspace, konfigurasi axum + sqlx, middleware (`tower-http`: cors, timeout, request-id), crate `auth` | Crate `auth` perlu dicek dulu: apakah bisa dipakai untuk token tanpa Laravel Sanctum. |
| `apiamis/Dockerfile` (rust stage) | Multi-stage build `rust:1-bookworm` lalu `debian:bookworm-slim`, user `nobody` | Pola build yang sudah terbukti. |
| `jurnal/frontend` | Shell mobile-first, PWA, service worker, api client + mock adapter, halaman login | M1 sudah jalan (`npm run build` lolos). Auth perlu disesuaikan dari Sanctum ke token backend Rust. |
| `landing-page` (Astro) | Halaman Cianjur Space dan bagian produk SaaS | Tempat listing produk setelah MVP siap. |
| `landing-page/design-system/cianjur-space/MASTER.md` | Token warna gelap, hijau `#00d40e`, kontras WCAG | Brand Cendera. |

Kesimpulan: backend dan deploy mengikuti pola `apiamis/rust`. Frontend mengikuti pola `jurnal/frontend`. Tidak ada komponen Laravel atau PHP di MVP ini.

## 4. Scope MVP

In scope:
- Auth: daftar, masuk, lupa password. Token dikeluarkan backend Rust.
- Organisasi/tenant: satu akun bisa punya beberapa organisasi, data terisolasi per organisasi.
- Rekening/kas: buat, ubah, arsipkan. Saldo awal dan saldo berjalan.
- Transaksi: catat pemasukan dan pengeluaran, kategori, tanggal, catatan, lampiran opsional.
- Transfer antar rekening.
- Kategori: default (seed) dan kustom.
- Laporan: ringkasan bulanan, arus kas per rekening, laba rugi sederhana.
- Ekspor CSV untuk transaksi dan laporan.
- Langganan: paket dasar dicatat manual (belum ada payment gateway).
- Deploy: backend dan frontend sebagai container di Coolify, dengan MariaDB terkelola di Coolify.

Out of scope (MVP):
- Penggajian, faktur AR/AP lengkap, pajak (PPN/PPh), multi-mata uang, integrasi bank otomatis, payment gateway otomatis.

## 5. Asumsi (perlu dikonfirmasi)

- Target awal: perorangan dan pelaku usaha di Cianjur, bahasa Indonesia, Rupiah saja.
- Deploy: Coolify di VPS. Domain dan SSL dikelola Coolify.
- Nama produk belum ditentukan. Sementara pakai nama kerja `financa`.
- Model harga belum ditentukan. MVP tidak menagih otomatis.

## 6. Langkah

### Step 1 — Dokumen kebutuhan & skema data
Susun PRD ringkas dan skema tabel MariaDB: organisasi, pengguna, keanggotaan, rekening, kategori, transaksi, transfer, periode laporan. Pakai prefiks `fn_`.
- Acceptance: skema lengkap dengan foreign key dan index per organisasi; migrasi `sqlx` bisa di-revert.
- Out of scope: penggajian, faktur, pajak.

### Step 2 — Migrasi & model multi-tenant (Rust)
Buat migrasi `sqlx` dan repository dengan filter `organisasi_id` pada setiap query.
- Acceptance: tidak ada query lintas organisasi; test isolasi data lolos terhadap MariaDB; migrasi up dan down bersih.

### Step 3 — API transaksi, rekening, dan transfer (Rust)
Endpoint axum CRUD rekening, kategori, transaksi, dan transfer. Saldo dihitung di server dalam transaksi DB.
- Acceptance: saldo rekening sama dengan saldo awal ditambah jumlah transaksi; transfer menghasilkan dua entri yang seimbang; validasi input lolos.

### Step 4 — Laporan & ekspor (Rust)
Endpoint ringkasan bulanan, arus kas per rekening, laba rugi sederhana, dan ekspor CSV.
- Acceptance: total laporan cocok dengan jumlah transaksi pada periode yang sama; CSV bisa dibuka di spreadsheet.

### Step 5 — Frontend PWA Astro (basis jurnal)
Salin shell dari `jurnal/frontend`, ganti brand ke Cendera, sesuaikan auth ke token backend Rust, lalu buat halaman rekening, input transaksi cepat, dan daftar transaksi.
- Acceptance: input transaksi berjalan offline dan sinkron saat online; build Astro lolos; kontras sesuai `MASTER.md`.

### Step 6 — Keamanan & audit
Review auth token, rate limit login, validasi tenant di setiap endpoint, dan log perubahan transaksi.
- Acceptance: tidak ada endpoint tanpa cek tenant; tidak ada secret di repo; perubahan transaksi tercatat.

### Step 7 — Deploy Docker via Coolify
Buat Dockerfile multi-stage untuk backend (pola `apiamis/Dockerfile`) dan frontend, lalu konfigurasi resource di Coolify: env, health check, dan backup MariaDB.
- Acceptance: kedua container jalan di Coolify; health check hijau; backup MariaDB terjadwal dan bisa dipulihkan; tidak ada secret di image.

### Step 8 — Listing produk & uji MVP
Tambahkan produk ke landing-page Cendera, lalu uji dengan 2–3 pengguna pilot.
- Acceptance: halaman produk tayang; checklist uji pilot selesai; daftar temuan tercatat.

## 7. Risiko

- Ketidakkonsistenan saldo jika transaksi dan transfer tidak atomik. Mitigasi: transaksi DB dan test saldo.
- Data antar tenant bocor. Mitigasi: filter `organisasi_id` wajib di repository dan test isolasi.
- Perbedaan perilaku MariaDB dan MySQL pada tipe data desimal atau tanggal. Mitigasi: test integrasi terhadap MariaDB asli, bukan mock.
- Scope melebar ke pajak dan penggajian. Mitigasi: daftar out-of-scope di atas.

## 8. Lampiran: perintah orchestrate

Dibuat oleh `/ecc:plan-orchestrate` (mode plugin). Jalankan per step saat siap, mulai dari Step 1.

| # | Tags | Chain |
|---|---|---|
| 1 | db | `ecc:database-reviewer,ecc:code-reviewer` |
| 2 | impl, db | `ecc:tdd-guide,ecc:database-reviewer,ecc:rust-reviewer` |
| 3 | impl | `ecc:tdd-guide,ecc:rust-reviewer` |
| 4 | impl | `ecc:tdd-guide,ecc:rust-reviewer` |
| 5 | impl | `ecc:tdd-guide,ecc:typescript-reviewer` |
| 6 | security | `ecc:security-reviewer,ecc:rust-reviewer` |
| 7 | build | `ecc:build-error-resolver` |
| 8 | impl, test | `ecc:tdd-guide,ecc:e2e-runner,ecc:typescript-reviewer` |

```bash
/ecc:orchestrate custom "ecc:database-reviewer,ecc:code-reviewer" "[Plan: docs/plan/saas-manajemen-keuangan.md#step-1] Susun PRD ringkas dan skema tabel MariaDB SaaS keuangan: organisasi, pengguna, keanggotaan, rekening, kategori, transaksi, transfer, periode laporan, dengan prefiks fn_; Acceptance: skema lengkap dengan foreign key dan index per organisasi; migrasi sqlx bisa di-revert; Out of scope: penggajian, faktur, pajak"
/ecc:orchestrate custom "ecc:tdd-guide,ecc:database-reviewer,ecc:rust-reviewer" "[Plan: docs/plan/saas-manajemen-keuangan.md#step-2] Buat migrasi sqlx dan repository Rust untuk tabel fn_* dengan filter organisasi_id di setiap query; Acceptance: tidak ada query lintas organisasi; test isolasi data lolos terhadap MariaDB; migrasi up dan down bersih"
/ecc:orchestrate custom "ecc:tdd-guide,ecc:rust-reviewer" "[Plan: docs/plan/saas-manajemen-keuangan.md#step-3] Implementasi endpoint axum CRUD rekening, kategori, transaksi, dan transfer; saldo dihitung di server dalam transaksi DB; Acceptance: saldo rekening sama dengan saldo awal ditambah jumlah transaksi; transfer menghasilkan dua entri seimbang; validasi input lolos"
/ecc:orchestrate custom "ecc:tdd-guide,ecc:rust-reviewer" "[Plan: docs/plan/saas-manajemen-keuangan.md#step-4] Implementasi endpoint axum ringkasan bulanan, arus kas per rekening, laba rugi sederhana, dan ekspor CSV; Acceptance: total laporan cocok dengan jumlah transaksi periode yang sama; CSV bisa dibuka di spreadsheet"
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: docs/plan/saas-manajemen-keuangan.md#step-5] Bangun frontend Astro PWA dari basis shell jurnal/frontend dengan brand Cendera; sesuaikan auth ke token backend Rust; halaman rekening, input transaksi cepat, daftar transaksi; Acceptance: input transaksi berjalan offline dan sinkron saat online; build Astro lolos; kontras sesuai landing-page/design-system/cianjur-space/MASTER.md"
/ecc:orchestrate custom "ecc:security-reviewer,ecc:rust-reviewer" "[Plan: docs/plan/saas-manajemen-keuangan.md#step-6] Review keamanan token auth, rate limit login, validasi tenant di setiap endpoint, dan log perubahan transaksi; Acceptance: tidak ada endpoint tanpa cek tenant; tidak ada secret di repo; perubahan transaksi tercatat"
/ecc:orchestrate custom "ecc:build-error-resolver" "[Plan: docs/plan/saas-manajemen-keuangan.md#step-7] Buat Dockerfile multi-stage backend dan frontend mengikuti pola apiamis/Dockerfile, lalu konfigurasi di Coolify: env, health check, backup MariaDB; Acceptance: kedua container jalan di Coolify; health check hijau; backup MariaDB terjadwal dan bisa dipulihkan; tidak ada secret di image"
/ecc:orchestrate custom "ecc:tdd-guide,ecc:e2e-runner,ecc:typescript-reviewer" "[Plan: docs/plan/saas-manajemen-keuangan.md#step-8] Tambahkan produk SaaS ke landing-page Cendera lalu jalankan uji pilot dengan 2 sampai 3 pengguna; Acceptance: halaman produk tayang; checklist uji pilot selesai; daftar temuan tercatat"
```
