FROM docker.io/library/ubuntu:26.04
USER root

# Auto-provided by the builder: "amd64" on x64, "arm64" on ARM.
ARG BUILDARCH

ARG USERNAME
ARG USER_UID
ARG USER_GID
ARG DOCKER_GID

ARG LAZYGIT_VERSION
ARG NODE_VERSION
ARG NEXTEST_VERSION
ARG RUST_VERSION
ARG TZ

# Every COPY here is relative to the REPOSITORY ROOT, not to `.devcontainer/`: this
# image's build context is `..` (see `docker-compose.yml`), because the gg toolchain
# layer at the bottom of this file installs from scripts and pins that live in the
# repository rather than in this directory. `.devcontainer/ubuntu.dockerfile.dockerignore`
# is what keeps that context to the ~230 kB slice these COPYs actually read, and its
# header explains why the slice is defined there rather than in the root
# `.dockerignore`.

# Install apt packages, base OS configuration, and the container user.
COPY ./.devcontainer/system/apt.sh ./.devcontainer/system/system-config.sh ./.devcontainer/system/init-user.sh /tmp/scripts/
RUN bash /tmp/scripts/apt.sh && \
	bash /tmp/scripts/system-config.sh && \
	bash /tmp/scripts/init-user.sh && \
	rm -rf /tmp/scripts
USER $USERNAME

# Make binaries installed in the layers below available via the PATH. Both entries are
# load-bearing at BUILD time and not only at runtime, which is why they are an `ENV` here
# rather than a line in `system/.bashrc`: a Dockerfile `RUN` is a non-interactive shell
# that sources no profile, so a tool that installed its own PATH edit into `~/.bashrc` —
# rustup does exactly that — is invisible to every layer below it.
#
#   .local/bin   `purs` and `esbuild`, which the gg toolchain layer at the bottom of this
#                file installs and which `install-gg-toolchains.sh`'s header names as the
#                one thing a caller has to arrange.
#   .cargo/bin   `rustc` and `rustup`, which that same layer needs and which nothing else
#                in this image puts on the PATH. `install-rust-wasm.sh` — the third arm
#                the toolchain installer runs — asks `rustc` where the wasm32 standard
#                library would live and then falls back to `rustup target add`, and it
#                exits 1 rather than skipping when it can find neither, so without this
#                the whole 1.9 GB layer dies three arms in. (The wasm32 target is in fact
#                already installed by `languages/rust/targets.sh`; the script cannot SEE
#                that without a `rustc` to ask.) The sibling CI image sets the same path
#                for the same reason — see `containers/gg-ci/Dockerfile`'s `ENV PATH`.
#
# The `rust/` scripts above still call rustup by absolute path, and should: they run in the
# layer that installs it, where this PATH entry points at a directory that does not exist
# yet.
ENV PATH="$PATH:/home/$USERNAME/.cargo/bin:/home/$USERNAME/.local/bin"

# Copy the install scripts and shell config.
COPY --chown=${USER_UID}:${USER_GID} \
	./.devcontainer/ai/claude.sh \
	./.devcontainer/ai/codex.sh \
	./.devcontainer/tools/lazygit.sh \
	./.devcontainer/tools/az.sh \
	./.devcontainer/tools/gh.sh \
	./.devcontainer/tools/wrangler.sh \
	./.devcontainer/tools/k8s.sh \
	./.devcontainer/tools/docker.sh \
	./.devcontainer/tools/uv.sh \
	./.devcontainer/post-install.sh \
	./.devcontainer/system/.bashrc \
	./.devcontainer/system/.tmux.conf \
	/tmp/scripts/
COPY --chown=${USER_UID}:${USER_GID} \
	./.devcontainer/languages/node/install.sh \
	/tmp/scripts/languages/node/
COPY --chown=${USER_UID}:${USER_GID} \
	./.devcontainer/languages/rust/install.sh \
	./.devcontainer/languages/rust/rustup.sh \
	./.devcontainer/languages/rust/targets.sh \
	./.devcontainer/languages/rust/cargo-nextest.sh \
	./.devcontainer/languages/rust/tauri.sh \
	/tmp/scripts/languages/rust/

