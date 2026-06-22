# The performance run-container image for The Test Cabinet.
#
# Every performance run executes in this one image (all performance test cases
# share it). It is the base run-container image plus, like the adversarial image,
# The Test Cabinet's own tooling baked in — here the Lattice toolchain a model
# develops a factory-simulation engine with (see the performance docs under
# `apps/docs/src/content/docs/testing/performance/`):
#
#   - the **Rust toolchain** with the `wasm32-unknown-unknown` target, so a
#     model's engine compiles to a wasm core module *in-container* during the run
#     (the case's `[build]` commands run here at run time);
#   - the **`lattice` CLI** (`/usr/local/bin/lattice`), the binary a model runs to
#     solve scenarios with the oracle and score its engine locally — the same
#     `lattice-host` the validator scores with, so a local result means what a
#     scored result means;
#   - the **engine buildkit** (`/opt/lattice/buildkit`), fresh copies of
#     `lattice-core` (the contract types + canonical checksum, and the
#     straightforward reference simulation the floor starter delegates to) and
#     `lattice-sdk` the model's `engine` crate path-depends on, so the seeded
#     workspace vendors nothing;
#   - the **reference engines** (pre-built wasm + readable source) under
#     `/opt/lattice/references`, the worked examples (naive + transport); and
#   - the **training scenarios** under `/opt/lattice/training`, the labelled
#     practice set the model iterates against (NOT the held-out scored set, which
#     lives only with the case and is never in this image).
#
# Baking these (rather than seeding them into every run's workspace, or building
# them from source in-container) is the same lockstep argument as the adversarial
# Foray tooling: the `lattice` CLI, the buildkit crates, and the reference modules
# are part of The Test Cabinet itself and must match the types and checksum the
# validator scores against, so they are compiled from THIS repository at
# image-build time and a run records the image digest. The build context is the
# repository root so the compile stage can see `crates/` and the committed training
# fixtures under `test-cases/` (see `containers/build.sh`).
#
# This image inherits everything from the base — the Node toolchain, the
# unprivileged `node` run user, the `/work` working directory, and the keep-alive
# CMD. End-to-end runs use the base image directly; the image a run resolves is
# selected by its test type (see crate `harness::resolve_run_image`).

# `BASE_IMAGE` is the base image to extend. It is declared here, BEFORE the first
# `FROM`, so it is a global build arg the final `FROM` below can consume — an `ARG`
# declared after a `FROM` is scoped to that stage and would be blank in a later
# `FROM`. `build.sh` passes the base image it just built (e.g. the local
# `test-cabinet-base:latest`, or a registry-qualified tag) so this image is always
# `FROM` the matching base.
ARG BASE_IMAGE=test-cabinet-base:latest

# --- Stage 1: compile the Lattice tooling from this repository ----------------
# A full Rust image (not the slim base) so the `lattice` CLI, the reference wasm
# modules, and the buildkit smoke build all compile here; only the artifacts are
# copied into the final image. The glibc target matches the bookworm-based base.
FROM docker.io/library/rust:1-bookworm AS lattice-build
WORKDIR /build
# The whole workspace is copied (minus `.dockerignore`'d paths) so cargo can
# resolve the workspace graph.
COPY . .
RUN rustup target add wasm32-unknown-unknown \
	# The `lattice` CLI (host target) — the oracle + local scorer baked onto PATH.
	&& cargo build --release -p lattice-cli \
	# The two reference engines, compiled to `wasm32-unknown-unknown` core modules —
	# the worked examples a model reads. Each crate is a `cdylib` named
	# `lattice_ref_*`, so it emits `lattice_ref_<name>.wasm`.
	&& cargo build --release --target wasm32-unknown-unknown \
		-p lattice-ref-naive -p lattice-ref-transport

# Assemble the engine buildkit and smoke-build it standalone. The two crates are
# copied VERBATIM (so they can never drift from the types and checksum the
# validator scores against) next to the de-workspaced root manifest that
# re-supplies their `workspace = true` inheritance; building the SDK to wasm
# against that root proves the buildkit resolves on its own before it is baked. A
# broken root (e.g. after a workspace-dependency bump the root no longer mirrors)
# fails the image build here.
RUN mkdir -p /opt/lattice/buildkit \
	&& cp -a crates/lattice-core /opt/lattice/buildkit/lattice-core \
	&& cp -a crates/lattice-sdk /opt/lattice/buildkit/lattice-sdk \
	&& cp containers/performance/buildkit/Cargo.toml /opt/lattice/buildkit/Cargo.toml \
	&& rm -rf /opt/lattice/buildkit/lattice-core/target \
		/opt/lattice/buildkit/lattice-sdk/target \
	# Build into a throwaway target dir so the baked buildkit stays source-only.
	&& cargo build --release --target wasm32-unknown-unknown \
		--manifest-path /opt/lattice/buildkit/lattice-sdk/Cargo.toml \
		--target-dir /tmp/buildkit-smoke

