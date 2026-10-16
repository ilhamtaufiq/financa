# Dasbor admin

Service frontend terpisah untuk melihat analitik platform. Tidak ada di `frontend/` maupun `backend/`.

Rencana domain produksi: **https://financa-dash.cianjur.space**

Dasbor berbicara dengan dua service:
- **backend** (`backend/`): login lewat `POST /api/v1/auth/masuk`
- **analitik** (`analitik/`): data agregat lewat `/api/v1/analitik/*`

## Menjalankan (lokal)

```bash
cp .env.example .env.local
npm install
npm run dev        # http://localhost:5174
```

Agar browser boleh memanggil kedua service, tambahkan origin dasbor.

Lokal:
- Backend: `CORS_ORIGIN=http://localhost:4322,http://localhost:5174`
- Analitik: `ANALITIK_CORS_ORIGIN=http://localhost:5174`

Produksi:
- Backend: `CORS_ORIGIN` menyertakan `https://financa-dash.cianjur.space`
- Analitik: `ANALITIK_CORS_ORIGIN=https://financa-dash.cianjur.space`

## Akses

Masuk dengan akun yang emailnya ada di `ADMIN_EMAILS` (analitik). Akun lain bisa login, tetapi data analitik ditolak (403).

Token disimpan di `sessionStorage`, jadi hilang saat tab ditutup.

## Build

```bash
npm run build      # keluaran di dist/
```
