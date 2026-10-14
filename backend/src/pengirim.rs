//! Pengirim email untuk tautan reset kata sandi.
//!
//! Dibuat sebagai trait supaya tes bisa menangkap isi email tanpa SMTP sungguhan.
//! Produksi memakai `PengirimSmtp` dengan `SMTP_URL`. Jika tidak diatur, `PengirimNonaktif`
//! dipakai dan reset kata sandi tidak bisa dikirim (endpoint tetap menjawab generik).

use std::future::Future;
use std::pin::Pin;

use lettre::message::Mailbox;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

pub type Kirim<'a> = Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>>;

pub trait Pengirim: Send + Sync {
    fn kirim<'a>(&'a self, ke: &'a str, subjek: &'a str, isi: &'a str) -> Kirim<'a>;
}

/// Tanpa SMTP: selalu gagal dengan pesan jelas. Tidak mencatat isi email (berisi token).
pub struct PengirimNonaktif;

impl Pengirim for PengirimNonaktif {
    fn kirim<'a>(&'a self, _ke: &'a str, _subjek: &'a str, _isi: &'a str) -> Kirim<'a> {
        Box::pin(async { Err("SMTP_URL belum diatur".to_string()) })
    }
}

pub struct PengirimSmtp {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    dari: Mailbox,
}

impl PengirimSmtp {
    /// `url` berbentuk `smtps://user:pass@host:465` atau `smtp://host:587`.
    pub fn dari_url(url: &str, dari: &str) -> Result<Self, String> {
        let transport = AsyncSmtpTransport::<Tokio1Executor>::from_url(url)
            .map_err(|e| format!("SMTP_URL tidak valid: {e}"))?
            .build();
        let dari: Mailbox = dari.parse().map_err(|e| format!("alamat pengirim tidak valid: {e}"))?;
        Ok(Self { transport, dari })
    }
}

impl Pengirim for PengirimSmtp {
    fn kirim<'a>(&'a self, ke: &'a str, subjek: &'a str, isi: &'a str) -> Kirim<'a> {
        Box::pin(async move {
            let tujuan: Mailbox = ke.parse().map_err(|e| format!("alamat tujuan tidak valid: {e}"))?;
            let pesan = Message::builder()
                .from(self.dari.clone())
                .to(tujuan)
                .subject(subjek)
                .body(isi.to_string())
                .map_err(|e| e.to_string())?;
            self.transport
                .send(pesan)
                .await
                .map(|_| ())
                .map_err(|e| e.to_string())
        })
    }
}
