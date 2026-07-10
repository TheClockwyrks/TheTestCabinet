# syntax=docker/dockerfile:1
# Backend image for the Kubernetes deployment (and the local compose stack).
#
# The stock `tcab-backend` binary ships no browser, but the backend renders
# reference screenshots at ingest by shelling out to the bundled Playwright driver
# (`packages/browser-driver/driver.mjs`). This image therefore layers the binary
# on a Node runtime that also carries that driver, its Playwright dependency, and a
# Playwright-managed Chromium (plus the shared libraries and fonts it needs) — the
# same toolchain the driver uses in development — and points TCAB_BROWSER_DRIVER /
# PLAYWRIGHT_BROWSERS_PATH at them so ingest renders out of the box. Set
# TCAB_REFERENCE_BROWSER to an explicit Chromium binary only to override that baked
# browser (the backend forwards it to the driver as TCAB_CHROMIUM_EXECUTABLE).
#
# The canonical image is published to GHCR by the build-service-images.yml GitHub
# Actions workflow (as ghcr.io/<owner>/tcab-backend, tagged :latest and :<git-sha>)
# on every push to master that touches the crates or this Dockerfile. To build and
# push it by hand instead (from the repo root):
#   docker build -t <registry>/tcab-backend:<tag> -f deployments/images/backend.Dockerfile .
#   docker push <registry>/tcab-backend:<tag>

# ── Build stage ──────────────────────────────────────────────────────────────
FROM docker.io/library/rust:1-bookworm AS build
WORKDIR /src
COPY . .
# Build just the backend crate in release mode. The cargo registry/git, the rustup
# toolchain, and the build's target/ are BuildKit cache mounts, so a source change
# recompiles only what changed instead of re-downloading the toolchain and
# rebuilding every dependency from scratch. target/ is a cache mount (not a layer),
# so the freshly built binary is copied to a stable path inside the same RUN,
# before the mount is detached — the runtime stage COPYs it from there.
# TCAB_BUILD_COMMIT stamps the build's provenance commit into the binary
# (crates/core/build.rs); this `.git`-less context can't resolve it from git, so
# CI passes the commit (github.sha) in as a build arg. Unset, it stamps null.
ARG TCAB_BUILD_COMMIT
# Refresh the COPYed sources' mtimes before building: BuildKit's `COPY . .` stamps
# every copied file with a FIXED mtime, so cargo's mtime-based freshness check can't
# tell the source changed relative to artifacts already sitting in the persistent
# target/ cache mount (left by an earlier build — a different branch, or one that was
# interrupted) and reuses the STALE .rmeta/.rlib — silently baking a stale binary, or
# failing with spurious E0599s when the reused crate's API no longer matches. Touching
# the tree forces cargo's content-hash fallback, so only genuinely-changed crates
# recompile (target/ is pruned so build outputs keep their real mtimes).
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/usr/local/rustup \
    --mount=type=cache,target=/src/target \
    find /src -path /src/target -prune -o -type f -exec touch {} + \
    && TCAB_BUILD_COMMIT="${TCAB_BUILD_COMMIT}" cargo build --release -p test-cabinet-backend \
    && cp /src/target/release/tcab-backend /tcab-backend

# ── Runtime stage ────────────────────────────────────────────────────────────
# Node base so the bundled Playwright driver (invoked as `node driver.mjs`) can run
# the ingest reference render. See the header comment for why the browser tooling
# lives here rather than in the stock binary.
FROM docker.io/library/node:24-bookworm-slim

# Where the Playwright-managed Chromium is installed, in both the build RUN below
# and at runtime — the driver discovers the cached browser through this path, so it
# must be stable and identical across both. ca-certificates covers the backend's
# outbound HTTPS (R2, deploy hook); the font set is what test cases render with (the
# slim base ships none — see containers/README.md).
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

# Just the driver and its manifest (never the host's node_modules): its Playwright
# dependency and Chromium are installed fresh below so the image is self-contained.
COPY packages/browser-driver/package.json packages/browser-driver/driver.mjs /opt/browser-driver/

# Install the driver's Playwright dependency, then a Playwright-managed Chromium and
# the OS libraries it links against (`playwright install --with-deps`). The npm
# install skips Playwright's own browser download so only the single Chromium we
# ask for lands, in PLAYWRIGHT_BROWSERS_PATH.
# ffmpeg transcodes each run's proof clip from the `.webm` Playwright records to
# an H.264 `.mp4` when the public snapshot is built (crates/backend snapshot.rs
# `transcode_webm_to_mp4`), so the gallery plays on every browser — webm/VP8 does
# not on iOS/Safari. Only the snapshot path uses it; live proof serving is untouched.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       ffmpeg \
       fonts-dejavu-core fonts-liberation fonts-noto-core \
  && cd /opt/browser-driver \
  && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --omit=dev --no-audit --no-fund \
  && npx --yes playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/* /root/.npm

COPY --from=build /tcab-backend /usr/local/bin/tcab-backend

# State paths are mounted at runtime (a PersistentVolumeClaim in the cluster, a
# named volume locally). The compose file and deployments/k8s/base/backend.yaml set the
# matching TCAB_BACKEND_DATABASE_URL / _STORE / _CHECKOUT values. TCAB_BROWSER_DRIVER
# points the render path at the baked driver regardless of the process's working
# directory.
ENV TCAB_BACKEND_BIND=0.0.0.0:8787 \
    TCAB_BROWSER_DRIVER=/opt/browser-driver/driver.mjs

EXPOSE 8787
ENTRYPOINT ["tcab-backend"]
