use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, FromRequestParts, Multipart, Path, Query, State};
use axum::http::{header, request::Parts, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::MySqlPool;

use crate::auth::{self, PembatasMasuk};
use crate::bukti::{self, BATAS_BUKTI};
use crate::csv::{self, BOM_UTF8};
use crate::db::{self, OrganisasiSaya};
use crate::error::Error;
use crate::laporan::{ArusKasRekening, LabaRugi, RingkasanBulanan};
use crate::model::{
    Bukti, Kategori, NewKategori, NewRekening, NewTransaksi, NewTransfer, Organisasi, Peran,
    Rekening, TipeTransaksi, Transaksi, Transfer,
};
use crate::pengirim::{Pengirim, PengirimNonaktif};
use crate::Tenant;

#[derive(Clone)]
pub struct AppState {
    pub pool: MySqlPool,
    pub pembatas: Arc<PembatasMasuk>,
    pub pengirim: Arc<dyn Pengirim>,
    /// URL halaman reset di frontend. Token ditambahkan sebagai `?token=`.
    pub tautan_reset: String,
    /// `None` jika model OCR belum ada. Endpoint baca struk menjawab 503, API lain tetap jalan.
    pub pembaca: Option<Arc<crate::ocr::Pembaca>>,
    /// Folder penyimpanan berkas bukti transaksi (BUKTI_DIR).
    pub folder_bukti: std::path::PathBuf,
}

#[derive(Debug)]
pub enum ApiError {
    Domain(Error),
    SesiTidakValid,
    KredensialSalah,
    Dilarang,
    TerlaluBanyakPercobaan,
    OcrTidakTersedia,
}

impl From<Error> for ApiError {
    fn from(e: Error) -> Self {
        Self::Domain(e)
    }
}

#[derive(Serialize)]
struct Galat {
    error: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, pesan) = match self {
            Self::SesiTidakValid => (StatusCode::UNAUTHORIZED, "Sesi Anda sudah berakhir. Masuk lagi untuk melanjutkan.".to_string()),
            // Pesan sama untuk email tidak terdaftar dan kata sandi salah, supaya tidak membocorkan email.
            Self::KredensialSalah => (StatusCode::UNAUTHORIZED, "email atau kata sandi salah".to_string()),
            Self::Dilarang => (StatusCode::FORBIDDEN, "Hanya owner dan admin yang bisa mengubah pengaturan ini.".to_string()),
            Self::TerlaluBanyakPercobaan => (
                StatusCode::TOO_MANY_REQUESTS,
                "Terlalu banyak percobaan. Tunggu 15 menit, lalu coba lagi.".to_string(),
            ),
            Self::OcrTidakTersedia => (
                StatusCode::SERVICE_UNAVAILABLE,
                "Pembaca struk belum tersedia di server. Isi transaksi secara manual.".to_string(),
            ),
            Self::Domain(Error::NotFound { entitas }) => {
                (StatusCode::NOT_FOUND, format!("{entitas} tidak ditemukan"))
            }
            Self::Domain(e @ (Error::JumlahTidakValid | Error::NilaiTidakValid { .. } | Error::Validasi(_))) => {
                (StatusCode::UNPROCESSABLE_ENTITY, e.to_string())
            }
            Self::Domain(e) => {
                eprintln!("error internal: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "Terjadi masalah di server. Coba lagi sebentar lagi.".to_string())
            }
        };

        (status, Json(Galat { error: pesan })).into_response()
    }
}

// ---- Autentikasi ----

fn token_dari_header(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|t| !t.is_empty())
}

/// Pengguna yang sesinya valid. Token dari header `Authorization: Bearer <token>`.
pub struct Pengguna(pub u64);

impl FromRequestParts<AppState> for Pengguna {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = token_dari_header(&parts.headers).ok_or(ApiError::SesiTidakValid)?;
        let id = db::cari_sesi(&state.pool, &auth::hash_token(token))
            .await?
            .ok_or(ApiError::SesiTidakValid)?;
        Ok(Pengguna(id))
    }
}

/// Pengguna yang sudah masuk DAN merupakan anggota organisasi pada path `{org}`.
/// Bukan anggota -> 404, supaya keberadaan organisasi lain tidak bisa ditebak.
/// Semua handler organisasi memakai extractor ini, jadi pemeriksaan tenant tidak bisa terlewat.
pub struct Anggota {
    pub organisasi_id: u64,
    pub pengguna_id: u64,
    pub peran: Peran,
}

