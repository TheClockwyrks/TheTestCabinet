# The performance run-container image for The Test Cabinet.
#
# Every performance run executes in this one image (all performance test cases
# share it). It is the Rust/wasm base image (`base-wasm`) — which already provides
# the **Rust toolchain** with the `wasm32-unknown-unknown` target a model's engine
# compiles to a wasm core module with *in-container* during the run — plus, like the
# adversarial image, The Test Cabinet's own tooling baked in: here the Lattice
# toolchain a model develops a factory-simulation engine with (see the performance
# docs under `apps/docs/src/content/docs/testing/performance/`):
#
#   - the **`lattice` CLI** (`/usr/local/bin/lattice`), the binary a model runs to
#     solve scenarios with the oracle and score its engine locally — the same
#     `lattice-host` the validator scores with, so a local result means what a
#     scored result means;
#   - the **engine buildkit** (`/opt/lattice/buildkit`), fresh copies of
#     `lattice-core` (the contract types + canonical checksum, and the
#     straightforward reference simulation the floor starter delegates to) and
#     `lattice-sdk` the model's `engine` crate path-depends on, so the seeded
#     workspace vendors nothing;
#   - the **training scenarios** under `/opt/lattice/training`, the labelled
#     practice set the model iterates against (NOT the held-out scored set, which
#     lives only with the case and is never in this image).
#
# Baking these (rather than seeding them into every run's workspace, or building
# them from source in-container) is the same lockstep argument as the adversarial
# Foray tooling: the `lattice` CLI and the buildkit crates are part of The Test
# Cabinet itself and must match the types and checksum the
# validator scores against, so they are compiled from THIS repository at
# image-build time and a run records the image digest. The build context is the
# repository root so the compile stage can see `crates/` and the committed training
# fixtures under `test-cases/` (see `containers/build.sh`).
#
# This image inherits everything from base-wasm — the Node toolchain, the Rust +
# `wasm32-unknown-unknown` toolchain, the unprivileged `node` run user, the `/work`
# working directory, and the keep-alive CMD. The image a run resolves is selected by
# its test type (see crate `harness::resolve_run_image`).

# `BASE_IMAGE` is the base image to extend — the Rust/wasm base (`base-wasm`), which
# carries the pinned Rust toolchain (the `RUST_VERSION` there must stay compatible
# with the buildkit crates this image bakes). It is declared here, BEFORE the first
# `FROM`, so it is a global build arg the final `FROM` below can consume — an `ARG`
# declared after a `FROM` is scoped to that stage and would be blank in a later
# `FROM`. `build.sh` passes the base-wasm image it just built (e.g. the local
# `test-cabinet-base-wasm:latest`, or a registry-qualified tag) so this image is
# always `FROM` the matching base-wasm.
ARG BASE_IMAGE=test-cabinet-base-wasm:latest

# --- Stage 1: compile the Lattice tooling from this repository ----------------
# A full Rust image (not the slim base) so the `lattice` CLI and the buildkit smoke
# build both compile here; only the artifacts are copied into the final image. The
# glibc target matches the bookworm-based base.
FROM docker.io/library/rust:1-bookworm AS lattice-build
WORKDIR /build
# The whole workspace is copied (minus `.dockerignore`'d paths) so cargo can
# resolve the workspace graph.
COPY . .
# The `lattice` CLI (host target) — the oracle + local scorer baked onto PATH. The
# wasm target is for the buildkit smoke build below.
RUN rustup target add wasm32-unknown-unknown \
	&& cargo build --release -p lattice-cli

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

# --- Stage 2: the base-wasm run image, plus the Lattice tooling --------------
# `FROM` base-wasm, which already carries the Rust + `wasm32-unknown-unknown`
# toolchain an engine compiles with; this image only adds the Lattice tooling.
FROM ${BASE_IMAGE}

# The COPY/chmod below write and re-permission root-owned paths, so switch to root
# for them; base-wasm ends on `USER node`, and we drop back at the end.
USER root

# Bake the `lattice` CLI onto PATH. `/usr/local/bin` is root-owned (COPY writes as
# root regardless of the inherited run user); the unprivileged run user only
# executes it. A model invokes it as `lattice solve`/`lattice run` to iterate.
COPY --from=lattice-build /build/target/release/lattice /usr/local/bin/lattice

# Bake the engine buildkit — the verified, source-only `lattice-core` +
# `lattice-sdk` the seeded `engine` crate path-depends on (no vendor folder in the
# run workspace). The model never writes here; cargo writes an engine build's
# artifacts into the run workspace's own target dir.
COPY --from=lattice-build /opt/lattice/buildkit /opt/lattice/buildkit

# Do NOT bake the `crates/lattice-ref-*` engines here, as wasm or as source. A
# performance run is scored on fuel, so an efficient reference on disk is the answer
# key: `transport.wasm` is a module the model can `lattice run` to read the
# reference's fuel and tune against, and `transport/lib.rs` states the winning
# strategy in its module doc. The reference reaches the model only through the
# `lattice` CLI, which reports correctness and the model's own fuel.

# Bake the committed training scenarios — the labelled practice set the model
# iterates against (each `<name>/{scenario.json,expected.json}`). These are copied
# from the case's version folder so they stay in lockstep with the engine the
# validator scores against; they are deliberately disjoint from the HELD-OUT scored
# set, which lives only with the case and is never copied here.
COPY test-cases/performance/hard/lattice/v1.0.0/references/training /opt/lattice/training

# Make everything under /opt/lattice world-readable (and directories traversable)
# so the unprivileged run user can read the buildkit and the training set and build
# an engine against them. It is read-only to the run user — it never writes here.
RUN chmod -R a+rX /opt/lattice

# Expose the baked Lattice tree's root so specs and a model can reference it by
# name (`$LATTICE_HOME/training/…`) rather than hard-coding the path.
ENV LATTICE_HOME=/opt/lattice

# Drop back to the unprivileged run user the base image runs as. The base already
# sets `WORKDIR /work` and the keep-alive CMD, so nothing else is needed here.
USER node
