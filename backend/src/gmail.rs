use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, NaiveDate};
use hmac::{Hmac, Mac};
use rand::RngCore;
use reqwest::StatusCode;
use rust_decimal::Decimal;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::draf::NewDraf;
use crate::error::{Error, Result};
use crate::notifikasi;
use crate::repo::Tenant;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const SCOPE: &str = "https://www.googleapis.com/auth/gmail.readonly";
/// Hanya email yang kemungkinan notifikasi transaksi: 14 hari terakhir, dan maksimal 50 pesan per sinkron.
const QUERY: &str = "newer_than:14d (subject:transaksi OR subject:pembayaran OR subject:transfer OR subject:debit OR subject:kredit OR subject:tagihan)";
const BATAS_PESAN: usize = 50;

/// Konfigurasi OAuth Gmail dari env. Jika belum lengkap, `dari_env` mengembalikan `None`
/// dan endpoint Gmail menolak dengan pesan yang jelas.
#[derive(Clone)]
pub struct Konfig {
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    /// Tujuan setelah callback selesai. Hasilnya dikirim sebagai `?gmail=terhubung` atau `?gmail=gagal`.
    pub frontend_url: String,
    kunci: [u8; 32],
}

/// Hasil sinkronisasi: berapa pesan yang diperiksa dan berapa draf baru yang dibuat.
#[derive(Debug, Serialize)]
pub struct SinkronHasil {
    pub diperiksa: usize,
    pub draf_baru: usize,
}

#[derive(Deserialize)]
struct TokenRespons {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct Profil {
    #[serde(rename = "emailAddress")]
    email: String,
}

#[derive(Deserialize)]
struct DaftarPesan {
    #[serde(default)]
    messages: Vec<IdPesan>,
}

#[derive(Deserialize)]
struct IdPesan {
    id: String,
}

#[derive(Deserialize)]
struct Pesan {
    id: String,
    #[serde(rename = "internalDate")]
    internal_date: Option<String>,
    payload: Bagian,
}

#[derive(Deserialize)]
struct Bagian {
    #[serde(rename = "mimeType", default)]
    mime: String,
    #[serde(default)]
    headers: Vec<Header>,
    #[serde(default)]
    body: Option<Badan>,
    #[serde(default)]
    parts: Vec<Bagian>,
}

#[derive(Deserialize)]
struct Header {
    name: String,
    value: String,
}

#[derive(Deserialize)]
struct Badan {
    #[serde(default)]
    data: Option<String>,
}

impl Konfig {
    pub fn dari_env() -> Option<Self> {
        let client_id = std::env::var("GMAIL_CLIENT_ID").ok()?;
        let client_secret = std::env::var("GMAIL_CLIENT_SECRET").ok()?;
        let redirect_uri = std::env::var("GMAIL_REDIRECT_URI").ok()?;
        let frontend_url =
            std::env::var("GMAIL_FRONTEND_URL").unwrap_or_else(|_| "http://localhost:4322/app/draf".to_string());
        let kunci_hex = std::env::var("GMAIL_ENC_KEY").ok()?;
        let kunci: [u8; 32] = match hex::decode(kunci_hex.trim()).ok().and_then(|b| b.try_into().ok()) {
            Some(k) => k,
            None => {
                eprintln!("GMAIL_ENC_KEY harus 64 karakter heks (32 byte). Integrasi Gmail dimatikan.");
                return None;
            }
        };
        Some(Self {
            client_id,
            client_secret,
            redirect_uri,
            frontend_url,
            kunci,
        })
    }

    /// URL persetujuan Google. `state` memuat organisasi dan pengguna yang meminta, dengan tanda tangan HMAC.
    pub fn url_persetujuan(&self, organisasi_id: u64, pengguna_id: u64) -> String {
        let state = self.state_untuk(organisasi_id, pengguna_id);
        reqwest::Url::parse_with_params(
            AUTH_URL,
            &[
                ("client_id", self.client_id.as_str()),
                ("redirect_uri", self.redirect_uri.as_str()),
                ("response_type", "code"),
                ("scope", SCOPE),
                ("access_type", "offline"),
                ("prompt", "consent"),
                ("state", state.as_str()),
            ],
        )
        .map(|u| u.to_string())
        .unwrap_or_default()
    }