impl FromRequestParts<AppState> for Anggota {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let Pengguna(pengguna_id) = Pengguna::from_request_parts(parts, state).await?;

        let tidak_ditemukan = || ApiError::Domain(Error::NotFound { entitas: "organisasi" });
        let Path(params) = Path::<HashMap<String, String>>::from_request_parts(parts, state)
            .await
            .map_err(|_| tidak_ditemukan())?;
        let organisasi_id = params
            .get("org")
            .and_then(|v| v.parse::<u64>().ok())
            .ok_or_else(tidak_ditemukan)?;

        let peran = db::peran_anggota(&state.pool, organisasi_id, pengguna_id)
            .await?
            .ok_or_else(tidak_ditemukan)?;

        Ok(Anggota {
            organisasi_id,
            pengguna_id,
            peran: Peran::parse(&peran)?,
        })
    }
}

fn wajib_kelola(a: &Anggota) -> Result<(), ApiError> {
    if a.peran.boleh_kelola() {
        Ok(())
    } else {
        Err(ApiError::Dilarang)
    }
}

fn nama_valid(nama: &str) -> Result<(), ApiError> {
    if nama.trim().is_empty() {
        return Err(Error::Validasi("nama tidak boleh kosong".to_string()).into());
    }
    Ok(())
}

fn email_valid(email: &str) -> Result<String, ApiError> {
    let bersih = email.trim().to_lowercase();
    let ada_at = bersih
        .split_once('@')
        .map(|(lokal, domain)| !lokal.is_empty() && domain.contains('.'))
        .unwrap_or(false);
    if bersih.len() > 190 || !ada_at {
        return Err(Error::Validasi("email tidak valid".to_string()).into());
    }
    Ok(bersih)
}

fn kata_sandi_valid(kata_sandi: &str) -> Result<(), ApiError> {
    let panjang = kata_sandi.chars().count();
    if (8..=128).contains(&panjang) {
        Ok(())
    } else {
        Err(Error::Validasi("kata sandi harus 8 sampai 128 karakter".to_string()).into())
    }
}

fn client_uuid_valid(nilai: Option<&str>) -> Result<Option<String>, ApiError> {
    match nilai {
        None => Ok(None),
        Some(u) => uuid::Uuid::parse_str(u)
            .map(|parsed| Some(parsed.to_string()))
            .map_err(|_| Error::Validasi("client_uuid harus berupa UUID".to_string()).into()),
    }
}

#[derive(Deserialize)]
pub struct DaftarBaru {
    pub nama: String,
    pub email: String,
    pub kata_sandi: String,
}

#[derive(Deserialize)]
pub struct MasukBaru {
    pub email: String,
    pub kata_sandi: String,
}

#[derive(Deserialize)]
pub struct LupaBaru {
    pub email: String,
}

#[derive(Deserialize)]
pub struct ResetBaru {
    pub token: String,
    pub kata_sandi_baru: String,
}

#[derive(Serialize)]
pub struct PenggunaRingkas {
    pub id: u64,
    pub nama: String,
    pub email: String,
}

#[derive(Serialize)]
pub struct SesiBaru {
    pub token: String,
    pub kedaluwarsa: DateTime<Utc>,
    pub pengguna: PenggunaRingkas,
}

async fn daftar(
    State(st): State<AppState>,
    Json(body): Json<DaftarBaru>,
) -> Result<StatusCode, ApiError> {
    nama_valid(&body.nama)?;
    let email = email_valid(&body.email)?;
    kata_sandi_valid(&body.kata_sandi)?;

    // Respons selalu 202 dan hash selalu dihitung, supaya tidak ada perbedaan yang bisa dipakai
    // untuk menebak email. Yang berbeda hanya email yang dikirim ke pemilik alamat.
    let hash = auth::hash_kata_sandi(&body.kata_sandi)?;
    let nama = body.nama.trim().to_string();

    let (subjek, isi) = if db::cari_pengguna_by_email(&st.pool, &email).await?.is_some() {
        (
            "Pendaftaran Financa",
            "Ada yang mencoba mendaftar dengan alamat email ini. Jika itu Anda, silakan masuk. \
             Jika lupa kata sandi, gunakan fitur lupa kata sandi. Jika bukan Anda, abaikan email ini."
                .to_string(),
        )
    } else {
        db::buat_pengguna(&st.pool, &nama, &email, &hash).await?;
        (
            "Selamat datang di Financa",
            format!("Halo {nama},\n\nAkun Financa Anda telah dibuat. Silakan masuk untuk mulai mencatat keuangan."),
        )
    };

    // Galat pengiriman hanya dicatat (tanpa isi email); respons tetap sama.
    if let Err(e) = st.pengirim.kirim(&email, subjek, &isi).await {
        eprintln!("gagal mengirim email pendaftaran: {e}");
    }

    Ok(StatusCode::ACCEPTED)
}

