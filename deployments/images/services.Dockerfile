# syntax=docker/dockerfile:1
# Every Rust SERVICE image for the Kubernetes deployment (and the local stack), in
# one file: backend. The dispatcher's image is
# built in its own repository, microservice-dispatcher, the artifacts service's in
# microservice-artifacts, the arena's in microservice-arena, the publisher's in
# microservice-publisher, and the driver's in
# microservice-driver, beside the run-container images.
#
# Select one with `--target`:
#   docker build --target backend -t <registry>/tcab-backend:<tag> \
#     -f deployments/images/services.Dockerfile .
# The target name is `backend`. The web console is NOT here — its
# image is console.testcabinet.ai's, built by that repository's pipeline.
#
# Why one file
# ------------
# These were seven Dockerfiles, each with its own `COPY . . / cargo build -p <crate>`
# stage. Every one of them opened by refreshing the whole source tree's mtimes (see
# the build stage below for why that is necessary), and all seven shared ONE cargo
# target/ cache mount — so building them back to back, as `make images` does, meant
# each build re-dirtied precisely what the previous build had just compiled. The
# ~19 workspace crates each service pulls in were rebuilt six or seven times over
# per invocation, every time, even with no source change at all.
#
# One shared build stage compiles the binary in a single cargo pass, so the
# mtime refresh happens ONCE and each workspace crate is compiled once. `--target`
# then picks a runtime stage, and BuildKit builds only the stages that target
# actually depends on. The target depends on the gg stage, which fetches the gg
# release the driver pins rather than building one: `backend` bakes the reference
# documents of that release (see the stage's own header below).
#
# The canonical images are built by the Azure pipeline (scripts/ci/service-image.sh)
# on every push to master and staging, natively per architecture, and pushed to the
# Test Cabinet ACR as testcabinet.azurecr.io/tcab-<name>:<sha>.

# ── Shared build stage ───────────────────────────────────────────────────────
# Compiles every service binary in ONE cargo invocation. The cargo registry/git, the
# rustup toolchain and the build's target/ are BuildKit cache mounts, so a source
# change recompiles only what changed instead of re-downloading the toolchain and
# rebuilding every dependency from scratch.
#
# THE RUSTUP CACHE HAS AN `id` OF ITS OWN, and that is a correctness requirement
# rather than a preference. rust-toolchain.toml pins an exact compiler, which the
# `rust:1-bookworm` base image does not necessarily ship — and a cache mount over
# /usr/local/rustup hides whatever it *does* ship, so against a cold cache rustup
# fetches the pinned toolchain here. Any other stage or Dockerfile that mounted the
# same cache and ran rustup at the same moment would fetch it too. rustup stages a
# component download at a content-hash-named `<hash>.partial` under RUSTUP_HOME and
# takes no cross-process lock, so two rustups fetching one toolchain into one shared
# mount collide on that exact path — whichever renames it into place first leaves the
# other renaming something that is no longer there, and the build dies with
#
#   error: component download failed for rustc-<triple>: could not rename 'downloaded'
#   file from '/usr/local/rustup/downloads/<hash>.partial' to
#   '/usr/local/rustup/downloads/<hash>': No such file or directory (os error 2)
#
# A distinct `id` per stage gives each its own RUSTUP_HOME: the toolchain is fetched
# once per stage per cold builder and never again. `sharing=locked` covers the other
# way in — two concurrent builds of the SAME stage (the cargo registry and target/
# mounts need no such flag, because cargo does take a lock over both).
FROM docker.io/library/rust:1-bookworm AS build
WORKDIR /src
COPY . .
# TCAB_BUILD_COMMIT stamps the build's provenance commit into the binaries
# (the binaries' build scripts); this `.git`-less context can't resolve it from git, so
# CI passes the commit (github.sha) in as a build arg. Unset, it stamps null.
ARG TCAB_BUILD_COMMIT
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/usr/local/rustup,id=rustup-services,sharing=locked \
    --mount=type=cache,target=/src/target \
    # Refresh the COPYed sources' mtimes before building. BuildKit preserves the
    # mtimes a file had in the build context and replays them verbatim when the
    # `COPY . .` layer is served from cache — so a cache-hit COPY can hand cargo
    # sources OLDER than artifacts a previous build (a different branch, or one that
    # was interrupted) left in the persistent target/ mount. Cargo's freshness check
    # is mtime-based, so it would call those stale artifacts fresh and silently bake
    # a stale binary — or fail with spurious E0599s when the reused crate's API no
    # longer matches. Touching the tree forces every source to be unambiguously
    # newer. Only workspace crates are dirtied: registry dependencies are
    # fingerprinted by version+features, not mtime, so the ~450 third-party crates in
    # the target mount stay fresh. target/ is pruned so build outputs keep their real
    # mtimes.
    find /src -path /src/target -prune -o -type f -exec touch {} + \
    && TCAB_BUILD_COMMIT="${TCAB_BUILD_COMMIT}" cargo build --release \
        -p test-cabinet-backend \
    # target/ is a cache mount, not a layer, so the binary is copied to a stable
    # path inside the same RUN, before the mount is detached; the runtime stage
    # COPYs it from there.
    && mkdir -p /out \
    && cp \
        target/release/tcab-backend \
        /out/

