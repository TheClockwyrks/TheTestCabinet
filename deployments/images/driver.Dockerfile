# syntax=docker/dockerfile:1
# Driver image for the Kubernetes deployment.
#
# The dispatcher creates one driver Job per run; each driver pod runs THIS image,
# resolves the run from the backend, and — under TCAB_DRIVER_RUNTIME=kubernetes —
# spawns a single untrusted *sandbox* pod through the Kubernetes API, exec's the
# harness session into it, streams the run's live events/preview back to the
# backend, uploads the produced tree to the artifact service, and exits. It needs
# NO Docker/Podman daemon and runs unprivileged: it only needs the driver binary
# and a CA bundle (for the Kubernetes API, the backend/auth over TLS, the artifact
# upload, and telemetry export). The driver does NOT publish runs (publishing is a
# separate, explicit backend operation), so — unlike the old worker image — it
# ships none of the publish CLIs (git/gh/wrangler).
#
# The canonical image is published to GHCR by the build-service-images.yml GitHub
# Actions workflow (as ghcr.io/<owner>/tcab-driver, tagged :latest and :<git-sha>)
# on every push to master that touches the crates or this Dockerfile. To build and
# push it by hand instead (from the repo root):
#   docker build -t <registry>/tcab-driver:<tag> -f deployments/images/driver.Dockerfile .
#   docker push <registry>/tcab-driver:<tag>

# ── Build stage ──────────────────────────────────────────────────────────────
FROM docker.io/library/rust:1-bookworm AS build
WORKDIR /src
COPY . .
# Build just the driver crate in release mode. The cargo registry/git, the rustup
# toolchain, and the build's target/ are BuildKit cache mounts, so a source change
# recompiles only what changed instead of re-downloading the toolchain and
# rebuilding every dependency from scratch. target/ is a cache mount (not a layer),
# so the freshly built binary is copied to a stable path inside the same RUN,
# before the mount is detached — the runtime stage COPYs it from there.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/usr/local/rustup \
    --mount=type=cache,target=/src/target \
    cargo build --release -p test-cabinet-driver \
    && cp /src/target/release/tcab-driver /tcab-driver

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM docker.io/library/debian:bookworm-slim

# ca-certificates for outbound HTTPS: the Kubernetes API, the backend/auth and
# artifact service over TLS, and telemetry export. Nothing else — the driver
# creates the sandbox through the API and never shells out.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /tcab-driver /usr/local/bin/tcab-driver

# Run as an unprivileged user: the Kubernetes runtime needs only API access (its
# ServiceAccount token), never host privileges.
RUN useradd --create-home --uid 1000 driver
USER driver
WORKDIR /home/driver

# Default to the Kubernetes runtime; the dispatcher sets the TCAB_K8S_* specifics
# and the per-job env (id, token, run request) when it creates each driver Job.
ENV TCAB_DRIVER_RUNTIME=kubernetes

ENTRYPOINT ["tcab-driver"]