async fn masuk(
    State(st): State<AppState>,
    Json(body): Json<MasukBaru>,
) -> Result<Json<SesiBaru>, ApiError> {
    let email = body.email.trim().to_lowercase();
    if !st.pembatas.boleh_mencoba(&email) {
        return Err(ApiError::TerlaluBanyakPercobaan);
    }

    let akun = db::cari_pengguna_by_email(&st.pool, &email).await?;
    // Verifikasi tetap dijalankan saat akun tidak ada, supaya waktu respons tidak membocorkan email.
    let cocok = match &akun {
        Some(a) => auth::verifikasi_kata_sandi(&body.kata_sandi, &a.password_hash),
        None => {
            auth::verifikasi_kata_sandi(&body.kata_sandi, auth::hash_dummy());
            false
        }
    };

    let akun = match akun {
        Some(a) if cocok => a,
        _ => {
            st.pembatas.catat_gagal(&email);
            return Err(ApiError::KredensialSalah);
        }
    };

    st.pembatas.reset(&email);
    let token = auth::buat_token();
    let kedaluwarsa = Utc::now() + Duration::days(auth::MASA_BERLAKU_SESI_HARI);
    db::buat_sesi(&st.pool, akun.id, &token.token_hash, kedaluwarsa).await?;

    Ok(Json(SesiBaru {
        token: token.token,
        kedaluwarsa,
        pengguna: PenggunaRingkas {
            id: akun.id,
            nama: akun.nama,
            email: akun.email,
        },
    }))
}