# --- Stage 2: the base run image, plus the Rust toolchain and the Lattice tooling
FROM ${BASE_IMAGE}

# The pinned Rust toolchain version installed for in-container engine builds. Pin
# it (rather than tracking `stable`) so every performance run compiles a model's
# engine with the same compiler, keeping produced wasm reproducible; bump it
# deliberately. This must stay compatible with the baked buildkit crates.
ARG RUST_VERSION=1.96.0

# Install the Rust toolchain into a system-wide, root-owned location so it is
# shared by every run rather than re-downloaded per run, and add the
# `wasm32-unknown-unknown` target the engine compiles to. rustup needs root to
# write under /usr/local, so this runs before the base image's `USER node` would
# otherwise take effect — switch to root explicitly, then drop back.
USER root
ENV RUSTUP_HOME=/usr/local/rustup \
	CARGO_HOME=/usr/local/cargo \
	PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
		| sh -s -- -y --no-modify-path --profile minimal \
			--default-toolchain "${RUST_VERSION}" \
			--target wasm32-unknown-unknown \
	# Make the toolchain world-readable/executable so the unprivileged `node` run
	# user can invoke `cargo`/`rustc` and the wasm target without owning the
	# install. CARGO_HOME's registry/cache must be writable by the run user so an
	# engine build can resolve and compile its dependencies at run time.
	&& chmod -R a+rX /usr/local/rustup /usr/local/cargo \
	&& mkdir -p /usr/local/cargo/registry \
	&& chown -R node:node /usr/local/cargo/registry \
	# The `ENV PATH` above only covers the container's main process and non-login
	# execs (e.g. the harness's run-time install command). The agent harness runs
	# its own shell commands through a *login* shell (`bash -lc`), which sources
	# `/etc/profile`; on Debian that unconditionally re-sets PATH to a fixed
	# default, dropping `/usr/local/cargo/bin` — so an agent that shells out to
	# `cargo`/`rustc` to build its engine would not find them. Drop a profile.d
	# snippet that re-adds cargo's bin dir; profile.d scripts run *after*
	# `/etc/profile` sets its default PATH, so login shells see `cargo`.
	&& printf 'export PATH=/usr/local/cargo/bin:$PATH\n' > /etc/profile.d/rust-cargo.sh \
	&& chmod a+r /etc/profile.d/rust-cargo.sh

# Bake the `lattice` CLI onto PATH. `/usr/local/bin` is root-owned (COPY writes as
# root regardless of the inherited run user); the unprivileged run user only
# executes it. A model invokes it as `lattice solve`/`lattice run` to iterate.
COPY --from=lattice-build /build/target/release/lattice /usr/local/bin/lattice

# Bake the engine buildkit — the verified, source-only `lattice-core` +
# `lattice-sdk` the seeded `engine` crate path-depends on (no vendor folder in the
# run workspace). The model never writes here; cargo writes an engine build's
# artifacts into the run workspace's own target dir.
COPY --from=lattice-build /opt/lattice/buildkit /opt/lattice/buildkit

# Bake the reference engines (pre-built wasm + readable Rust source) — the worked
# examples a model reads and can `lattice run`. The reference wasm modules are
# renamed from their `lattice_ref_*` crate artifact names to the short names the
# specs reference.
COPY --from=lattice-build /build/target/wasm32-unknown-unknown/release/lattice_ref_naive.wasm /opt/lattice/references/naive.wasm
COPY --from=lattice-build /build/target/wasm32-unknown-unknown/release/lattice_ref_transport.wasm /opt/lattice/references/transport.wasm
COPY crates/lattice-ref-naive/src/lib.rs /opt/lattice/references/naive/lib.rs
COPY crates/lattice-ref-transport/src/lib.rs /opt/lattice/references/transport/lib.rs

# Bake the committed training scenarios — the labelled practice set the model
# iterates against (each `<name>/{scenario.json,expected.json}`). These are copied
# from the case's version folder so they stay in lockstep with the engine the
# validator scores against; they are deliberately disjoint from the HELD-OUT scored
# set, which lives only with the case and is never copied here.
COPY test-cases/performance-factorio/v1.0.0/references/training /opt/lattice/training

# Make everything under /opt/lattice world-readable (and directories traversable)
# so the unprivileged run user can read the buildkit, references, and training set
# and build an engine against them. It is read-only to the run user — it never
# writes here.
RUN chmod -R a+rX /opt/lattice

# Expose the baked Lattice tree's root so specs and a model can reference it by
# name (`$LATTICE_HOME/training/…`) rather than hard-coding the path.
ENV LATTICE_HOME=/opt/lattice

# Drop back to the unprivileged run user the base image runs as. The base already
# sets `WORKDIR /work` and the keep-alive CMD, so nothing else is needed here.
USER node
