# Artifact-service image for the Kubernetes deployment (and the local stack).
#
# The artifact service receives each run's produced tree from the driver and
# serves it to the console off a persistent volume. It does no reference rendering
# and shells out to nothing, so — like the auth image — it ships no Chromium and no
# fonts. It needs only the artifact binary and a CA bundle for outbound HTTPS (it
# forwards a driver's per-job token to the backend and a reviewer's token to auth,
# both over TLS, and exports telemetry). State (the artifact store) is mounted at
# runtime — a PersistentVolumeClaim in the cluster — so the image carries none.
#
# The canonical image is published to GHCR by the build-service-images.yml GitHub
# Actions workflow (as ghcr.io/<owner>/tcab-artifacts, tagged :latest and
# :<git-sha>) on every push to master that touches the crates or this Dockerfile.
# To build and push it by hand instead (from the repo root):
#   docker build -t <registry>/tcab-artifacts:<tag> -f deployments/images/artifacts.Dockerfile .
#   docker push <registry>/tcab-artifacts:<tag>

# ── Build stage ──────────────────────────────────────────────────────────────
FROM docker.io/library/rust:1-bookworm AS build
WORKDIR /src
COPY . .
# Build just the artifact-service crate in release mode.
RUN cargo build --release -p test-cabinet-artifacts

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM docker.io/library/debian:bookworm-slim

# ca-certificates for the artifact service's outbound HTTPS (backend + auth token
# verification, telemetry export). No Chromium, no fonts — it renders nothing.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/target/release/tcab-artifacts /usr/local/bin/tcab-artifacts

# The store root is mounted at runtime (a PersistentVolumeClaim in the cluster);
# deployments/k8s/base/artifacts.yaml sets the matching TCAB_ARTIFACTS_ROOT.
ENV TCAB_ARTIFACTS_BIND=0.0.0.0:8790

EXPOSE 8790
ENTRYPOINT ["tcab-artifacts"]
