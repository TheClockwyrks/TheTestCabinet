# The image a workspace of this project is developed in.
#
# docker-compose.yml builds it and passes every argument below; the versions
# are pinned there, in the anchor its dev service merges.
#
# Its build context is the repository root rather than this directory, and
# every COPY below is written from there. The last layer installs gg's
# program-language toolchains with the repository's own installers, which read
# their pins from beside the arms under packages/, so the build has to see the
# repository. The root .dockerignore is an allowlist and decides what it sees;
# see "The build context" in README.md.
#
# Every script reads the architecture from `dpkg --print-architecture` rather
# than from a build argument, because Podman supplies none.
FROM docker.io/library/ubuntu:26.04
USER root

ARG USERNAME
ARG USER_UID
ARG USER_GID
# Whether system/cuda.sh installs the CUDA toolkit. Off unless something in
# this checkout compiles CUDA sources and the host has an NVIDIA GPU behind its
# container runtime.
ARG INSTALL_CUDA

ARG CLAUDE_CODE_VERSION
ARG CODEX_VERSION
ARG LAZYGIT_VERSION
ARG NODE_VERSION
ARG PLAYWRIGHT_VERSION
ARG NEXTEST_VERSION
ARG NEXTEST_SHA256_AMD64
ARG NEXTEST_SHA256_ARM64
ARG MOLD_VERSION
ARG MOLD_SHA256_AMD64
ARG MOLD_SHA256_ARM64
ARG RUST_VERSION
ARG WRANGLER_VERSION

# Install apt packages, base OS configuration, and the container user.
COPY ./.devcontainer/system/apt.sh ./.devcontainer/system/cuda.sh ./.devcontainer/system/system-config.sh ./.devcontainer/system/init-user.sh /tmp/scripts/
RUN bash /tmp/scripts/apt.sh && \
	bash /tmp/scripts/cuda.sh && \
	bash /tmp/scripts/system-config.sh && \
	bash /tmp/scripts/init-user.sh && \
	rm -rf /tmp/scripts

# Claude Code's managed settings. Every session in the image runs unattended,
# and the managed file is the one source Claude Code takes a default of bypass
# permissions mode from whichever configuration directory a session points it
# at: it ignores the mode in a checkout's own .claude/settings.json, which a
# repository could write, and reads a user's file only from the directory
# CLAUDE_CONFIG_DIR names. See ai/claude-managed-settings.json.
COPY ./.devcontainer/ai/claude-managed-settings.json /etc/claude-code/managed-settings.json
USER $USERNAME

# Make binaries installed in the next step available via the PATH. Both
# entries are load-bearing at build time as well as at run time: a Dockerfile
# RUN sources no profile, and the gg toolchain layer at the bottom of this
# file needs `rustc` from .cargo/bin and puts `purs` and `esbuild` in
# .local/bin, which the installers after it shell out to. The order is
# load-bearing too: languages/rust/permit-wrapper.sh places a wrapper named
# cargo in ~/.local/bin, which has to be found ahead of the toolchain's own.
ENV PATH="$PATH:/home/$USERNAME/.local/bin:/home/$USERNAME/.cargo/bin"

# The linker cargo links the two glibc targets with: cc-mold, the driver
# languages/rust/mold.sh installs beside cargo, which hands the link to mold.
# It is set in the image, so a terminal, an editor's language server and an
# `exec` naming cargo with no shell all link alike, and it names those two
# targets alone, so a build for any other target keeps its own linker.
ENV CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=cc-mold \
	CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=cc-mold

# Copy the install scripts and shell config.
COPY --chown=${USER_UID}:${USER_GID} \
	./.devcontainer/ai/claude.sh \
	./.devcontainer/ai/codex.sh \
	./.devcontainer/tools/lazygit.sh \
	./.devcontainer/tools/az.sh \
	./.devcontainer/tools/gh.sh \
	./.devcontainer/tools/k8s.sh \
	./.devcontainer/tools/kubectl.sh \
	./.devcontainer/tools/container.sh \
	./.devcontainer/tools/uv.sh \
	./.devcontainer/tools/wrangler.sh \
	./.devcontainer/tools/browsers.sh \
	./.devcontainer/system/browser-deps.sh \
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
	./.devcontainer/languages/rust/mold.sh \
	./.devcontainer/languages/rust/permit-wrapper.sh \
	/tmp/scripts/languages/rust/

