# The Rust gate job's CI image: the Rust CI image of the same commit, plus Node
# and Playwright's Chromium.
#
# Some of core's tests drive a real browser through the npm workspace's
# Playwright, in the Chromium it launches (a validator project under Vitest's
# browser mode, for one), and they skip on a machine that has no browser. The
# Rust image has none by design, so in it those tests would skip on every run
# and the gate would pass without proving them. The `rust` job is to run here
# instead and set TCAB_REQUIRE_BROWSER=1, which turns a missing browser into a
# failed test (see crates/core/src/test_browser.rs); it moves in the commit that
# pins ci/images/tags.yml to an image run that built this track, and until then
# runs in the Rust image, where those tests skip. The project's other Rust jobs stay
# on the Rust image, where those tests skip: the `rust` job is the one that holds
# them to running, so this is a track of its own rather than a heavier Rust
# image for every job.
#
# Built on top of the Rust image rather than beside it, so the two cannot
# drift: everything ci/images/rust.Dockerfile installs and states (the
# toolchain under /usr/local, the PATH, HOME=/root, the safe.directory setting)
# holds here unchanged, and this file adds two layers. The image pipeline builds
# the Rust image first and hands its reference to this build as RUST_CI_IMAGE,
# at the same commit: `<registry>/ubuntu-the-test-cabinet-rust-cicd:<commit>`.
# The empty default makes a build without it fail at once rather than pull some
# other image.
#
# The pins come from the `x-devcontainer-build-args` anchor in
# .devcontainer/docker-compose.yml, extracted by ci/images/build-args.sh, like
# every CI image's. Built for linux/amd64 only. scripts/ci/ci-image.sh builds
# and pushes this file. See ci/images/README.md.
ARG RUST_CI_IMAGE=
FROM ${RUST_CI_IMAGE}

ARG DEBIAN_FRONTEND=noninteractive

ARG NODE_VERSION
ARG PLAYWRIGHT_VERSION

# Node where the web image puts it: /usr/local, whichever user Azure runs a
# step as. The Rust job also provisions the same pinned Node into its
# gg-toolchains cache and puts that first on the PATH, so this one is what the
# image build itself and any job without that cache run.
ENV NODE_INSTALL_DIR=/usr/local/node \
	NODE_BIN_DIR=/usr/local/bin

# Chromium goes somewhere every user can read, as on the web image. Playwright
# reads this variable when it installs the browser and again when a test
# launches it, so the workspace's own Playwright finds the build installed here.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

# npm's cache goes to scratch for the build and leaves with the layer, so
# nothing under /root changes and the base image's widening of it holds.
COPY .devcontainer/languages/node/ /tmp/scripts/node/
RUN bash /tmp/scripts/node/install.sh && \
	rm -rf "$NODE_INSTALL_DIR/include" /tmp/scripts

# Chromium and the system libraries it needs, at the pinned Playwright, started
# once before the step ends. scripts/ci/install-playwright-chromium.sh is the
# one place this is written; its header says why it is not the web image's
# pair of scripts.
COPY scripts/ci/install-playwright-chromium.sh /tmp/scripts/
RUN npm_config_cache=/tmp/npm-cache bash /tmp/scripts/install-playwright-chromium.sh && \
	rm -rf /var/lib/apt/lists/* /tmp/npm-cache /tmp/scripts
