# Auth-service image for the Kubernetes deployment (and the local compose stack).
#
# The auth service does no reference rendering, so — unlike the backend image —
# it ships no Chromium and no fonts. It needs only a CA bundle for outbound
# HTTPS (telemetry export). This keeps the runtime stage slim.
#
# The canonical image is published to GHCR by the build-service-images.yml GitHub
# Actions workflow (as ghcr.io/<owner>/tcab-auth-service, tagged :latest and
# :<git-sha>) on every push to master that touches the crates or this Dockerfile.
# To build and push it by hand instead (from the repo root):
#   docker build -t <registry>/tcab-auth-service:<tag> -f deployments/images/auth.Dockerfile .
#   docker push <registry>/tcab-auth-service:<tag>

# ── Build stage ──────────────────────────────────────────────────────────────
FROM docker.io/library/rust:1-bookworm AS build
WORKDIR /src
COPY . .
# Build just the auth-service crate in release mode.
RUN cargo build --release -p test-cabinet-auth-service

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM docker.io/library/debian:bookworm-slim

# ca-certificates is needed for the auth service's outbound HTTPS (telemetry
# export). No Chromium and no fonts — the auth service does no rendering.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/target/release/tcab-auth-service /usr/local/bin/tcab-auth-service

# State paths are mounted at runtime (a PersistentVolumeClaim in the cluster, a
# named volume locally). The compose file and deployments/k8s/base/auth.yaml set the
# matching TCAB_AUTH_DATABASE_URL value.
ENV TCAB_AUTH_BIND=0.0.0.0:8789

EXPOSE 8789
ENTRYPOINT ["tcab-auth-service"]