# wrangler follows the Node install, which it is installed with.
RUN mkdir -p "$HOME/.local/bin" "/tmp/$USERNAME" && \
	bash /tmp/scripts/lazygit.sh && \
	bash /tmp/scripts/az.sh && \
	bash /tmp/scripts/gh.sh && \
	bash /tmp/scripts/k8s.sh && \
	bash /tmp/scripts/container.sh && \
	bash /tmp/scripts/uv.sh && \
	bash /tmp/scripts/languages/node/install.sh && \
	bash /tmp/scripts/wrangler.sh && \
	bash /tmp/scripts/languages/rust/install.sh && \
	bash /tmp/scripts/languages/rust/permit-wrapper.sh && \
	bash /tmp/scripts/claude.sh && \
	bash /tmp/scripts/codex.sh && \
	bash /tmp/scripts/post-install.sh

# The browser engines' system libraries. They are apt's, so they need root, and
# Playwright resolves which ones they are by running `npx`, so this sits after
# the Node install above rather than beside the rest of the apt work at the top
# of this file. The build takes root back for the one step, and each half drops
# the package index and the package cache it downloaded to run. See the header
# of system/browser-deps.sh.
USER root
RUN bash /tmp/scripts/browser-deps.sh && \
	rm -rf /var/lib/apt/lists/* /root/.npm
USER $USERNAME

# The engines themselves, which land in the container user's own cache and are
# therefore downloaded as that user.
RUN bash /tmp/scripts/browsers.sh && \
	rm -rf "$HOME/.npm" /tmp/scripts

# gg's eleven program-language toolchains and its C# guest's build toolchains:
# about 3.4 GB, by far the largest thing in this image, and not optional.
# crates/gg/build.rs reflects each arm's signature catalogue out of that arm's
# own SDK with that arm's own documentation tool as a step of building the
# crate, so a container without them cannot `cargo build --workspace` at all,
# and the rust-clippy and rust-doc commit hooks fail with it. See the header of
# languages/gg/install.sh.
#
# Deliberately last, and its own layer. A pin moving in
# packages/gg-sandbox-*/<lang>-version.sh, an installer changing or a new arm
# arriving invalidates this layer and nothing above it, so a rebuild downloads
# toolchains rather than redoing apt, Node, Rust and the CLIs first. It is also
# the layer most likely to fail on a bad day, fetching from half a dozen
# upstreams, and having everything else cached is what makes retrying it cheap.
#
# The installers read their pins out of the repository, so a partial repository
# is staged for them: the installers and the shared shell they source, gg's own
# build shell, every arm's pins and the files those pins read, and the
# rust-toolchain.toml the Rust arm's pin defers to. scripts/ci/tcab-lib.sh
# resolves the repository root from its own path, which is what lets the slice
# stand in for a checkout. The installers and gg's shell are globs, so a new
# arm's installer needs no edit here; the files under packages/ are named one
# by one, because a COPY of a directory takes every source the allowlist admits
# and would put the arms' whole sources into this layer's cache key, so that an
# edit to a guest cost the next rebuild every toolchain. A new arm therefore
# adds its version file below, and the build fails on the installer's own
# `source` line until it does. The list is the `$REPO_ROOT/<path>` literals in
# scripts/ci/install-*.sh, which scripts/ci/build-context.sh reads the same way.
#
# The slice is deleted in the install RUN so that nothing ships a stale half
# repository for someone to read a pin out of. That is hygiene rather than a
# saving: each COPY is its own layer and a later delete only writes a whiteout,
# and the whole slice is a few hundred kB.
COPY --chown=${USER_UID}:${USER_GID} \
	./.devcontainer/languages/gg/install.sh \
	/tmp/scripts/languages/gg/
COPY --chown=${USER_UID}:${USER_GID} \
	./scripts/ci/install-*.sh \
	./scripts/ci/tcab-lib.sh \
	./scripts/ci/fetch.sh \
	/tmp/scripts/gg-repo/scripts/ci/