async fn keluar(State(st): State<AppState>, _: Pengguna, headers: HeaderMap) -> Result<StatusCode, ApiError> {
    if let Some(token) = token_dari_header(&headers) {
        db::hapus_sesi(&st.pool, &auth::hash_token(token)).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn saya(State(st): State<AppState>, Pengguna(id): Pengguna) -> Result<Json<PenggunaRingkas>, ApiError> {
    let akun = db::cari_pengguna_by_id(&st.pool, id)
        .await?
        .ok_or(ApiError::SesiTidakValid)?;
    Ok(Json(PenggunaRingkas {
        id: akun.id,
        nama: akun.nama,
        email: akun.email,
    }))
}

/// Selalu 202, apa pun hasilnya, supaya endpoint tidak bisa dipakai untuk menebak email.
/// Email hanya dikirim jika akun ada dan pembatas belum tercapai.
async fn lupa_kata_sandi(State(st): State<AppState>, Json(body): Json<LupaBaru>) -> Result<StatusCode, ApiError> {
    let email = body.email.trim().to_lowercase();
    let kunci = format!("reset:{email}");

    if st.pembatas.boleh_mencoba(&kunci) {
        st.pembatas.catat_gagal(&kunci);
        if let Some(akun) = db::cari_pengguna_by_email(&st.pool, &email).await? {
            let token = auth::buat_token();
            db::buat_reset_password(&st.pool, akun.id, &token.token_hash, Utc::now() + Duration::hours(1)).await?;
            let isi = format!(
                "Halo {},\n\nBuka tautan berikut untuk membuat kata sandi baru (berlaku 1 jam):\n{}?token={}\n\nJika Anda tidak meminta ini, abaikan email ini.",
                akun.nama, st.tautan_reset, token.token
            );
            // Galat pengiriman hanya dicatat; isi email (berisi token) tidak pernah dicetak.
            if let Err(e) = st.pengirim.kirim(&akun.email, "Reset kata sandi Financa", &isi).await {
                eprintln!("gagal mengirim email reset: {e}");
            }
        }
    }

    Ok(StatusCode::ACCEPTED)
}

async fn reset_kata_sandi(State(st): State<AppState>, Json(body): Json<ResetBaru>) -> Result<StatusCode, ApiError> {
    kata_sandi_valid(&body.kata_sandi_baru)?;
    let hash = auth::hash_kata_sandi(&body.kata_sandi_baru)?;
    let berhasil = db::pakai_reset_password(&st.pool, &auth::hash_token(&body.token), &hash).await?;
    if !berhasil {
        return Err(Error::Validasi("tautan reset tidak valid atau sudah kedaluwarsa".to_string()).into());
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---- Organisasi ----

#[derive(Deserialize)]
pub struct OrganisasiBaru {
    pub nama: String,
}

async fn daftar_organisasi(
    State(st): State<AppState>,
    Pengguna(id): Pengguna,
) -> Result<Json<Vec<OrganisasiSaya>>, ApiError> {
    Ok(Json(db::daftar_organisasi_pengguna(&st.pool, id).await?))
}

async fn buat_organisasi(
    State(st): State<AppState>,
    Pengguna(id): Pengguna,
    Json(body): Json<OrganisasiBaru>,
) -> Result<(StatusCode, Json<Organisasi>), ApiError> {
    nama_valid(&body.nama)?;
    let org = db::buat_organisasi_dengan_pemilik(&st.pool, body.nama.trim(), id).await?;
    Ok((StatusCode::CREATED, Json(org)))
}

// ---- DTO request & response ----

#[derive(Deserialize)]
pub struct UbahRekening {
    pub nama: String,
}

/// Body transaksi dari klien. `dibuat_oleh` diambil dari sesi, bukan dari body.
/// `client_uuid` opsional: UUID dari perangkat untuk mencegah duplikat saat kirim ulang.
#[derive(Deserialize)]
pub struct TransaksiBaru {
    pub rekening_id: u64,
    pub kategori_id: Option<u64>,
    pub tipe: TipeTransaksi,
    pub jumlah: Decimal,
    pub tanggal: NaiveDate,
    pub catatan: Option<String>,
    pub client_uuid: Option<String>,
}

/// Body transfer dari klien. `dibuat_oleh` diambil dari sesi, bukan dari body.
#[derive(Deserialize)]
pub struct TransferBaru {
    pub rekening_asal_id: u64,
    pub rekening_tujuan_id: u64,
    pub jumlah: Decimal,
    pub tanggal: NaiveDate,
    pub catatan: Option<String>,
    pub client_uuid: Option<String>,
}

#[derive(Deserialize)]
pub struct RentangTanggal {
    pub dari: NaiveDate,
    pub sampai: NaiveDate,
}

#[derive(Deserialize)]
pub struct PeriodeBulan {
    pub tahun: i32,
    pub bulan: u32,
}

#[derive(Serialize)]
pub struct RekeningDetail {
    #[serde(flatten)]
    pub rekening: Rekening,
    pub saldo: Decimal,
}

// ---- Handler rekening ----

async fn daftar_rekening(State(st): State<AppState>, a: Anggota) -> Result<Json<Vec<Rekening>>, ApiError> {
    Ok(Json(Tenant::new(st.pool, a.organisasi_id).daftar_rekening().await?))
}

async fn buat_rekening(
    State(st): State<AppState>,
    a: Anggota,
    Json(body): Json<NewRekening>,
) -> Result<(StatusCode, Json<Rekening>), ApiError> {
    wajib_kelola(&a)?;
    nama_valid(&body.nama)?;
    let rekening = Tenant::new(st.pool, a.organisasi_id)
        .buat_rekening_oleh(body, Some(a.pengguna_id))
        .await?;
    Ok((StatusCode::CREATED, Json(rekening)))
}

async fn detail_rekening(
    State(st): State<AppState>,
    a: Anggota,
    Path((_, id)): Path<(u64, u64)>,
) -> Result<Json<RekeningDetail>, ApiError> {
    let tenant = Tenant::new(st.pool, a.organisasi_id);
    let rekening = tenant
        .ambil_rekening(id)
        .await?
        .ok_or(Error::NotFound { entitas: "rekening" })?;
    let saldo = tenant
        .saldo_rekening(id)
        .await?
        .ok_or(Error::NotFound { entitas: "rekening" })?;

    Ok(Json(RekeningDetail { rekening, saldo }))
}

async fn ubah_rekening(
    State(st): State<AppState>,
    a: Anggota,
    Path((_, id)): Path<(u64, u64)>,
    Json(body): Json<UbahRekening>,
) -> Result<Json<Rekening>, ApiError> {
    wajib_kelola(&a)?;
    nama_valid(&body.nama)?;
    Ok(Json(
        Tenant::new(st.pool, a.organisasi_id)
            .ubah_nama_rekening_oleh(id, &body.nama, Some(a.pengguna_id))
            .await?,
    ))
}

async fn arsipkan_rekening(
    State(st): State<AppState>,
    a: Anggota,
    Path((_, id)): Path<(u64, u64)>,
) -> Result<Json<Rekening>, ApiError> {
    wajib_kelola(&a)?;
    Ok(Json(
        Tenant::new(st.pool, a.organisasi_id)
            .arsipkan_rekening_oleh(id, Some(a.pengguna_id))
            .await?,
    ))
}

// ---- Handler kategori ----

async fn daftar_kategori(State(st): State<AppState>, a: Anggota) -> Result<Json<Vec<Kategori>>, ApiError> {
    Ok(Json(Tenant::new(st.pool, a.organisasi_id).daftar_kategori().await?))
}

async fn buat_kategori(
    State(st): State<AppState>,
    a: Anggota,
    Json(body): Json<NewKategori>,
) -> Result<(StatusCode, Json<Kategori>), ApiError> {
    wajib_kelola(&a)?;
    nama_valid(&body.nama)?;
    let kategori = Tenant::new(st.pool, a.organisasi_id)
        .buat_kategori_oleh(body, Some(a.pengguna_id))
        .await?;
    Ok((StatusCode::CREATED, Json(kategori)))
}

// ---- Handler transaksi & transfer ----

/// 201 jika baru dibuat, 200 jika `client_uuid` sudah pernah diterima (kirim ulang).
async fn buat_transaksi(
    State(st): State<AppState>,
    a: Anggota,
    Json(body): Json<TransaksiBaru>,
) -> Result<(StatusCode, Json<Transaksi>), ApiError> {
    let client_uuid = client_uuid_valid(body.client_uuid.as_deref())?;
    let (transaksi, dibuat) = Tenant::new(st.pool, a.organisasi_id)
        .buat_transaksi_dengan_uuid(
            NewTransaksi {
                rekening_id: body.rekening_id,
                kategori_id: body.kategori_id,
                tipe: body.tipe,
                jumlah: body.jumlah,
                tanggal: body.tanggal,
                catatan: body.catatan,
                dibuat_oleh: a.pengguna_id,
            },
            client_uuid.as_deref(),
        )
        .await?;
    let status = if dibuat { StatusCode::CREATED } else { StatusCode::OK };
    Ok((status, Json(transaksi)))
}

// ---- Bukti transaksi (opsional) ----

/// Melampirkan bukti (JPG, PNG, atau PDF, maksimal 5 MB) ke transaksi. Berkas dicek dari isinya.
async fn unggah_bukti(
    State(st): State<AppState>,
    a: Anggota,
    Path((_, transaksi_id)): Path<(u64, u64)>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<Bukti>), ApiError> {
    let tenant = Tenant::new(st.pool.clone(), a.organisasi_id);
    if tenant.ambil_transaksi(transaksi_id).await?.is_none() {
        return Err(ApiError::Domain(Error::NotFound { entitas: "transaksi" }));
    }

    let mut berkas = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| Error::Validasi("Form tidak valid. Kirim berkas sebagai multipart.".to_string()))?
    {
        if field.name() == Some("berkas") {
            let nama = field.file_name().unwrap_or("bukti").to_string();
            let isi = field
                .bytes()
                .await
                .map_err(|_| Error::Validasi("Berkas tidak bisa dibaca.".to_string()))?;
            berkas = Some((nama, isi));
            break;
        }
    }
    let (nama, isi) = berkas.ok_or_else(|| Error::Validasi("Kirim berkas di field \"berkas\".".to_string()))?;
    if isi.len() > BATAS_BUKTI {
        return Err(Error::Validasi("Berkas terlalu besar. Maksimal 5 MB.".to_string()).into());
    }
    let mime = bukti::deteksi_mime(&isi)
        .ok_or_else(|| Error::Validasi("Tipe berkas tidak didukung. Pakai JPG, PNG, atau PDF.".to_string()))?;

    // Nama di disk acak, jadi nama asli dari klien tidak pernah dipakai sebagai path.
    let nama_disk = uuid::Uuid::new_v4().to_string();
    bukti::simpan(&st.folder_bukti, &nama_disk, &isi).await?;
    let hasil = tenant
        .tambah_bukti(
            transaksi_id,
            &bukti::nama_aman(&nama),
            mime,
            isi.len() as u32,
            &nama_disk,
            a.pengguna_id,
        )
        .await;
    match hasil {
        Ok(b) => Ok((StatusCode::CREATED, Json(b))),
        Err(e) => {
            // Metadata gagal disimpan: buang berkas supaya tidak ada yang yatim di disk.
            bukti::hapus(&st.folder_bukti, &nama_disk).await;
            Err(e.into())
        }
    }
}

async fn daftar_bukti_transaksi(
    State(st): State<AppState>,
    a: Anggota,
    Path((_, transaksi_id)): Path<(u64, u64)>,
) -> Result<Json<Vec<Bukti>>, ApiError> {
    Ok(Json(Tenant::new(st.pool, a.organisasi_id).daftar_bukti(transaksi_id).await?))
}

/// Mengunduh berkas bukti. Hanya anggota organisasi pemiliknya yang bisa membaca.
async fn ambil_berkas_bukti(
    State(st): State<AppState>,
    a: Anggota,
    Path((_, bukti_id)): Path<(u64, u64)>,
) -> Result<Response, ApiError> {
    let b = Tenant::new(st.pool, a.organisasi_id)
        .ambil_bukti(bukti_id)
        .await?
        .ok_or(ApiError::Domain(Error::NotFound { entitas: "bukti" }))?;
    let isi = bukti::baca(&st.folder_bukti, &b.berkas).await?;
    Ok((
        [
            (header::CONTENT_TYPE, b.mime.clone()),
            (header::CONTENT_DISPOSITION, format!("inline; filename=\"{}\"", b.nama_asli)),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
        ],
        isi,
    )
        .into_response())
}

/// Batas ukuran foto struk. Foto dari ponsel biasanya jauh di bawah ini.
const BATAS_GAMBAR: usize = 6 * 1024 * 1024;

/// Membaca foto struk dan mengembalikan usulan isian (jumlah, tanggal, toko).
/// Tidak menyimpan apa pun: pengguna memeriksa usulan lalu menyimpan lewat endpoint transaksi biasa.
async fn baca_struk(
    State(st): State<AppState>,
    _a: Anggota,
    mut multipart: Multipart,
) -> Result<Json<crate::struk::UsulanStruk>, ApiError> {
    let pembaca = st.pembaca.clone().ok_or(ApiError::OcrTidakTersedia)?;

    let mut gambar = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| Error::Validasi("Form tidak valid. Kirim gambar sebagai multipart.".to_string()))?
    {
        if field.name() == Some("gambar") {
            let bytes = field
                .bytes()
                .await
                .map_err(|_| Error::Validasi("Gambar tidak bisa dibaca.".to_string()))?;
            gambar = Some(bytes);
            break;
        }
    }
    let gambar = gambar.ok_or_else(|| Error::Validasi("Kirim gambar di field \"gambar\".".to_string()))?;
    if gambar.len() > BATAS_GAMBAR {
        return Err(Error::Validasi("Gambar terlalu besar. Maksimal 6 MB.".to_string()).into());
    }

    // OCR itu CPU-bound. Jalankan di thread blocking supaya runtime async tidak tertahan.
    let teks = tokio::task::spawn_blocking(move || pembaca.baca(&gambar))
        .await
        .map_err(|e| Error::Internal(format!("ocr: {e}")))??;
    Ok(Json(crate::struk::urai(&teks)))
}

async fn daftar_transaksi(
    State(st): State<AppState>,
    a: Anggota,
    Query(rentang): Query<RentangTanggal>,
) -> Result<Json<Vec<Transaksi>>, ApiError> {
    Ok(Json(
        Tenant::new(st.pool, a.organisasi_id)
            .daftar_transaksi(rentang.dari, rentang.sampai)
            .await?,
    ))
}

async fn ambil_transaksi(
    State(st): State<AppState>,
    a: Anggota,
    Path((_, id)): Path<(u64, u64)>,
) -> Result<Json<Transaksi>, ApiError> {
    let transaksi = Tenant::new(st.pool, a.organisasi_id)
        .ambil_transaksi(id)
        .await?
        .ok_or(Error::NotFound { entitas: "transaksi" })?;
    Ok(Json(transaksi))
}

async fn buat_transfer(
    State(st): State<AppState>,
    a: Anggota,
    Json(body): Json<TransferBaru>,
) -> Result<(StatusCode, Json<Transfer>), ApiError> {
    let client_uuid = client_uuid_valid(body.client_uuid.as_deref())?;
    let (transfer, dibuat) = Tenant::new(st.pool, a.organisasi_id)
        .buat_transfer_dengan_uuid(
            NewTransfer {
                rekening_asal_id: body.rekening_asal_id,
                rekening_tujuan_id: body.rekening_tujuan_id,
                jumlah: body.jumlah,
                tanggal: body.tanggal,
                catatan: body.catatan,
                dibuat_oleh: a.pengguna_id,
            },
            client_uuid.as_deref(),
        )
        .await?;
    let status = if dibuat { StatusCode::CREATED } else { StatusCode::OK };
    Ok((status, Json(transfer)))
}

// ---- Handler laporan & ekspor ----

async fn laporan_bulanan(
    State(st): State<AppState>,
    a: Anggota,
    Query(periode): Query<PeriodeBulan>,
) -> Result<Json<RingkasanBulanan>, ApiError> {
    Ok(Json(
        Tenant::new(st.pool, a.organisasi_id)
            .ringkasan_bulanan(periode.tahun, periode.bulan)
            .await?,
    ))
}

async fn laporan_arus_kas(
    State(st): State<AppState>,
    a: Anggota,
    Query(rentang): Query<RentangTanggal>,
) -> Result<Json<Vec<ArusKasRekening>>, ApiError> {
    Ok(Json(
        Tenant::new(st.pool, a.organisasi_id)
            .arus_kas(rentang.dari, rentang.sampai)
            .await?,
    ))
}

async fn laporan_laba_rugi(
    State(st): State<AppState>,
    a: Anggota,
    Query(rentang): Query<RentangTanggal>,
) -> Result<Json<LabaRugi>, ApiError> {
    Ok(Json(
        Tenant::new(st.pool, a.organisasi_id)
            .laba_rugi(rentang.dari, rentang.sampai)
            .await?,
    ))
}

fn baris_header(kolom: &[&str]) -> String {
    csv::baris(&kolom.iter().map(|k| k.to_string()).collect::<Vec<_>>())
}

/// Respons unduhan CSV dengan BOM UTF-8.
fn unduhan_csv(isi: String, nama_file: String) -> Response {
    (
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8".to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{nama_file}\"")),
        ],
        isi,
    )
        .into_response()
}