# ── gg release stage (backend) ───────────────────────────────────────────────
# The first-party `gg` harness's reference documents, as the `gg` repository's pipeline
# released them: this stage does not build gg, it fetches the release the driver pins.
# gg is built, tested and released in its own repository (see "Releasing gg" in
# apps/docs/src/content/docs/development/releasing.md), whose `v*` tag uploads a
# static-musl binary per architecture and `gg-reference.tar.gz` to the anonymously
# readable `gg-releases` blob container. The version is the one line of
# microservice-driver's crates/driver/gg-release-version, the same file the driver
# compiles in as `DEFAULT_RELEASE_VERSION` and its image fetches the binary by, and
# scripts/ci/gg-release.sh is what reads it and fetches, here exactly as in every other
# build that needs gg.
#
# `backend` bakes the documents, so a deployed console's reference and the harness its
# runs execute describe one release.
#
# THE ARCHITECTURE is this stage's own: the helper takes the binary for `uname -m`, which
# under `--platform linux/amd64` is x86_64 whether the builder is native or emulated, so an
# amd64 image bakes the x86_64 binary and an arm64 image the aarch64 one. The helper runs
# the binary before anything is copied and refuses one whose `gg --version` is not the
# pinned version, and a tarball without `gg-reference/index.json`.
#
# ONLY THE THREE FILES THE FETCH READS are mounted, never the context: the layer is keyed
# on the pin and the helper alone, so a source change does not download the ~780 MB binary
# again, and a pin bump does. TCAB_GG_RELEASE_VERSION and TCAB_GG_RELEASE_URL, the names
# the driver reads at run time, override the pin and the release container for one build
# (a prerelease such as 0.7.1-rc1, or a mirror); they are build arguments only and never
# reach a runtime image.
FROM docker.io/library/debian:bookworm-slim AS gg-release
ARG TCAB_GG_RELEASE_VERSION=
ARG TCAB_GG_RELEASE_URL=
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN --mount=type=bind,source=scripts/ci/gg-release.sh,target=/src/scripts/ci/gg-release.sh \
    --mount=type=bind,source=scripts/ci/tcab-lib.sh,target=/src/scripts/ci/tcab-lib.sh \
    --mount=type=bind,source=microservice-driver/crates/driver/gg-release-version,target=/src/microservice-driver/crates/driver/gg-release-version \
    TCAB_GG_RELEASE_VERSION="${TCAB_GG_RELEASE_VERSION}" \
    TCAB_GG_RELEASE_URL="${TCAB_GG_RELEASE_URL}" \
    bash /src/scripts/ci/gg-release.sh fetch /gg-release \
  && chmod 0755 /gg-release/gg \
  && chmod -R a+rX /gg-release/gg-reference \
  && /gg-release/gg --version \
  && ls -l /gg-release/gg-reference