COPY --chown=${USER_UID}:${USER_GID} \
	./scripts/gg-*.sh \
	/tmp/scripts/gg-repo/scripts/
# The lock each npm-delivered build tool's tree is installed from. The resolver
# in gg-npm-tools.sh reads it beside itself, and install-gg-build-tools.sh runs
# that resolver in this layer; a lock moving reinstalls the tool, so the
# directory is part of this layer's cache key on purpose.
COPY --chown=${USER_UID}:${USER_GID} \
	./scripts/gg-npm-locks/ \
	/tmp/scripts/gg-repo/scripts/gg-npm-locks/
COPY --chown=${USER_UID}:${USER_GID} \
	./rust-toolchain.toml \
	/tmp/scripts/gg-repo/rust-toolchain.toml
COPY --chown=${USER_UID}:${USER_GID} \
	./packages/gg-sandbox-cpp/cpp-version.sh \
	/tmp/scripts/gg-repo/packages/gg-sandbox-cpp/
COPY --chown=${USER_UID}:${USER_GID} \
	./packages/gg-sandbox-csharp/csharp-version.sh \
	/tmp/scripts/gg-repo/packages/gg-sandbox-csharp/
COPY --chown=${USER_UID}:${USER_GID} \
	./packages/gg-sandbox-java/java-version.sh \
	/tmp/scripts/gg-repo/packages/gg-sandbox-java/
COPY --chown=${USER_UID}:${USER_GID} \
	./packages/gg-sandbox-kotlin/kotlin-version.sh \
	/tmp/scripts/gg-repo/packages/gg-sandbox-kotlin/
# purescript-version.sh reads the registry version out of spago.yaml, and the
# build tools' installer warms Spago's store against spago.lock.
COPY --chown=${USER_UID}:${USER_GID} \
	./packages/gg-sandbox-purescript/purescript-version.sh \
	./packages/gg-sandbox-purescript/spago.yaml \
	./packages/gg-sandbox-purescript/spago.lock \
	/tmp/scripts/gg-repo/packages/gg-sandbox-purescript/
# The Python arm has no version file: its componentize-py pin is in build.sh,
# and its wheels are pre-fetched from requirements.txt into uv's cache.
COPY --chown=${USER_UID}:${USER_GID} \
	./packages/gg-sandbox-python/build.sh \
	./packages/gg-sandbox-python/requirements.txt \
	/tmp/scripts/gg-repo/packages/gg-sandbox-python/
COPY --chown=${USER_UID}:${USER_GID} \
	./packages/gg-sandbox-ruby/opal-version.sh \
	./packages/gg-sandbox-ruby/yard-version.sh \
	/tmp/scripts/gg-repo/packages/gg-sandbox-ruby/
# The Rust arm's crate closure and the ECMAScript guest's are separate
# lockfiles from the workspace's, fetched here so their builds run --offline.
# Each manifest names its [lib] path, so cargo looks for no src/ in the slice.
COPY --chown=${USER_UID}:${USER_GID} \
	./packages/gg-sandbox-rust/rust-version.sh \
	./packages/gg-sandbox-rust/Cargo.toml \
	./packages/gg-sandbox-rust/Cargo.lock \
	/tmp/scripts/gg-repo/packages/gg-sandbox-rust/
COPY --chown=${USER_UID}:${USER_GID} \
	./packages/gg-sandbox/guest/Cargo.toml \
	./packages/gg-sandbox/guest/Cargo.lock \
	/tmp/scripts/gg-repo/packages/gg-sandbox/guest/
COPY --chown=${USER_UID}:${USER_GID} \
	./packages/gg-sandbox-swift/swift-version.sh \
	/tmp/scripts/gg-repo/packages/gg-sandbox-swift/
# ~/.npm is npm's download cache, left behind by the build tools it installs
# into their pinned prefixes; the caches the arms' offline builds read (uv's,
# cargo's registry) stay.
RUN bash /tmp/scripts/languages/gg/install.sh && \
	rm -rf "$HOME/.npm" /tmp/scripts
