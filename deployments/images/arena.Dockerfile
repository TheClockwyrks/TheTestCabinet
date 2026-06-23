# Arena-service image for the Kubernetes deployment (and the local stack).
#
# The arena service runs adversarial matches and tournaments (CPU-bound in-process
# wasm) on demand. It is STATELESS — it holds no database and no disk, fetching every
# controller input from the backend and persisting finished tournaments + replays
# back to it over HTTP. So, like the auth and artifact images, it ships no Chromium
# and no fonts (it renders nothing), and it mounts no volume (no PVC). It needs only
# the arena binary and a CA bundle for outbound HTTPS (the backend HTTP calls and
# telemetry export).
#
# The canonical image is published to GHCR by the build-service-images.yml GitHub
# Actions workflow (as ghcr.io/<owner>/tcab-arena, tagged :latest and :<git-sha>) on
# every push to master that touches the crates or this Dockerfile. To build and push
# it by hand instead (from the repo root):
#   docker build -t <registry>/tcab-arena:<tag> -f deployments/images/arena.Dockerfile .
#   docker push <registry>/tcab-arena:<tag>

# ── Build stage ──────────────────────────────────────────────────────────────
FROM docker.io/library/rust:1-bookworm AS build
WORKDIR /src
COPY . .
# Build just the arena-service crate in release mode.
RUN cargo build --release -p test-cabinet-arena

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM docker.io/library/debian:bookworm-slim

# ca-certificates for the arena service's outbound HTTPS (backend HTTP calls,
# telemetry export). No Chromium, no fonts — it renders nothing. No volume — it is
# stateless; HTTP to the backend only.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/target/release/tcab-arena /usr/local/bin/tcab-arena

ENV TCAB_ARENA_BIND=0.0.0.0:8791

EXPOSE 8791
ENTRYPOINT ["tcab-arena"]