# ── backend ──────────────────────────────────────────────────────────────────
# The stock `tcab-backend` binary ships no browser, but the backend renders
# reference screenshots at ingest by shelling out to the bundled Playwright driver
# (contracts' `packages/browser-driver/driver.mjs`). This stage therefore layers the
# binary on a Node runtime that also carries that driver, its Playwright dependency, and a
# Playwright-managed Chromium (plus the shared libraries and fonts it needs) — the
# same toolchain the driver uses in development — and points TCAB_BROWSER_DRIVER /
# PLAYWRIGHT_BROWSERS_PATH at them so ingest renders out of the box. Set
# TCAB_REFERENCE_BROWSER to an explicit Chromium binary only to override that baked
# browser (the backend forwards it to the driver as TCAB_CHROMIUM_EXECUTABLE).
FROM docker.io/library/node:24-bookworm-slim AS backend

# Where the Playwright-managed Chromium is installed, in both the build RUN below
# and at runtime — the driver discovers the cached browser through this path, so it
# must be stable and identical across both.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

# Just the driver, the sibling ES modules it imports (the `ttc` reporter kit and
# the `validation` runtime), and its manifest (never the host's node_modules): its
# Playwright dependency and Chromium are installed fresh below so the image is
# self-contained. driver.mjs imports these by relative path, so a missing sibling
# is a runtime ERR_MODULE_NOT_FOUND at render time — keep this list in sync with
# driver.mjs's `import` statements.
COPY contracts/packages/browser-driver/package.json contracts/packages/browser-driver/driver.mjs contracts/packages/browser-driver/ttc.mjs contracts/packages/browser-driver/validation.mjs /opt/browser-driver/

# ca-certificates covers the backend's outbound HTTPS (R2); the font set
# is what test cases render with (the slim base ships none — see microservice-driver's
# containers/README.md). ffmpeg transcodes each run's proof clip from the `.webm`
# Playwright records to an H.264 `.mp4` when the public snapshot is built
# (crates/backend snapshot.rs `transcode_webm_to_mp4`), so the gallery plays on every
# browser — webm/VP8 does not on iOS/Safari. Only the snapshot path uses it; live
# proof serving is untouched. The npm install skips Playwright's own browser download
# so only the single Chromium we ask for lands, in PLAYWRIGHT_BROWSERS_PATH.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       ffmpeg \
       fonts-dejavu-core fonts-liberation fonts-noto-core \
  && cd /opt/browser-driver \
  && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --omit=dev --no-audit --no-fund \
  && npx --yes playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/* /root/.npm

COPY --from=build /out/tcab-backend /usr/local/bin/tcab-backend

# gg's reference documents — `index.json` plus one per program language — of the gg release
# the driver pins, served verbatim at GET /gg/reference[/{language}] for the console's gg
# Reference section. They ship as FILES beside the binary rather than compiled into it for
# the same reason the Playwright driver above does: the backend links nothing of gg's. gg
# projects them with `gg reference --out` when its pipeline releases, and the gg-release
# stage above fetches the tarball of the same version the driver image bakes the binary
# of, so the reference and the harness a run executes describe one release.
COPY --from=gg-release /gg-release/gg-reference /opt/gg-reference/

# State paths are mounted at runtime (a PersistentVolumeClaim in the cluster, a
# named volume locally). The compose file and deployments/k8s/base/backend.yaml set
# the matching TCAB_BACKEND_DATABASE_URL / _STORE / _CHECKOUT values.
# TCAB_BROWSER_DRIVER points the render path at the baked driver regardless of the
# process's working directory, and TCAB_GG_REFERENCE the reference endpoints at the
# documents COPYed above — without it the backend would look under the checkout it
# ingests from, which in this image is a mounted volume that has no build output in it.
ENV TCAB_BACKEND_BIND=0.0.0.0:8787 \
    TCAB_BROWSER_DRIVER=/opt/browser-driver/driver.mjs \
    TCAB_GG_REFERENCE=/opt/gg-reference

EXPOSE 8787
ENTRYPOINT ["tcab-backend"]