async fn ekspor_transaksi_csv(
    State(st): State<AppState>,
    a: Anggota,
    Query(rentang): Query<RentangTanggal>,
) -> Result<Response, ApiError> {
    let baris = Tenant::new(st.pool, a.organisasi_id)
        .baris_ekspor(rentang.dari, rentang.sampai)
        .await?;

    let mut isi = String::from(BOM_UTF8);
    isi.push_str(&baris_header(&[
        "id", "tanggal", "tipe", "rekening", "kategori", "jumlah", "catatan", "transfer_id",
    ]));
    for b in baris {
        isi.push_str(&csv::baris(&[
            b.id.to_string(),
            b.tanggal.to_string(),
            b.tipe.as_str().to_string(),
            csv::teks(&b.rekening),
            b.kategori.as_deref().map(csv::teks).unwrap_or_default(),
            csv::angka(b.jumlah),
            b.catatan.as_deref().map(csv::teks).unwrap_or_default(),
            b.transfer_id.unwrap_or_default(),
        ]));
    }

    let nama = format!("transaksi_{}_{}.csv", rentang.dari, rentang.sampai);
    Ok(unduhan_csv(isi, nama))
}

async fn ekspor_laba_rugi_csv(
    State(st): State<AppState>,
    a: Anggota,
    Query(rentang): Query<RentangTanggal>,
) -> Result<Response, ApiError> {
    let lr = Tenant::new(st.pool, a.organisasi_id)
        .laba_rugi(rentang.dari, rentang.sampai)
        .await?;

    let mut isi = String::from(BOM_UTF8);
    isi.push_str(&baris_header(&["jenis", "kategori", "jumlah_transaksi", "total"]));

    for (jenis, daftar) in [("pendapatan", &lr.pendapatan), ("beban", &lr.beban)] {
        for b in daftar {
            isi.push_str(&csv::baris(&[
                jenis.to_string(),
                csv::teks(&b.kategori),
                b.jumlah_transaksi.to_string(),
                csv::angka(b.total),
            ]));
        }
    }

    isi.push_str(&csv::baris(&["total_pendapatan".into(), "".into(), "".into(), csv::angka(lr.total_pendapatan)]));
    isi.push_str(&csv::baris(&["total_beban".into(), "".into(), "".into(), csv::angka(lr.total_beban)]));
    isi.push_str(&csv::baris(&["laba_bersih".into(), "".into(), "".into(), csv::angka(lr.laba_bersih)]));

    let nama = format!("laba-rugi_{}_{}.csv", rentang.dari, rentang.sampai);
    Ok(unduhan_csv(isi, nama))
}

