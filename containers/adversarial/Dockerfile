# The adversarial run-container image for The Test Cabinet.
#
# Every adversarial run executes in this one image (all adversarial test cases
# share it). It is the Rust/wasm base image (`base-wasm`) — which already provides
# the **Rust toolchain** with the `wasm32-unknown-unknown` target a model's
# controller compiles to a wasm core module with *in-container* during the run — plus,
# like the asset-generation images, The Test Cabinet's own tooling baked in: here the
# Foray toolchain a model develops a controller with (see the adversarial docs under
# `apps/docs/src/content/docs/testing/adversarial/`):
#
#   - the **`foray` CLI** (`/usr/local/bin/foray`), the binary a model runs its
#     controller through to play local matches against the baselines — the same
#     `foray-host` engine the validator scores with, so a local win means what a
#     scored win means;
#   - the **controller buildkit** (`/opt/foray/buildkit`), fresh copies of
#     `foray-core` and `foray-controller-sdk` the model's `controller` crate
#     path-depends on to build, so the seeded workspace vendors nothing; and
#   - the **reference controllers** (pre-built wasm + readable source) and the
#     **canonical map** under `/opt/foray`, the baselines a model plays against.
#
# Baking these (rather than seeding them into every run's workspace, or building
# them from source in-container) is the same lockstep argument as the
# asset-generation `draw` binary: the `foray` CLI, the buildkit crates, and the
# reference modules are part of The Test Cabinet itself and must match the engine
# the validator scores against, so they are compiled from THIS repository at
# image-build time and a run records the image digest. The build context is the
# repository root so the compile stage can see `crates/` (see `containers/build.sh`).
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

# --- Stage 1: compile the Foray tooling from this repository ----------------
# A full Rust image (not the slim base) so the `foray` CLI, the reference wasm
# modules, and the buildkit smoke build all compile here; only the artifacts are
# copied into the final image. The glibc target matches the bookworm-based base.
FROM docker.io/library/rust:1-bookworm AS foray-build
WORKDIR /build
# The whole workspace is copied (minus `.dockerignore`'d paths) so cargo can
# resolve the workspace graph.
COPY . .
RUN rustup target add wasm32-unknown-unknown \
	# The `foray` CLI (host target) — the local match runner baked onto PATH below.
	&& cargo build --release -p foray-cli \
	# The three reference controllers, compiled to `wasm32-unknown-unknown` core
	# modules — the baselines a model plays against. Each crate is a `cdylib` named
	# `foray_ref_*`, so it emits `foray_ref_<name>.wasm`.
	&& cargo build --release --target wasm32-unknown-unknown \
		-p foray-ref-border-soldier -p foray-ref-greedy-raider -p foray-ref-random

# Assemble the controller buildkit and smoke-build it standalone. The two crates
# are copied VERBATIM (so they can never drift from the engine the validator
# scores against) next to the de-workspaced root manifest that re-supplies their
# `workspace = true` inheritance; building the SDK to wasm against that root proves
# the buildkit resolves on its own before it is baked. A broken root (e.g. after a
# workspace-dependency bump the root no longer mirrors) fails the image build here.
RUN mkdir -p /opt/foray/buildkit \
	&& cp -a crates/foray-core /opt/foray/buildkit/foray-core \
	&& cp -a crates/foray-controller-sdk /opt/foray/buildkit/foray-controller-sdk \
	&& cp containers/adversarial/buildkit/Cargo.toml /opt/foray/buildkit/Cargo.toml \
	&& rm -rf /opt/foray/buildkit/foray-core/target \
		/opt/foray/buildkit/foray-controller-sdk/target \
	# Build into a throwaway target dir so the baked buildkit stays source-only.
	&& cargo build --release --target wasm32-unknown-unknown \
		--manifest-path /opt/foray/buildkit/foray-controller-sdk/Cargo.toml \
		--target-dir /tmp/buildkit-smoke

# --- Stage 2: the base-wasm run image, plus the Foray tooling ----------------
# `FROM` base-wasm, which already carries the Rust + `wasm32-unknown-unknown`
# toolchain a controller compiles with; this image only adds the Foray tooling.
FROM ${BASE_IMAGE}

# The COPY/chmod below write and re-permission root-owned paths, so switch to root
# for them; base-wasm ends on `USER node`, and we drop back at the end.
USER root

# Bake the `foray` CLI onto PATH. `/usr/local/bin` is root-owned (COPY writes as
# root regardless of the inherited run user); the unprivileged run user only
# executes it. A model invokes it as `foray simulate …` to play local matches.
COPY --from=foray-build /build/target/release/foray /usr/local/bin/foray

# Bake the controller buildkit — the verified, source-only `foray-core` +
# `foray-controller-sdk` the seeded `controller` crate path-depends on (no vendor
# folder in the run workspace). The model never writes here; cargo writes a
# controller build's artifacts into the run workspace's own target dir.
COPY --from=foray-build /opt/foray/buildkit /opt/foray/buildkit

# Bake the reference controllers (pre-built wasm + readable Rust source) and the
# canonical map — the baselines a model plays against with `foray simulate` and
# reads as worked examples. The reference wasm modules are renamed from their
# `foray_ref_*` crate artifact names to the short names the specs reference.
COPY --from=foray-build /build/target/wasm32-unknown-unknown/release/foray_ref_border_soldier.wasm /opt/foray/references/border-soldier.wasm
COPY --from=foray-build /build/target/wasm32-unknown-unknown/release/foray_ref_greedy_raider.wasm /opt/foray/references/greedy-raider.wasm
COPY --from=foray-build /build/target/wasm32-unknown-unknown/release/foray_ref_random.wasm /opt/foray/references/random.wasm
COPY crates/foray-ref-border-soldier/src/lib.rs /opt/foray/references/border-soldier/lib.rs
COPY crates/foray-ref-greedy-raider/src/lib.rs /opt/foray/references/greedy-raider/lib.rs
COPY crates/foray-ref-random/src/lib.rs /opt/foray/references/random/lib.rs
COPY crates/foray-core/maps/mirror-32x16.toml /opt/foray/maps/mirror-32x16.toml

# Make everything under /opt/foray world-readable (and directories traversable) so
# the unprivileged run user can read the buildkit, references, and map and build a
# controller against them. It is read-only to the run user — it never writes here.
RUN chmod -R a+rX /opt/foray

# Expose the baked Foray tree's root so specs and a model can reference it by name
# (`$FORAY_HOME/references/border-soldier.wasm`) rather than hard-coding the path.
ENV FORAY_HOME=/opt/foray

# Drop back to the unprivileged run user the base image runs as. The base already
# sets `WORKDIR /work` and the keep-alive CMD, so nothing else is needed here.
USER node
