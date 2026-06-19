# Backend image for Azure Container Apps (and the local compose stack).
#
# The stock `tcab-backend` binary ships no browser, but the backend renders
# reference screenshots with a headless Chromium at ingest. This image layers the
# binary on a runtime that includes Chromium and the fonts it needs, and points
# TCAB_REFERENCE_BROWSER at it.
#
# Build (from the repo root):
#   az acr build -r <registry> -t tcab-backend:<tag> -f deployments/azure/backend.Dockerfile .
#   docker build -t tcab-backend -f deployments/azure/backend.Dockerfile .   # local

# ── Build stage ──────────────────────────────────────────────────────────────
FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
# Build just the backend crate in release mode.
RUN cargo build --release -p test-cabinet-backend

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

# Chromium for reference rendering, plus the font set test cases require (the
# slim base ships none — see containers/README.md). ca-certificates is needed for
# the backend's outbound HTTPS (R2, deploy hook).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       chromium \
       ca-certificates \
       fonts-dejavu-core fonts-liberation fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/target/release/tcab-backend /usr/local/bin/tcab-backend

# State paths are mounted at runtime (an Azure Files volume in Container Apps, a
# named volume locally). The compose file and containerapp.yaml set the matching
# TCAB_BACKEND_DATABASE_URL / _STORE / _CHECKOUT values.
ENV TCAB_BACKEND_BIND=0.0.0.0:8787 \
    TCAB_REFERENCE_BROWSER=/usr/bin/chromium

EXPOSE 8787
ENTRYPOINT ["tcab-backend"]
