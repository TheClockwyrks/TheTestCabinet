# Shared base image for The Test Cabinet run containers.
#
# Every per-harness image builds FROM this. It provides the common toolchain a
# run needs and nothing harness specific:
#   - git, because every run executes inside a fresh git repository that is
#     seeded on the host and mounted in.
#   - a Node.js build toolchain, because the test cases ask the model to build
#     web UIs and those builds (Vite/npm and friends) run inside this container.
#   - Playwright and a headless Chromium, because the test cases are browser
#     games and a model is expected to drive its own build in a real browser to
#     verify it before finishing.
#   - an unprivileged user whose home is set up so that the per-harness images
#     can install their CLI without needing root.
#
# This image installs no agent harness. See the sibling directories for the
# per-harness images.
FROM docker.io/library/node:24-bookworm-slim

# Common system packages:
#   - git: each run is its own fresh repository.
#   - curl, ca-certificates, unzip: used by the curl-based harness installers.
#   - build-essential, python3: let npm build native addons during UI installs.
#   - fonts-dejavu-core: real font files so Chromium (and Canvas text) actually
#     render glyphs — a slim base ships none, so without this text is invisible.
#     DejaVu Sans Mono specifically is the first family in the test cases'
#     required monospace stack, so the run renders the same font the reference
#     screenshots are rendered with. Playwright's `install-deps` adds the broader
#     Liberation/Noto/CJK/emoji set below, but not DejaVu.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		build-essential \
		ca-certificates \
		curl \
		fonts-dejavu-core \
		git \
		python3 \
		unzip \
	&& rm -rf /var/lib/apt/lists/*

# The node base image ships an unprivileged `node` user (uid 1000); reuse it as
# the run user rather than creating a second uid-1000 account. Set up
# user-writable install locations so the per-harness images can install their
# CLI as `node` with no root.
RUN mkdir -p /home/node/.npm-global /home/node/.local/bin /work \
	&& chown -R node:node /home/node /work

# Point npm's global prefix at a user-writable directory and put the user-level
# install locations on PATH, so both `npm install -g` and curl-based installers
# work as the unprivileged user.
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global \
	PLAYWRIGHT_SKIP_BROWSER_GC=1 \
	PATH=/home/node/.npm-global/bin:/home/node/.local/bin:$PATH

# Playwright + headless Chromium for in-container browser verification.
#
# The two halves of the install have to happen as two different users:
#   - The CLI and the Chromium OS dependencies (system libraries Chromium links
#     against) are installed as root: `playwright install-deps` runs apt-get.
#   - The Chromium *browser* itself is downloaded below as the `node` user so it
#     lands in that user's default cache (~/.cache/ms-playwright), the location a
#     project-local Playwright resolves with no extra configuration.
#
# Pinned to the same Playwright version the harness's own browser-driver uses
# (packages/browser-driver). Keeping them in lockstep means a model that adds
# `playwright@1.61.0` to its project reuses this cached browser instead of
# downloading another one at run time.
#
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD stops the global install's postinstall from
# fetching Chromium into root's cache; the only browser download is the explicit
# one below, as `node`, into the run user's cache.
#
# This install runs as root but writes into the node user's home (the global
# prefix is /home/node/.npm-global and npm's cache lands under /home/node). That
# leaves those trees root-owned, so a later `npm install -g` by the `node` user
# in a per-harness image can't create directories under them (EACCES). Hand the
# whole home back to `node` afterward so those installs work without root.
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install -g playwright@1.61.0 \
	&& playwright install-deps chromium \
	&& rm -rf /var/lib/apt/lists/* \
	&& chown -R node:node /home/node

USER node

# Download the Chromium build into the run user's Playwright cache so it is
# present without network access and is reused by a project-local install of the
# pinned version.
RUN playwright install chromium

# The seeded repository is mounted here at run time and is the harness's working
# directory.
WORKDIR /work

# Run containers are long-lived: the testing harness starts the container and
# then execs the agent harness inside it (see crates/core ContainerRuntime).
# Keep the container alive until it is explicitly stopped.
CMD ["sleep", "infinity"]
