# The Rust gate job's CI image: the Rust CI image of the same commit, plus the
# browser engines.
#
# Some of the core's and the suite runtime's tests drive a real browser through
# the npm workspace's Playwright, in the Chromium it launches (a validator project
# under Vitest's browser mode, for one), and they skip on a machine that has no
# browser. The Rust image has none by design, so in it those tests would skip on
# every run and the gate would pass without proving them. The `rust` job is to
# run here instead and set TCAB_REQUIRE_BROWSER=1, which turns a missing browser
# into a failed test (see crates/suites/src/test_browser.rs); it moves in the commit that
# pins ci/images/tags.yml to an image run that built this track, and until then
# runs in the Rust image, where those tests skip. The project's other Rust jobs stay
# on the Rust image, where those tests skip: the `rust` job is the one that holds
# them to running, so this is a track of its own rather than a heavier Rust
# image for every job.
#
# Built on top of the Rust image rather than beside it, so the two cannot
# drift: everything ci/images/rust.Dockerfile states (the toolchain under
# /home/dev, the PATH, HOME=/root, the safe.directory setting) holds here
# unchanged. The image pipeline builds the Rust image first and hands its
# reference to this build as RUST_CI_IMAGE, at the same commit:
# `<registry>/ubuntu-the-test-cabinet-rust-cicd:<commit>`. The empty default
# makes a build without it fail at once rather than pull some other image.
#
# Both halves of a browser are already the published images': the toolchain
# image the Rust image is built on carries Node, linked into ~/.local/bin on the
# PATH, and the engines' system libraries, and the playwright image holds the
# engines themselves, which this file copies over it as the devcontainer and
# the web image do. PLAYWRIGHT_IMAGE comes from the `x-devcontainer-build-args`
# anchor in .devcontainer/docker-compose.yml, extracted by
# ci/images/build-args.sh, like every CI image's argument, and its tag is the
# Playwright version `web-browser-test` holds the workspace's `playwright` to,
# so the workspace's Playwright finds the build copied here. Nothing is
# installed, and nothing of the checkout is copied. Built for linux/amd64 only.
# scripts/ci/ci-image.sh builds and pushes this file. See ci/images/README.md.
ARG RUST_CI_IMAGE=
ARG PLAYWRIGHT_IMAGE
FROM ${PLAYWRIGHT_IMAGE} AS playwright
FROM ${RUST_CI_IMAGE}

# The browser engines, in the account's Playwright cache, as the devcontainer
# and the web image hold them.
COPY --from=playwright / /

# The engines are read where the playwright image put them rather than from
# HOME's cache, which is root's here. Playwright reads this variable when a
# test launches an engine, so the workspace's own Playwright finds them.
ENV PLAYWRIGHT_BROWSERS_PATH=/home/dev/.cache/ms-playwright