RUN mkdir -p "$HOME/.local/bin" "/tmp/$USERNAME" && \
	bash /tmp/scripts/lazygit.sh && \
	bash /tmp/scripts/az.sh && \
	bash /tmp/scripts/gh.sh && \
	bash /tmp/scripts/k8s.sh && \
	bash /tmp/scripts/docker.sh && \
	bash /tmp/scripts/uv.sh && \
	bash /tmp/scripts/languages/node/install.sh && \
	bash /tmp/scripts/wrangler.sh && \
	bash /tmp/scripts/languages/rust/install.sh && \
	bash /tmp/scripts/languages/rust/tauri.sh && \
	bash /tmp/scripts/claude.sh && \
	bash /tmp/scripts/codex.sh && \
	bash /tmp/scripts/post-install.sh && \
	rm -rf /tmp/scripts && \
	# Markdown linting for the docs.
	npm install -g markdownlint-cli2

# gg's eleven program-language toolchains — ~1.9 GB, and by far the largest thing in
# this image. They are here rather than in `postCreateCommand` because they are not
# optional and not a per-crate extra: `crates/gg/build.rs` reflects each arm's
# signature catalogue out of that arm's own SDK, with that arm's own documentation
# tool, as a step of building the crate, so a container without them cannot
# `cargo build --workspace` at all. A prerequisite for working in the repository is a
# prerequisite of the image, not an hour of downloads a developer waits through on
# their first create.
#
# DELIBERATELY LAST, and deliberately its own layer. A pin moving in
# `packages/gg-sandbox-*/<lang>-version.sh`, an installer changing, or a new arm
# arriving invalidates exactly this layer and nothing above it, so a rebuild
# re-downloads toolchains rather than re-doing apt, Node, Rust and the CLIs first. It
# is also the layer most likely to fail on a bad day, since it fetches from half a
# dozen upstreams, and having everything else already cached is what makes retrying it
# cheap.
#
# THE SLICE. `scripts/ci/install-gg-toolchains.sh` is the one pinned list, and it
# reads its pins out of the repository, so a partial repository is staged for it here
# — the toolchain installers, every arm's version file, and the `rust-toolchain.toml`
# the Rust arm's pin defers to. `scripts/ci/lib.sh` resolves the repo root from its own
# path, which is what lets that partial tree stand in for a checkout, and
# `.devcontainer/languages/gg/install.sh` explains the convention.
#
# BOTH HALVES OF THE SLICE ARE GLOBS, so a twelfth arm is admitted with no edit here.
# `install-*.sh` plus `lib.sh` is the installers' whole closure — the one composing
# script runs eight per-arm ones by that name and sources `lib.sh` beside them — and
# copying `./scripts/ci` whole instead would put `web-build.sh`, `specs-lint.sh` and
# twelve other unrelated scripts into the cache key of a 1.9 GB layer, so editing the
# web build would cost the next image build every toolchain in it. `./packages` is
# narrowed the same way by `.devcontainer/ubuntu.dockerfile.dockerignore`
# (`!/packages/gg-sandbox-*/*-version.sh`), which is why it can still be written as a
# directory here.
#
# The slice is deleted in the install RUN so that nothing SHIPS a stale half-repository
# for someone to read a pin out of by mistake. That is hygiene and not a saving: each of
# the four COPYs below is its own layer and already carries those bytes, and a later
# `rm -rf` can only write a whiteout over them (`containers/gg-ci/Dockerfile` says the
# same thing about its own `rm -rf /gg-repo`). What makes that acceptable is the size —
# the whole slice measures ~230 kB, which is why it is worth exactly this much effort
# and no more.
#
# It runs as $USERNAME, after `USER` above, because everything installs under `$HOME`
# — three of the arms can only install there — which is also why
# `devcontainer.json`'s `"updateRemoteUserUID": false` is now load-bearing.
COPY --chown=${USER_UID}:${USER_GID} \
	./.devcontainer/languages/gg/install.sh \
	/tmp/scripts/languages/gg/
COPY --chown=${USER_UID}:${USER_GID} \
	./scripts/ci/install-*.sh \
	./scripts/ci/lib.sh \
	/tmp/scripts/gg-repo/scripts/ci/
# The gg build's own shared shell, which several of those installers source — the pinned-download
# resolver, the npm-tool resolver and the one list of the arms. A glob, matching the allowlist entry
# beside the one above.
COPY --chown=${USER_UID}:${USER_GID} \
	./scripts/gg-*.sh \
	/tmp/scripts/gg-repo/scripts/
COPY --chown=${USER_UID}:${USER_GID} ./packages /tmp/scripts/gg-repo/packages
COPY --chown=${USER_UID}:${USER_GID} ./rust-toolchain.toml /tmp/scripts/gg-repo/rust-toolchain.toml
RUN bash /tmp/scripts/languages/gg/install.sh && \
	rm -rf /tmp/scripts
