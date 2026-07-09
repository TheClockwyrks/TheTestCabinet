# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv
# Auth-service image for the Kubernetes deployment (and the local compose stack).
#
# The check=skip above silences a false positive: BuildKit's SecretsUsedInArgOrEnv
# lint flags any ENV whose *name* contains "AUTH" (also TOKEN/KEY/SECRET/PASSWORD).
# The only such ENV here is TCAB_AUTH_BIND — the socket the Axum server listens on
# (0.0.0.0:8789), a network bind address, not a credential. The same value is
# already committed in plaintext in the compose file, k8s manifests, and the
# .env.example files. No secret is baked into the image.
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
# Build just the auth-service crate in release mode. The cargo registry/git, the
# rustup toolchain, and the build's target/ are BuildKit cache mounts, so a source
# change recompiles only what changed instead of re-downloading the toolchain and
# rebuilding every dependency from scratch. target/ is a cache mount (not a layer),
# so the freshly built binary is copied to a stable path inside the same RUN,
# before the mount is detached — the runtime stage COPYs it from there.
# TCAB_BUILD_COMMIT stamps the build's provenance commit into the binary
# (crates/core/build.rs); this `.git`-less context can't resolve it from git, so
# CI passes the commit (github.sha) in as a build arg. Unset, it stamps null.
ARG TCAB_BUILD_COMMIT
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/usr/local/rustup \
    --mount=type=cache,target=/src/target \
    TCAB_BUILD_COMMIT="${TCAB_BUILD_COMMIT}" cargo build --release -p test-cabinet-auth-service \
    && cp /src/target/release/tcab-auth-service /tcab-auth-service

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM docker.io/library/debian:bookworm-slim

# ca-certificates is needed for the auth service's outbound HTTPS (telemetry
# export). No Chromium and no fonts — the auth service does no rendering.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /tcab-auth-service /usr/local/bin/tcab-auth-service

# State paths are mounted at runtime (a PersistentVolumeClaim in the cluster, a
# named volume locally). The compose file and deployments/k8s/base/auth.yaml set the
# matching TCAB_AUTH_DATABASE_URL value.
ENV TCAB_AUTH_BIND=0.0.0.0:8789

EXPOSE 8789
ENTRYPOINT ["tcab-auth-service"]