    /// Membaca `state` dari callback. Mengembalikan (organisasi, pengguna) hanya jika tanda tangannya valid.
    pub fn baca_state(&self, state: &str) -> Option<(u64, u64)> {
        let (isi, tanda_hex) = state.rsplit_once('.')?;
        let tanda = hex::decode(tanda_hex).ok()?;
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&self.kunci).ok()?;
        mac.update(isi.as_bytes());
        mac.verify_slice(&tanda).ok()?;
        let (organisasi, pengguna) = isi.split_once('.')?;
        Some((organisasi.parse().ok()?, pengguna.parse().ok()?))
    }

    fn state_untuk(&self, organisasi_id: u64, pengguna_id: u64) -> String {
        let isi = format!("{organisasi_id}.{pengguna_id}");
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&self.kunci).expect("HMAC menerima kunci dengan panjang apa pun");
        mac.update(isi.as_bytes());
        format!("{isi}.{}", hex::encode(mac.finalize().into_bytes()))
    }

    /// Menukar kode dari Google menjadi refresh token, menyimpannya terenkripsi, dan mengembalikan alamat Gmail.
    pub async fn hubungkan(&self, tenant: &Tenant, pengguna_id: u64, kode: &str) -> Result<String> {
        let klien = reqwest::Client::new();
        let res = klien
            .post(TOKEN_URL)
            .form(&[
                ("code", kode),
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("redirect_uri", self.redirect_uri.as_str()),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
            .map_err(galat_jaringan)?;
        let token: TokenRespons = baca_json(res).await?;
        let refresh = token.refresh_token.ok_or_else(|| {
            Error::Validasi("Google tidak mengirim refresh token. Hubungkan ulang dan setujui aksesnya.".into())
        })?;

        let profil: Profil = get_json(&klien, &token.access_token, &format!("{API}/profile"), &[]).await?;
        let enc = self.enkripsi(&refresh)?;
        tenant.simpan_koneksi_gmail(pengguna_id, &profil.email, &enc).await?;
        Ok(profil.email)
    }

    /// Mengambil pesan notifikasi terbaru dari Gmail dan menyimpannya sebagai draf. Pesan yang sudah pernah masuk dilewati.
    pub async fn sinkron(&self, tenant: &Tenant, pengguna_id: u64) -> Result<SinkronHasil> {
        let enc = tenant
            .ambil_koneksi_gmail(pengguna_id)
            .await?
            .ok_or_else(|| Error::Validasi("Gmail belum dihubungkan.".into()))?;
        let refresh = self.dekripsi(&enc)?;

        let klien = reqwest::Client::new();
        let akses = self.akses_dari_refresh(&klien, &refresh).await?;

        let batas = BATAS_PESAN.to_string();
        let daftar: DaftarPesan =
            get_json(&klien, &akses, &format!("{API}/messages"), &[("q", QUERY), ("maxResults", &batas)]).await?;

        let mut draf_baru = 0;
        for id in &daftar.messages {
            let pesan: Pesan =
                get_json(&klien, &akses, &format!("{API}/messages/{}", id.id), &[("format", "full")]).await?;
            let Some(usulan) = usulan_dari_pesan(&pesan) else { continue };
            if tenant.simpan_draf(usulan).await? {
                draf_baru += 1;
            }
        }

        tenant.catat_sinkron(pengguna_id).await?;
        Ok(SinkronHasil {
            diperiksa: daftar.messages.len(),
            draf_baru,
        })
    }

    async fn akses_dari_refresh(&self, klien: &reqwest::Client, refresh: &str) -> Result<String> {
        let res = klien
            .post(TOKEN_URL)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("refresh_token", refresh),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .map_err(galat_jaringan)?;
        let token: TokenRespons = baca_json(res).await?;
        Ok(token.access_token)
    }

    fn cipher(&self) -> Aes256Gcm {
        Aes256Gcm::new_from_slice(&self.kunci).expect("kunci 32 byte")
    }

    /// Hasil: 12 byte nonce, lalu teks terenkripsi.
    fn enkripsi(&self, teks: &str) -> Result<Vec<u8>> {
        let mut nonce = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce);
        let ciphertext = self
            .cipher()
            .encrypt(Nonce::from_slice(&nonce), teks.as_bytes())
            .map_err(|_| Error::Internal("enkripsi refresh token gagal".into()))?;
        let mut hasil = nonce.to_vec();
        hasil.extend(ciphertext);
        Ok(hasil)
    }

    fn dekripsi(&self, data: &[u8]) -> Result<String> {
        if data.len() < 12 {
            return Err(Error::Internal("refresh token tersimpan rusak".into()));
        }
        let (nonce, ciphertext) = data.split_at(12);
        let plain = self
            .cipher()
            .decrypt(Nonce::from_slice(nonce), ciphertext)
            .map_err(|_| Error::Internal("dekripsi refresh token gagal".into()))?;
        String::from_utf8(plain).map_err(|_| Error::Internal("refresh token tidak valid".into()))
    }
}

