# Image API (Rust). Multi-stage: build di image Rust, jalan di Debian slim tanpa toolchain.
# Migrasi di migrations/ sudah ter-embed saat compile (sqlx::migrate!), jadi tidak perlu berkas SQL di runtime.

# ---- build ----
FROM rust:1-bookworm AS build
# cmake dibutuhkan aws-lc-sys (TLS untuk SMTP lewat lettre).
RUN apt-get update \
 && apt-get install -y --no-install-recommends cmake pkg-config \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release --locked --bin financa-api

# Model OCR (ocrs) diunduh saat build supaya image bisa dibuat ulang tanpa berkas lokal.
# Sumbernya sama dengan yang dipakai backend/models di mesin pengembangan.
RUN mkdir -p /src/models \
 && curl -fsSL -o /src/models/text-detection.rten https://ocrs-models.s3-accelerate.amazonaws.com/text-detection.rten \
 && curl -fsSL -o /src/models/text-recognition.rten https://ocrs-models.s3-accelerate.amazonaws.com/text-recognition.rten

# ---- runtime ----
FROM debian:bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --create-home financa

WORKDIR /app
COPY --from=build /src/target/release/financa-api /app/financa-api
COPY --from=build /src/models /app/models
RUN mkdir -p /app/storage/bukti && chown -R financa:financa /app/storage

# Default di kode adalah 127.0.0.1 (hanya localhost). Di dalam container harus 0.0.0.0 agar proxy Coolify bisa mencapainya.
ENV BIND=0.0.0.0:8000 \
    OCR_MODEL_DIR=/app/models \
    BUKTI_DIR=/app/storage/bukti

USER financa
EXPOSE 8000
# Bukti transaksi disimpan di sini. Pasang volume agar tidak hilang saat redeploy.
VOLUME ["/app/storage"]
CMD ["/app/financa-api"]
