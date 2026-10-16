# Analitik admin

Service terpisah untuk analisa pengguna dan penggunaan platform. Tidak mengubah data; hanya membaca database yang sama dengan `backend/`.

## Menjalankan

```bash
cp .env.example .env   # isi ANALITIK_DATABASE_URL dan ADMIN_EMAILS
cargo run
```

## Akses

Login lewat aplikasi utama seperti biasa, lalu kirim token sesi:

```
Authorization: Bearer <token>
```

Hanya email yang ada di `ADMIN_EMAILS` yang diterima. Pengguna lain mendapat 403.

## Endpoint

| Metode | Path | Keterangan |
|---|---|---|
| GET | `/api/v1/analitik/kesehatan` | Cek hidup. Tanpa login. |
| GET | `/api/v1/analitik/ringkasan` | Total pengguna, organisasi, transaksi, pengguna aktif 30 hari, langganan aktif per paket |
| GET | `/api/v1/analitik/pendaftaran?dari=YYYY-MM-DD&sampai=YYYY-MM-DD` | Pendaftaran pengguna baru per hari |
| GET | `/api/v1/analitik/transaksi?dari=YYYY-MM-DD&sampai=YYYY-MM-DD` | Jumlah transaksi per hari |

Rentang tanggal maksimal 366 hari.

## Keamanan

- Buat user MySQL khusus dengan hak `SELECT` saja, dan pakai itu di `ANALITIK_DATABASE_URL`.
- Service ini tidak menampilkan data pribadi (nama, email, isi transaksi). Hanya agregat.
- Jalankan di belakang jaringan internal atau proxy dengan akses terbatas. Jangan dibuka publik tanpa perlindungan tambahan.
