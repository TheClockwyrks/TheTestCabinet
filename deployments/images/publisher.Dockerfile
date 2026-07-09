# syntax=docker/dockerfile:1
# Publisher image for the Kubernetes deployment.
#
# The dispatcher creates one publisher Job per *publish* (a parallel queue to the
# run path); each publisher pod runs THIS image, resolves its publish job from the
# environment the dispatcher set, downloads the reviewed run's source tree from the
# artifact service, performs the GitHub-repo + Cloudflare Pages release (the same
# two steps a local `tcab publish` drives, via test_cabinet_core::BackendPublisher)
# while streaming progress to the backend, reports the terminal result, and exits.
# Like the driver it needs NO Docker/Podman daemon and runs unprivileged: it talks
# HTTP to the backend/artifact service and shells out only to the publish CLIs.
#
# Unlike the driver image (which renders builds to screenshot them and therefore
# carries Playwright + a Playwright-managed Chromium), the publisher renders
# NOTHING — it only releases. So this image DROPS the entire browser layer and
# instead carries the three tools the release path shells out to:
#   - `git`, to commit the model's working tree into each run's seeded repository
#     and push it to the run's public repo (crates/core publish.rs
#     `commit_implementation` sets a per-repo `user.name`/`user.email`, so no
#     global git identity is needed here; the push authenticates through `gh`'s
#     credential helper — see below — so no git credential helper is configured).
#   - `gh`, the GitHub CLI, for the idempotent `gh repo view` gate, `gh repo
#     create --public` (the empty repo), and — via `gh auth git-credential` — the
#     credential helper the implementation push authenticates through (crates/core
#     publish.rs `release_code`/`push_implementation`; create and push are kept
#     separate so the push can retry through GitHub's post-create permission lag).
#     Installed from GitHub's official apt repository so it is a current, supported
#     build rather than Debian's older packaged one.
#   - `wrangler`, Cloudflare's CLI, for `wrangler pages deploy <dir> --project-name
#     <p> --branch=<run>` (crates/core publish.rs `release_playable_build`). It is
#     an npm package and the base is already Node, so it is installed globally and
#     PINNED below; the release invokes the bare `wrangler` on PATH.
# `gh`/`wrangler` authenticate from the Job's env (GH_TOKEN / CLOUDFLARE_API_TOKEN,
# wired by the deployment overlay), and the git push borrows `gh`'s token via its
# credential helper; the binary itself never reads those tokens.
#
# The canonical image is published to GHCR by the build-service-images.yml GitHub
# Actions workflow (as ghcr.io/<owner>/tcab-publisher, tagged :latest and
# :<git-sha>) on every push to master that touches the crates or this Dockerfile.
# To build and push it by hand instead (from the repo root):
#   docker build -t <registry>/tcab-publisher:<tag> -f deployments/images/publisher.Dockerfile .
#   docker push <registry>/tcab-publisher:<tag>

# Pinned wrangler version. Bump deliberately (Cloudflare ships frequent releases);
# pinning keeps the publish path reproducible across image builds.
ARG WRANGLER_VERSION=4.40.3

# ── Build stage ──────────────────────────────────────────────────────────────
FROM docker.io/library/rust:1-bookworm AS build
WORKDIR /src
COPY . .
# Build just the publisher crate in release mode. The cargo registry/git, the
# rustup toolchain, and the build's target/ are BuildKit cache mounts, so a source
# change recompiles only what changed instead of re-downloading the toolchain and
# rebuilding every dependency from scratch. target/ is a cache mount (not a layer),
# so the freshly built binary is copied to a stable path inside the same RUN, before
# the mount is detached — the runtime stage COPYs it from there.
# TCAB_BUILD_COMMIT stamps the build's provenance commit into the binary
# (crates/core/build.rs); this `.git`-less context can't resolve it from git, so
# CI passes the commit (github.sha) in as a build arg. Unset, it stamps null.
ARG TCAB_BUILD_COMMIT
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/usr/local/rustup \
    --mount=type=cache,target=/src/target \
    TCAB_BUILD_COMMIT="${TCAB_BUILD_COMMIT}" cargo build --release -p tcab-publisher \
    && cp /src/target/release/tcab-publisher /tcab-publisher

# ── Package store stage ───────────────────────────────────────────────────────
# The host package store a `packages`-declaring case's runtime libraries are
# vendored from at seed time (crates/core `TCAB_PACKAGES_DIR`). A produced tree the
# publisher pushes already carries the vendored `.tcab/packages/` from seeding, so
# the publisher does not itself vendor; the store is baked for parity with the
# driver image and to keep the vendoring source available should a re-publish ever
# need it. Staged exactly as the base and driver images do.
FROM docker.io/library/node:24-bookworm-slim AS tcab-packages
WORKDIR /repo
COPY . .
RUN --mount=type=cache,target=/root/.npm \
    npm ci \
    && node scripts/stage-tcab-packages.mjs /opt/tcab-packages

# ── Runtime stage ────────────────────────────────────────────────────────────
# Node base so `wrangler` (installed globally below) can run; the publisher itself
# is a static-ish Rust binary, but the release path shells out to the Node-based
# wrangler. See the header comment for why no browser/Playwright lives here.
FROM docker.io/library/node:24-bookworm-slim

ARG WRANGLER_VERSION

# ca-certificates covers the publisher's outbound HTTPS (the backend/auth and
# artifact service over TLS, GitHub and Cloudflare APIs, telemetry export); git
# commits each run's working tree before push; gnupg + the GitHub apt key let us
# pull `gh` from GitHub's official repository (a current, supported build). The
# pinned wrangler is installed globally so the release invokes the bare `wrangler`
# on PATH. Everything is removed from the layer that no longer needs it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       git \
       curl \
       gnupg \
  && mkdir -p -m 755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && npm install -g --no-audit --no-fund "wrangler@${WRANGLER_VERSION}" \
  && apt-get purge -y --auto-remove curl gnupg \
  && rm -rf /var/lib/apt/lists/* /root/.npm

COPY --from=build /tcab-publisher /usr/local/bin/tcab-publisher

# The host package store (see the package-store stage above). World-readable so the
# unprivileged `node` user below can read it.
COPY --from=tcab-packages /opt/tcab-packages /opt/tcab-packages
RUN chmod -R a+rX /opt/tcab-packages

# Run as an unprivileged user: the Kubernetes runtime needs only API access (its
# ServiceAccount token + the per-publish-job token), never host privileges. The Node
# base already ships a non-root `node` user (uid 1000) — reuse it rather than minting
# another at the same uid (which would collide). Its home is writable for the
# downloaded source-tree scratch (TCAB_WORK_DIR) and the CLIs' caches/config.
USER node
WORKDIR /home/node

ENTRYPOINT ["tcab-publisher"]
