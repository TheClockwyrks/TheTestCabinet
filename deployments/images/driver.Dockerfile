# syntax=docker/dockerfile:1
# Driver image for the Kubernetes deployment.
#
# The dispatcher creates one driver Job per run; each driver pod runs THIS image,
# resolves the run from the backend, and — under TCAB_DRIVER_RUNTIME=kubernetes —
# spawns a single untrusted *sandbox* pod through the Kubernetes API, exec's the
# harness session into it, streams the run's live events/preview back to the
# backend, uploads the produced tree to the artifact service, and exits. It needs
# NO Docker/Podman daemon and runs unprivileged: the Kubernetes runtime needs only
# API access (its ServiceAccount token), never host privileges.
#
# The driver does NOT publish runs (publishing is a separate, explicit backend
# operation), so — unlike the old worker image — it ships none of the publish CLIs
# (gh/wrangler). It DOES, however, drive a run end to end *in this process*, and
# that path shells out to three tools, so the image must carry them:
#   - `git`, to seed each run's fresh repository (crates/core seeding `git init`/
#     `add`/`commit`); a missing git fails every run at "failed to seed run
#     repository".
#   - a shell + `node`/`npm`, to run an end-to-end case's manifest build steps
#     (`npm ci`, `npm run build`) against the produced source the sandbox returned.
#   - `node` + the bundled Playwright driver (`packages/browser-driver/driver.mjs`)
#     and a Playwright-managed Chromium, to load-check the build and screenshot it
#     for the per-view checks — the SAME toolchain the backend bakes to render
#     references at ingest. A missing browser degrades a run to a build-only signal
#     rather than failing it, but without Node the build steps can't run at all.
# So this image layers the driver binary on a Node runtime carrying that driver,
# its Playwright dependency, a Playwright-managed Chromium (plus the shared
# libraries and fonts it needs), and git — and points TCAB_BROWSER_DRIVER /
# PLAYWRIGHT_BROWSERS_PATH at them so validation works out of the box. Set
# TCAB_REFERENCE_BROWSER to an explicit Chromium binary only to override that baked
# browser.
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
#
# TCAB_BUILD_COMMIT stamps the build's provenance commit into the binary
# (crates/core/build.rs → the run record's testCabinetCommit): this context has no
# `.git` for build.rs to query — the repo-root .dockerignore never re-includes it —
# so without this every driver run would record an "unknown" commit. CI passes the
# commit (github.sha) as a build arg; unset, it falls through and stamps null.
ARG TCAB_BUILD_COMMIT
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/usr/local/rustup \
    --mount=type=cache,target=/src/target \
    TCAB_BUILD_COMMIT="${TCAB_BUILD_COMMIT}" cargo build --release -p test-cabinet-driver \
    && cp /src/target/release/tcab-driver /tcab-driver

# ── Package store stage ───────────────────────────────────────────────────────
# The driver seeds each run's repository, and a `packages`-declaring case has its
# requested `@test-cabinet/*` runtime libraries vendored into the run repo at seed
# time (crates/core seeding → `.tcab/packages/`). Those libraries are read from a
# host package store, so the driver image bakes one exactly as the base run image
# does: `npm ci` over the npm workspace (the repo-root `.dockerignore` re-includes
# the packages slice), then `scripts/stage-tcab-packages.mjs` builds the shippable
# libraries and stages them under /opt/tcab-packages.
FROM docker.io/library/node:24-bookworm-slim AS tcab-packages
WORKDIR /repo
COPY . .
RUN --mount=type=cache,target=/root/.npm \
    npm ci \
    && node scripts/stage-tcab-packages.mjs /opt/tcab-packages

# ── Runtime stage ────────────────────────────────────────────────────────────
# Node base so the bundled Playwright driver (invoked as `node driver.mjs`) can run
# the build's load-check and an end-to-end case's `npm` build steps can run. See the
# header comment for why the browser/Node tooling lives here rather than in the
# stock binary.
FROM docker.io/library/node:24-bookworm-slim

# Where the Playwright-managed Chromium is installed, in both the build RUN below
# and at runtime — the driver discovers the cached browser through this path, so it
# must be stable and identical across both. ca-certificates covers the driver's
# outbound HTTPS (the Kubernetes API, the backend/auth and artifact service over
# TLS, telemetry export); git seeds each run's repository; the font set is what test
# cases render with (the slim base ships none — see containers/README.md).
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

# Just the driver and its manifest (never the host's node_modules): its Playwright
# dependency and Chromium are installed fresh below so the image is self-contained.
COPY packages/browser-driver/package.json packages/browser-driver/driver.mjs /opt/browser-driver/

# Install git and the font set, then the driver's Playwright dependency and a
# Playwright-managed Chromium with the OS libraries it links against
# (`playwright install --with-deps`). The npm install skips Playwright's own browser
# download so only the single Chromium we ask for lands, in PLAYWRIGHT_BROWSERS_PATH.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       git \
       fonts-dejavu-core fonts-liberation fonts-noto-core \
  && cd /opt/browser-driver \
  && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --omit=dev --no-audit --no-fund \
  && npx --yes playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/* /root/.npm

COPY --from=build /tcab-driver /usr/local/bin/tcab-driver

# The host package store the seeder vendors a `packages`-declaring case's runtime
# libraries out of (crates/core `TCAB_PACKAGES_DIR`). World-readable so the
# unprivileged `node` user below can read it during seeding.
COPY --from=tcab-packages /opt/tcab-packages /opt/tcab-packages
RUN chmod -R a+rX /opt/tcab-packages

# Run as an unprivileged user: the Kubernetes runtime needs only API access (its
# ServiceAccount token), never host privileges. The Node base already ships a
# non-root `node` user (uid 1000) — reuse it rather than minting another at the
# same uid (which would collide). The Playwright browsers installed above are
# world-readable, so this user can launch them, and its home is writable for the
# build/seed scratch and Node's caches.
USER node
WORKDIR /home/node

# Default to the Kubernetes runtime; the dispatcher sets the TCAB_K8S_* specifics
# and the per-job env (id, token, run request) when it creates each driver Job.
# TCAB_BROWSER_DRIVER points the load-check at the baked driver regardless of the
# process's working directory.
ENV TCAB_DRIVER_RUNTIME=kubernetes \
    TCAB_BROWSER_DRIVER=/opt/browser-driver/driver.mjs

ENTRYPOINT ["tcab-driver"]