impl Tenant {
    pub async fn ambil_koneksi_gmail(&self, pengguna_id: u64) -> Result<Option<Vec<u8>>> {
        let baris: Option<(Vec<u8>,)> = sqlx::query_as(
            "SELECT refresh_token_enc FROM fn_koneksi_gmail WHERE organisasi_id = ? AND pengguna_id = ?",
        )
        .bind(self.organisasi_id())
        .bind(pengguna_id)
        .fetch_optional(self.pool())
        .await?;
        Ok(baris.map(|b| b.0))
    }

    pub async fn simpan_koneksi_gmail(&self, pengguna_id: u64, email: &str, refresh_enc: &[u8]) -> Result<()> {
        sqlx::query(
            "INSERT INTO fn_koneksi_gmail (organisasi_id, pengguna_id, email, refresh_token_enc) \
             VALUES (?, ?, ?, ?) \
             ON DUPLICATE KEY UPDATE email = VALUES(email), refresh_token_enc = VALUES(refresh_token_enc)",
        )
        .bind(self.organisasi_id())
        .bind(pengguna_id)
        .bind(email)
        .bind(refresh_enc)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn catat_sinkron(&self, pengguna_id: u64) -> Result<()> {
        sqlx::query("UPDATE fn_koneksi_gmail SET sinkron_at = CURRENT_TIMESTAMP WHERE organisasi_id = ? AND pengguna_id = ?")
            .bind(self.organisasi_id())
            .bind(pengguna_id)
            .execute(self.pool())
            .await?;
        Ok(())
    }
}

fn galat_jaringan(e: reqwest::Error) -> Error {
    Error::Internal(format!("gmail: {e}"))
}

/// Status 400 atau 401 dari Google berarti token tidak berlaku lagi: pengguna perlu menghubungkan ulang.
async fn baca_json<T: DeserializeOwned>(res: reqwest::Response) -> Result<T> {
    let status = res.status();
    if status == StatusCode::BAD_REQUEST || status == StatusCode::UNAUTHORIZED {
        return Err(Error::Validasi("Koneksi Gmail perlu dihubungkan ulang.".into()));
    }
    if !status.is_success() {
        return Err(Error::Internal(format!("gmail: status {status}")));
    }
    res.json::<T>().await.map_err(galat_jaringan)
}

async fn get_json<T: DeserializeOwned>(
    klien: &reqwest::Client,
    akses: &str,
    url: &str,
    query: &[(&str, &str)],
) -> Result<T> {
    let res = klien
        .get(url)
        .bearer_auth(akses)
        .query(query)
        .send()
        .await
        .map_err(galat_jaringan)?;
    baca_json(res).await
}

fn usulan_dari_pesan(pesan: &Pesan) -> Option<NewDraf> {
    let subjek = header(&pesan.payload, "Subject").unwrap_or_default();
    let pengirim = header(&pesan.payload, "From").map(|p| potong(&p));
    let tanggal_email = pesan
        .internal_date
        .as_deref()
        .and_then(|ms| ms.parse::<i64>().ok())
        .and_then(DateTime::from_timestamp_millis)
        .map(|t| t.date_naive().format("%Y-%m-%d").to_string());
    let isi = isi_teks(&pesan.payload);

    let usulan = notifikasi::urai(&subjek, &isi, tanggal_email.as_deref())?;
    Some(NewDraf {
        sumber_pesan_id: pesan.id.clone(),
        pengirim,
        keterangan: potong(&usulan.keterangan),
        jumlah: usulan.jumlah.and_then(|j| j.parse::<Decimal>().ok()),
        tipe: usulan.tipe,
        tanggal: usulan.tanggal.and_then(|t| NaiveDate::parse_from_str(&t, "%Y-%m-%d").ok()),
    })
}

/// Kolom di database berukuran 255 karakter.
fn potong(teks: &str) -> String {
    teks.chars().take(255).collect()
}

fn header(b: &Bagian, nama: &str) -> Option<String> {
    b.headers
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case(nama))
        .map(|h| h.value.clone())
}

