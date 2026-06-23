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
# Build just the dispatcher crate in release mode.
RUN cargo build --release -p test-cabinet-dispatcher

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM docker.io/library/debian:bookworm-slim

# ca-certificates for outbound HTTPS (the Kubernetes API, the backend over TLS,
# telemetry export). The dispatcher does no rendering and shells out to nothing.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/target/release/tcab-dispatcher /usr/local/bin/tcab-dispatcher

# Run as an unprivileged user: the dispatcher needs only API access (its
# ServiceAccount token), never host privileges.
RUN useradd --create-home --uid 1000 dispatcher
USER dispatcher
WORKDIR /home/dispatcher

ENTRYPOINT ["tcab-dispatcher"]
