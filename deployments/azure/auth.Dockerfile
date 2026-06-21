# Auth-service image for Azure Container Apps (and the local compose stack).
#
# The auth service does no reference rendering, so — unlike the backend image —
# it ships no Chromium and no fonts. It needs only a CA bundle for outbound
# HTTPS (telemetry export). This keeps the runtime stage slim.
#
# Build (from the repo root):
#   az acr build -r <registry> -t tcab-auth-service:<tag> -f deployments/azure/auth.Dockerfile .
#   docker build -t tcab-auth-service -f deployments/azure/auth.Dockerfile .   # local

# ── Build stage ──────────────────────────────────────────────────────────────
FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
# Build just the auth-service crate in release mode.
RUN cargo build --release -p test-cabinet-auth-service

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

# ca-certificates is needed for the auth service's outbound HTTPS (telemetry
# export). No Chromium and no fonts — the auth service does no rendering.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/target/release/tcab-auth-service /usr/local/bin/tcab-auth-service

# State paths are mounted at runtime (an Azure Files volume in Container Apps, a
# named volume locally). The compose file and containerapp.yaml set the matching
# TCAB_AUTH_DATABASE_URL value.
ENV TCAB_AUTH_BIND=0.0.0.0:8789

EXPOSE 8789
ENTRYPOINT ["tcab-auth-service"]