/// Teks biasa lebih dulu. Jika hanya HTML, tag dibuang secara kasar.
fn isi_teks(b: &Bagian) -> String {
    if let Some(t) = cari_bagian(b, "text/plain") {
        return t;
    }
    cari_bagian(b, "text/html").map(|h| hapus_tag(&h)).unwrap_or_default()
}

fn cari_bagian(b: &Bagian, mime: &str) -> Option<String> {
    if b.mime.eq_ignore_ascii_case(mime) {
        if let Some(t) = b.body.as_ref().and_then(|x| x.data.as_deref()).and_then(decode_base64url) {
            return Some(t);
        }
    }
    b.parts.iter().find_map(|p| cari_bagian(p, mime))
}

fn decode_base64url(data: &str) -> Option<String> {
    let bytes = URL_SAFE_NO_PAD.decode(data.trim_end_matches('=')).ok()?;
    String::from_utf8(bytes).ok()
}

fn hapus_tag(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut dalam_tag = false;
    for c in html.chars() {
        match c {
            '<' => dalam_tag = true,
            '>' if dalam_tag => {
                dalam_tag = false;
                out.push(' ');
            }
            _ if !dalam_tag => out.push(c),
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn konfig() -> Konfig {
        Konfig {
            client_id: "id".into(),
            client_secret: "rahasia".into(),
            redirect_uri: "http://localhost/cb".into(),
            frontend_url: "http://localhost/app/draf".into(),
            kunci: [7u8; 32],
        }
    }

    #[test]
    fn state_ditandatangani_dan_bisa_dibaca() {
        let k = konfig();
        let state = k.state_untuk(3, 9);
        assert_eq!(k.baca_state(&state), Some((3, 9)));
    }

    #[test]
    fn state_yang_diubah_ditolak() {
        let k = konfig();
        let state = k.state_untuk(3, 9).replace("3.9", "4.9");
        assert_eq!(k.baca_state(&state), None);
    }

    #[test]
    fn enkripsi_bolak_balik() {
        let k = konfig();
        let enc = k.enkripsi("refresh-token-uji").unwrap();
        assert_ne!(enc, b"refresh-token-uji");
        assert_eq!(k.dekripsi(&enc).unwrap(), "refresh-token-uji");
    }

    #[test]
    fn isi_teks_plain_dipilih_dari_multipart() {
        let teks = URL_SAFE_NO_PAD.encode("Pembayaran Rp 75.000 berhasil");
        let html = URL_SAFE_NO_PAD.encode("<b>Rp 1</b>");
        let bagian = Bagian {
            mime: "multipart/alternative".into(),
            headers: vec![],
            body: None,
            parts: vec![
                Bagian {
                    mime: "text/html".into(),
                    headers: vec![],
                    body: Some(Badan { data: Some(html) }),
                    parts: vec![],
                },
                Bagian {
                    mime: "text/plain".into(),
                    headers: vec![],
                    body: Some(Badan { data: Some(teks) }),
                    parts: vec![],
                },
            ],
        };
        assert_eq!(isi_teks(&bagian), "Pembayaran Rp 75.000 berhasil");
    }

    #[test]
    fn hapus_tag_membuang_markup() {
        let hasil = hapus_tag("<p>Total <b>Rp 5.000</b></p>");
        assert_eq!(hasil.split_whitespace().collect::<Vec<_>>().join(" "), "Total Rp 5.000");
    }
}
