# Service analitik (Rust). Multi-stage: build di image Rust, jalan di Debian slim tanpa toolchain.

# ---- build ----
FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

# ---- runtime ----
FROM debian:bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10002 --create-home analitik

WORKDIR /app
COPY --from=build /src/target/release/financa-analitik /app/financa-analitik

# Di dalam container harus 0.0.0.0 agar proxy Coolify bisa mencapainya.
ENV ANALITIK_BIND=0.0.0.0:8100

USER analitik
EXPOSE 8100
CMD ["/app/financa-analitik"]
