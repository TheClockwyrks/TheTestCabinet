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
FROM docker.io/library/rust:1.97.1-bookworm AS foray-build
WORKDIR /build
# The whole workspace is copied (minus `.dockerignore`'d paths) so cargo can
# resolve the workspace graph.
COPY . .
# The cargo registry/git caches are BuildKit cache mounts shared with every other
# image in the repository (they take the default id, their target path), so the
# crates.io index and the crate tarballs are fetched once rather than re-downloaded
# per image. target/ gets its OWN id rather than sharing the asset tooling's: this
# is a separate cargo invocation with a different package selection, and cargo
# unifies features across whatever set is selected — two invocations sharing one
# target dir would keep invalidating each other's fingerprints and rebuild on every
# alternation. `sharing=locked` because cargo locks a whole target dir anyway.
#
# rustup's home is deliberately NOT mounted: `rustup target add` below must persist
# into the image layer for the buildkit smoke build in the next RUN to use it, and a
# cache mount is detached when its RUN ends.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
	--mount=type=cache,target=/usr/local/cargo/git \
	--mount=type=cache,target=/build/target,id=tcab-container-foray,sharing=locked \
	rustup target add wasm32-unknown-unknown \
	# Refresh the COPYed sources' mtimes: BuildKit replays the mtimes baked into a
	# cache-hit `COPY . .` layer, which can be OLDER than artifacts an earlier build
	# left in the persistent target/ mount — and cargo's freshness check is
	# mtime-based, so it would reuse those stale artifacts and bake the wrong binary.
	# Only the handful of workspace crates is dirtied; registry dependencies are
	# fingerprinted by version+features, not mtime.
	&& find /build -path /build/target -prune -o -type f -exec touch {} + \
	# The `foray` CLI (host target) — the local match runner baked onto PATH below.
	&& cargo build --release -p foray-cli \
	# The three reference controllers, compiled to `wasm32-unknown-unknown` core
	# modules — the baselines a model plays against. Each crate is a `cdylib` named
	# `foray_ref_*`, so it emits `foray_ref_<name>.wasm`.
	&& cargo build --release --target wasm32-unknown-unknown \
		-p foray-ref-border-soldier -p foray-ref-greedy-raider -p foray-ref-random \
	# target/ is a cache mount, not a layer, so every artifact the run image needs
	# must be copied to a stable path INSIDE this RUN, before the mount is detached.
	# The reference modules are renamed from their `foray_ref_*` crate artifact names
	# to the short names the specs reference as they are copied.
	&& mkdir -p /out/references \
	&& cp target/release/foray /out/foray \
	&& cp target/wasm32-unknown-unknown/release/foray_ref_border_soldier.wasm \
		/out/references/border-soldier.wasm \
	&& cp target/wasm32-unknown-unknown/release/foray_ref_greedy_raider.wasm \
		/out/references/greedy-raider.wasm \
	&& cp target/wasm32-unknown-unknown/release/foray_ref_random.wasm \
		/out/references/random.wasm

# Assemble the controller buildkit and smoke-build it standalone. The two crates
# are copied VERBATIM (so they can never drift from the engine the validator
# scores against) next to the de-workspaced root manifest that re-supplies their
# `workspace = true` inheritance; building the SDK to wasm against that root proves
# the buildkit resolves on its own before it is baked. A broken root (e.g. after a
# workspace-dependency bump the root no longer mirrors) fails the image build here.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
	--mount=type=cache,target=/usr/local/cargo/git \
	--mount=type=cache,target=/tmp/buildkit-smoke,id=tcab-foray-buildkit-smoke,sharing=locked \
	mkdir -p /opt/foray/buildkit \
	&& cp -a crates/foray-core /opt/foray/buildkit/foray-core \
	&& cp -a crates/foray-controller-sdk /opt/foray/buildkit/foray-controller-sdk \
	&& cp containers/adversarial/buildkit/Cargo.toml /opt/foray/buildkit/Cargo.toml \
	&& rm -rf /opt/foray/buildkit/foray-core/target \
		/opt/foray/buildkit/foray-controller-sdk/target \
	# Build into a throwaway target dir so the baked buildkit stays source-only. It
	# is a cache mount so the smoke build is incremental across image builds; nothing
	# is copied out of it, since proving the buildkit compiles is the entire point.
	# The sources it builds are the `cp -a`'d copies above, which are freshly written
	# in this RUN and so always newer than anything in the mount — no mtime refresh
	# is needed here.
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
COPY --from=foray-build /out/foray /usr/local/bin/foray

# Bake the controller buildkit — the verified, source-only `foray-core` +
# `foray-controller-sdk` the seeded `controller` crate path-depends on (no vendor
# folder in the run workspace). The model never writes here; cargo writes a
# controller build's artifacts into the run workspace's own target dir.
COPY --from=foray-build /opt/foray/buildkit /opt/foray/buildkit

# Bake the reference controllers (pre-built wasm + readable Rust source) and the
# canonical map — the baselines a model plays against with `foray simulate` and
# reads as worked examples. The wasm modules were renamed from their `foray_ref_*`
# crate artifact names to the short names the specs reference when they were copied
# out of the build stage's target/ cache mount.
COPY --from=foray-build /out/references/border-soldier.wasm /opt/foray/references/border-soldier.wasm
COPY --from=foray-build /out/references/greedy-raider.wasm /opt/foray/references/greedy-raider.wasm
COPY --from=foray-build /out/references/random.wasm /opt/foray/references/random.wasm
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