/// Pemeriksaan hidup untuk healthcheck container. Tidak menyentuh database.
async fn kesehatan() -> StatusCode {
    StatusCode::OK
}

/// Router API v1 dengan pengirim email nonaktif. Untuk produksi gunakan `router_dengan`.
pub fn router(pool: MySqlPool) -> Router {
    router_dengan(pool, Arc::new(PengirimNonaktif), "http://localhost:4322/reset".to_string())
}

/// Router API v1. `{org}` adalah id organisasi.
pub fn router_dengan(pool: MySqlPool, pengirim: Arc<dyn Pengirim>, tautan_reset: String) -> Router {
    Router::new()
        .route("/api/v1/kesehatan", get(kesehatan))
        .route("/api/v1/auth/daftar", post(daftar))
        .route("/api/v1/auth/masuk", post(masuk))
        .route("/api/v1/auth/keluar", post(keluar))
        .route("/api/v1/auth/saya", get(saya))
        .route("/api/v1/auth/lupa-kata-sandi", post(lupa_kata_sandi))
        .route("/api/v1/auth/reset-kata-sandi", post(reset_kata_sandi))
        .route("/api/v1/organisasi", get(daftar_organisasi).post(buat_organisasi))
        .route(
            "/api/v1/organisasi/{org}/rekening",
            get(daftar_rekening).post(buat_rekening),
        )
        .route(
            "/api/v1/organisasi/{org}/rekening/{id}",
            get(detail_rekening).patch(ubah_rekening),
        )
        .route(
            "/api/v1/organisasi/{org}/rekening/{id}/arsip",
            post(arsipkan_rekening),
        )
        .route(
            "/api/v1/organisasi/{org}/kategori",
            get(daftar_kategori).post(buat_kategori),
        )
        .route(
            "/api/v1/organisasi/{org}/transaksi",
            get(daftar_transaksi).post(buat_transaksi),
        )
        .route("/api/v1/organisasi/{org}/transaksi/{id}", get(ambil_transaksi))
        .route(
            "/api/v1/organisasi/{org}/transaksi/ocr",
            post(baca_struk).layer(DefaultBodyLimit::max(BATAS_GAMBAR + 64 * 1024)),
        )
        .route(
            "/api/v1/organisasi/{org}/transaksi/{id}/bukti",
            get(daftar_bukti_transaksi).post(unggah_bukti).layer(DefaultBodyLimit::max(BATAS_BUKTI + 64 * 1024)),
        )
        .route("/api/v1/organisasi/{org}/bukti/{id}", get(ambil_berkas_bukti))
        .route("/api/v1/organisasi/{org}/transfer", post(buat_transfer))
        .route("/api/v1/organisasi/{org}/laporan/bulanan", get(laporan_bulanan))
        .route("/api/v1/organisasi/{org}/laporan/arus-kas", get(laporan_arus_kas))
        .route("/api/v1/organisasi/{org}/laporan/laba-rugi", get(laporan_laba_rugi))
        .route("/api/v1/organisasi/{org}/ekspor/transaksi.csv", get(ekspor_transaksi_csv))
        .route("/api/v1/organisasi/{org}/ekspor/laba-rugi.csv", get(ekspor_laba_rugi_csv))
        .with_state(AppState {
            pool,
            pembatas: Arc::new(PembatasMasuk::default()),
            pengirim,
            tautan_reset,
            pembaca: crate::ocr::Pembaca::dari_env().map(Arc::new),
            folder_bukti: bukti::folder_dari_env(),
        })
}
