# The image a workspace of this project is developed in.
#
# It is built on the images the project's template publishes to
# nyxsisdev.azurecr.io, which any machine pulls with no login: the toolchain
# image, holding the system packages, the account and every language and tool
# each workspace carries, and one tool image per optional toolchain, holding
# that toolchain's files alone, which this file copies over it. What this file
# runs itself is only what the published images cannot hold: the steps whose
# inputs are this project's own, and the tools whose pins move faster than the
# template's versions. See "What the image carries" in README.md.
#
# Its build context is the repository root rather than this directory, and
# every COPY below is written from there. The last of the project's steps
# installs gg's program-language toolchains with the repository's own
# installers, which read their pins from beside the arms under packages/, so the
# build has to see the repository. The root .dockerignore is an allowlist and
# decides what it sees; see "The build context" in README.md.
#
# Every script reads the architecture from `dpkg --print-architecture` rather
# than from a build argument, because Podman supplies none.
#
# docker-compose.yml builds it and passes every argument below, from the anchor
# its dev service merges. The image references are global `ARG`s, which only a
# `FROM` reads, so none of them enters the key of a `RUN`. Each step after the
# copies `COPY`s only the scripts it runs and declares only the arguments they
# read immediately before its `RUN`, in the order of what changes least often
# first, so a moved pin builds again only the step reading it and the steps
# after it.
ARG TOOLCHAIN_IMAGE
ARG PLAYWRIGHT_IMAGE

# The browser engines.
FROM ${PLAYWRIGHT_IMAGE} AS playwright

# The toolchain image, whose account, `dev` at uid and gid 1000, is the one
# every step below runs as. It sets the PATH every process in the image is
# given, ~/.local/bin and ~/.cargo/bin among it, and the linker cargo links the
# two glibc targets with, so neither is stated here.
FROM ${TOOLCHAIN_IMAGE}

# Each tool image holds its tree at the path it takes here, with the account's
# ownership on the tree and on every directory above it, so a copy of its root
# places the tree and leaves the account's home as the base image made it. The
# copies run from what changes least often to what changes most often.

# The browser engines, in the account's Playwright cache, where Playwright looks
# for them.
COPY --from=playwright / /

# The CUDA toolkit, which is several GB and off unless something in this
# checkout compiles CUDA sources and the host has an NVIDIA GPU behind its
# container runtime. It is apt's, so the step runs as root and returns to the
# account after it.
USER root
COPY ./.devcontainer/system/cuda.sh /tmp/scripts/system/
ARG INSTALL_CUDA
RUN bash /tmp/scripts/system/cuda.sh && rm -rf /var/lib/apt/lists/* /tmp/scripts
USER dev

# This project's own steps go here, such as a database server its tests run
# against: each a `COPY` of only the scripts it runs, the `ARG` lines they read
# declared immediately before its `RUN`, with those arguments added to the
# anchor in docker-compose.yml. Above the coding agents, which move most often,
# so a bump of either rebuilds neither the copies nor these.

# The system packages this project's own builds and tools reach for beyond the
# toolchain image's: musl-tools for the static builds the musl target below
# serves, and what gg's arms, the audio packs, some crates and the local
# cluster tooling need. They are apt's, so the step runs as root. See the
# header of system/packages.sh.
USER root
COPY ./.devcontainer/system/packages.sh /tmp/scripts/system/
RUN bash /tmp/scripts/system/packages.sh && rm -rf /var/lib/apt/lists/* /tmp/scripts
USER dev

# This architecture's musl target, for static builds; musl-tools above ships
# the linker it needs. See the header of languages/rust/targets.sh.
COPY --chown=dev:dev ./.devcontainer/languages/rust/targets.sh /tmp/scripts/languages/rust/
RUN bash /tmp/scripts/languages/rust/targets.sh && rm -rf /tmp/scripts

# helm, which installs a cluster's prerequisites from charts, beside the
# cluster tools the toolchain image carries. Pinned in the script.
COPY --chown=dev:dev ./.devcontainer/tools/helm.sh /tmp/scripts/tools/
RUN bash /tmp/scripts/tools/helm.sh && rm -rf /tmp/scripts

# gg's eleven program-language toolchains and its C# guest's build toolchains:
# about 3.4 GB, by far the largest thing in this image, and not optional.
# crates/gg/build.rs reflects each arm's signature catalogue out of that arm's
# own SDK with that arm's own documentation tool as a step of building the
# crate, so a container without them cannot `cargo build --workspace` at all,
# and the rust-clippy and rust-doc commit hooks fail with it. See the header of
# languages/gg/install.sh.
#
# Deliberately the last of this project's steps, and its own layer. A pin moving in
# packages/gg-sandbox-*/<lang>-version.sh, an installer changing or a new arm
# arriving invalidates this layer and nothing above it, so a rebuild downloads
# toolchains rather than redoing the project's packages, helm and the musl
# target first, and the coding agents below it rebuild without it. It is also
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
COPY --chown=dev:dev \
	./.devcontainer/languages/gg/install.sh \
	/tmp/scripts/languages/gg/
