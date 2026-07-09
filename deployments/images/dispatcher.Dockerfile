# syntax=docker/dockerfile:1
# Dispatcher image for the Kubernetes deployment.
#
# The dispatcher is a thin, long-running controller: it claims queued jobs from
# the backend and creates one driver Job per claim through the Kubernetes API. It
# runs unprivileged and needs NO container engine of its own — only the dispatcher
# binary and a CA bundle (for the Kubernetes API, the backend over TLS, and
# telemetry export). It binds no socket.
#
# The canonical image is published to GHCR by the build-service-images.yml GitHub
# Actions workflow (as ghcr.io/<owner>/tcab-dispatcher, tagged :latest and
# :<git-sha>) on every push to master that touches the crates or this Dockerfile.
# To build and push it by hand instead (from the repo root):
#   docker build -t <registry>/tcab-dispatcher:<tag> -f deployments/images/dispatcher.Dockerfile .
#   docker push <registry>/tcab-dispatcher:<tag>

# ── Build stage ──────────────────────────────────────────────────────────────
FROM docker.io/library/rust:1-bookworm AS build
WORKDIR /src
COPY . .
# Build just the dispatcher crate in release mode. The cargo registry/git, the
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
    TCAB_BUILD_COMMIT="${TCAB_BUILD_COMMIT}" cargo build --release -p test-cabinet-dispatcher \
    && cp /src/target/release/tcab-dispatcher /tcab-dispatcher

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM docker.io/library/debian:bookworm-slim

# ca-certificates for outbound HTTPS (the Kubernetes API, the backend over TLS,
# telemetry export). The dispatcher does no rendering and shells out to nothing.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /tcab-dispatcher /usr/local/bin/tcab-dispatcher

# Run as an unprivileged user: the dispatcher needs only API access (its
# ServiceAccount token), never host privileges.
RUN useradd --create-home --uid 1000 dispatcher
USER dispatcher
WORKDIR /home/dispatcher

ENTRYPOINT ["tcab-dispatcher"]
