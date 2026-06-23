# Worker image for the Kubernetes deployment.
#
# Under TCAB_WORKER_RUNTIME=kubernetes the worker spawns each run as a *separate*
# pod through the Kubernetes API, so this image needs NO Docker/Podman daemon and
# runs unprivileged — it only needs the worker binary, a CA bundle, and the CLIs
# the worker shells out to when it PUBLISHES a run (git, the GitHub CLI `gh`, and
# the Cloudflare `wrangler`). A worker that never publishes can drop those.
#
# The canonical image is published to GHCR by the build-service-images.yml GitHub
# Actions workflow (as ghcr.io/<owner>/tcab-worker, tagged :latest and :<git-sha>)
# on every push to master that touches the crates or this Dockerfile. To build and
# push it by hand instead (from the repo root):
#   docker build -t <registry>/tcab-worker:<tag> -f deployments/images/worker.Dockerfile .
#   docker push <registry>/tcab-worker:<tag>

# ── Build stage ──────────────────────────────────────────────────────────────
FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
# Build just the worker crate in release mode.
RUN cargo build --release -p test-cabinet-worker

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

# ca-certificates for outbound HTTPS (backend/auth over TLS, telemetry export, and
# the Kubernetes API). git + gh + node/npm-installed wrangler are only used by the
# publish path; nodejs brings npm for `npx wrangler`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       git \
       gh \
       nodejs npm \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/target/release/tcab-worker /usr/local/bin/tcab-worker

# Run as an unprivileged user: the Kubernetes runtime needs only API access (its
# ServiceAccount token), never host privileges.
RUN useradd --create-home --uid 1000 worker
USER worker
WORKDIR /home/worker

# Default to the Kubernetes runtime; the manifest sets the TCAB_K8S_* specifics.
ENV TCAB_WORKER_BIND=0.0.0.0:8788 \
    TCAB_WORKER_RUNTIME=kubernetes

EXPOSE 8788
ENTRYPOINT ["tcab-worker"]