COPY --chown=dev:dev \
	./scripts/ci/install-*.sh \
	./scripts/ci/tcab-lib.sh \
	./scripts/ci/fetch.sh \
	/tmp/scripts/gg-repo/scripts/ci/
COPY --chown=dev:dev \
	./scripts/gg-*.sh \
	/tmp/scripts/gg-repo/scripts/
# The lock each npm-delivered build tool's tree is installed from. The resolver
# in gg-npm-tools.sh reads it beside itself, and install-gg-build-tools.sh runs
# that resolver in this layer; a lock moving reinstalls the tool, so the
# directory is part of this layer's cache key on purpose.
COPY --chown=dev:dev \
	./scripts/gg-npm-locks/ \
	/tmp/scripts/gg-repo/scripts/gg-npm-locks/
COPY --chown=dev:dev \
	./rust-toolchain.toml \
	/tmp/scripts/gg-repo/rust-toolchain.toml
COPY --chown=dev:dev \
	./packages/gg-sandbox-cpp/cpp-version.sh \
	/tmp/scripts/gg-repo/packages/gg-sandbox-cpp/
COPY --chown=dev:dev \
	./packages/gg-sandbox-csharp/csharp-version.sh \
	/tmp/scripts/gg-repo/packages/gg-sandbox-csharp/
COPY --chown=dev:dev \
	./packages/gg-sandbox-java/java-version.sh \
	/tmp/scripts/gg-repo/packages/gg-sandbox-java/
COPY --chown=dev:dev \
	./packages/gg-sandbox-kotlin/kotlin-version.sh \
	/tmp/scripts/gg-repo/packages/gg-sandbox-kotlin/
# purescript-version.sh reads the registry version out of spago.yaml, and the
# build tools' installer warms Spago's store against spago.lock.
COPY --chown=dev:dev \
	./packages/gg-sandbox-purescript/purescript-version.sh \
	./packages/gg-sandbox-purescript/spago.yaml \
	./packages/gg-sandbox-purescript/spago.lock \
	/tmp/scripts/gg-repo/packages/gg-sandbox-purescript/
# The Python arm has no version file: its componentize-py pin is in build.sh,
# and its wheels are pre-fetched from requirements.txt into uv's cache.
COPY --chown=dev:dev \
	./packages/gg-sandbox-python/build.sh \
	./packages/gg-sandbox-python/requirements.txt \
	/tmp/scripts/gg-repo/packages/gg-sandbox-python/
COPY --chown=dev:dev \
	./packages/gg-sandbox-ruby/opal-version.sh \
	./packages/gg-sandbox-ruby/yard-version.sh \
	/tmp/scripts/gg-repo/packages/gg-sandbox-ruby/
# The Rust arm's crate closure and the ECMAScript guest's are separate
# lockfiles from the workspace's, fetched here so their builds run --offline.
# Each manifest names its [lib] path, so cargo looks for no src/ in the slice.
COPY --chown=dev:dev \
	./packages/gg-sandbox-rust/rust-version.sh \
	./packages/gg-sandbox-rust/Cargo.toml \
	./packages/gg-sandbox-rust/Cargo.lock \
	/tmp/scripts/gg-repo/packages/gg-sandbox-rust/
COPY --chown=dev:dev \
	./packages/gg-sandbox/guest/Cargo.toml \
	./packages/gg-sandbox/guest/Cargo.lock \
	/tmp/scripts/gg-repo/packages/gg-sandbox/guest/
COPY --chown=dev:dev \
	./packages/gg-sandbox-swift/swift-version.sh \
	/tmp/scripts/gg-repo/packages/gg-sandbox-swift/
# ~/.npm is npm's download cache, left behind by the build tools it installs
# into their pinned prefixes; the caches the arms' offline builds read (uv's,
# cargo's registry) stay.
RUN bash /tmp/scripts/languages/gg/install.sh && \
	rm -rf "$HOME/.npm" /tmp/scripts

# The two coding-agent CLIs. Both publish often, which is why they are steps of
# this file rather than of a published image.
COPY --chown=dev:dev ./.devcontainer/ai/codex.sh /tmp/scripts/ai/
ARG CODEX_VERSION
RUN bash /tmp/scripts/ai/codex.sh && rm -rf "$HOME/.npm" /tmp/scripts

COPY --chown=dev:dev ./.devcontainer/ai/claude.sh /tmp/scripts/ai/
ARG CLAUDE_CODE_VERSION
RUN bash /tmp/scripts/ai/claude.sh && rm -rf /tmp/scripts

# The shell configuration, last.
COPY --chown=dev:dev ./.devcontainer/post-install.sh ./.devcontainer/system/.bashrc ./.devcontainer/system/.tmux.conf /tmp/scripts/
RUN bash /tmp/scripts/post-install.sh && rm -rf /tmp/scripts
