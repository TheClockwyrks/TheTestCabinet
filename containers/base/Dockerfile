# syntax=docker/dockerfile:1
# The base run-container image for The Test Cabinet.
#
# This is the image an end-to-end run executes in, and the foundation the
# asset-generation images extend (see `containers/sprite/Dockerfile` and
# `containers/sprite-sheet/Dockerfile`, each `FROM` this image plus a baked-in
# drawing binary). It provides the common toolchain a run needs and nothing
# harness specific:
#   - git, because every run executes inside a fresh git repository that is
#     seeded on the host and mounted in.
#   - a Node.js build toolchain, because the test cases ask the model to build
#     web UIs and those builds (Vite/npm and friends) run inside this container.
#   - the system libraries a headless Chromium links against, so a test case can
#     install Playwright and its Chromium *itself* — as a project dependency, via
#     the case's workspace and init command — and drive its build in a real
#     browser to verify it. The Playwright npm package and the Chromium browser
#     binary are deliberately NOT baked in here: a run gets them from the test
#     case's own workspace, so a model never relies on a globally installed tool
#     it cannot see in its project. See `containers/README.md`.
#   - an unprivileged user whose home is set up so that a harness's install
#     command (and a test case's init command) can install software at run time
#     without needing root.
#
# This image installs no agent harness. A run installs the selected harness's CLI
# into the container at run time, by running the harness's `install` command (see
# `harnesses/README.md`); installing at run time is what lets a run always pick
# up the harness's latest published version.
#
# It also bakes in NO Test Cabinet binary. The drawing tool an asset-generation
# run uses (`draw` for a single sprite, `draw-sheet` for a sprite sheet) is baked
# into the separate asset-generation image for that asset kind, each built `FROM`
# this base — see `containers/sprite/Dockerfile` and
# `containers/sprite-sheet/Dockerfile`. Keeping the drawing tools out of the base
# is deliberate: an end-to-end run never touches them, so the binary (and the Rust
# toolchain that compiles it) does not belong in the image every run shares.

# ── Stage: build & stage the shippable Test Cabinet packages ──────────────────
# The repo's own `@test-cabinet/*` runtime libraries (particle-runtime,
# voxel-runtime, …) that an end-to-end case can opt into via the manifest's
# `packages` key are baked into this base image, so a produced asset that needs a
# runtime to play it (a particle `system.json`, a voxel rig) is consumed as an
# ordinary installed dependency — see containers/README.md#the-shippable-test-cabinet-packages.
#
# This mirrors deployments/images/web.Dockerfile: `npm ci` over the whole npm
# workspace (the repo-root `.dockerignore` re-includes exactly this slice — the
# root manifests, every member's package.json, and the packages' sources), then
# `scripts/stage-tcab-packages.mjs` builds the shippable libraries and stages them
# (with inter-`@test-cabinet` deps rewritten to `file:` paths) under
# /opt/tcab-packages. The npm cache is a BuildKit cache mount, as in the web image.
FROM docker.io/library/node:24-bookworm-slim AS tcab-packages
WORKDIR /repo
COPY . .
RUN --mount=type=cache,target=/root/.npm \
	npm ci \
	&& node scripts/stage-tcab-packages.mjs /opt/tcab-packages

# ── The base run image ────────────────────────────────────────────────────────
FROM docker.io/library/node:24-bookworm-slim

# Common system packages:
#   - git: each run is its own fresh repository.
#   - curl, ca-certificates, unzip: used by the curl-based harness installers.
#   - build-essential, python3: let npm build native addons during UI installs,
#     and let a test case's init command shell out to python3 when it needs to.
#   - fonts-dejavu-core: real font files so Chromium (and Canvas text) actually
#     render glyphs — a slim base ships none, so without this text is invisible.
#     DejaVu Sans Mono specifically is the first family in the test cases'
#     required monospace stack, so the run renders the same font the reference
#     screenshots are rendered with.
#   - the libnss3 / libatk / libgbm / libx*… set: the shared libraries a headless
#     Chromium links against. These are OS-level and need root to install, so
#     they live in the image even though Playwright and the Chromium binary
#     themselves do not — a test case installs those into its own project at run
#     time, but the unprivileged run user cannot apt-get system libraries. The
#     list mirrors what `playwright install-deps chromium` installs on Debian
#     bookworm; if a future Playwright/Chromium reports a missing library, add it
#     here.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		build-essential \
		ca-certificates \
		curl \
		fonts-dejavu-core \
		git \
		python3 \
		unzip \
		libasound2 \
		libatk-bridge2.0-0 \
		libatk1.0-0 \
		libatspi2.0-0 \
		libcairo2 \
		libcups2 \
		libdbus-1-3 \
		libdrm2 \
		libgbm1 \
		libglib2.0-0 \
		libnspr4 \
		libnss3 \
		libpango-1.0-0 \
		libx11-6 \
		libxcb1 \
		libxcomposite1 \
		libxdamage1 \
		libxext6 \
		libxfixes3 \
		libxkbcommon0 \
		libxrandr2 \
	&& rm -rf /var/lib/apt/lists/*

# The node base image ships an unprivileged `node` user (uid 1000); reuse it as
# the run user rather than creating a second uid-1000 account. Set up
# user-writable install locations so a harness's run-time install command can
# install its CLI as `node` with no root.
RUN mkdir -p /home/node/.npm-global /home/node/.local/bin /work \
	&& chown -R node:node /home/node /work

# Point npm's global prefix at a user-writable directory and put the user-level
# install locations on PATH, so both `npm install -g` and curl-based installers
# work as the unprivileged user.
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global \
	PATH=/home/node/.npm-global/bin:/home/node/.local/bin:$PATH

# Bake the shippable Test Cabinet packages in, world-readable so the unprivileged
# run user can install them. A case that declares `packages` has each injected
# into its workspace `package.json` as a `file:` dependency resolving under here,
# so `npm install`/`npm ci` pick them up offline. See containers/README.md.
COPY --from=tcab-packages /opt/tcab-packages /opt/tcab-packages
RUN chmod -R a+rX /opt/tcab-packages

USER node

# The seeded repository is mounted here at run time and is the harness's working
# directory.
WORKDIR /work

# Run containers are long-lived: the testing harness starts the container and
# then execs the agent harness inside it (see crates/core ContainerRuntime).
# Keep the container alive until it is explicitly stopped.
CMD ["sleep", "infinity"]
