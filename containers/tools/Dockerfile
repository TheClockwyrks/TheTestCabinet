# syntax=docker/dockerfile:1
# The shared asset-tooling BUILDER image for The Test Cabinet's run containers.
#
# This is NOT a run image: nothing ever executes in it and it is never published.
# It exists solely so the ~20 asset-generation binaries baked into the run images
# (`draw`, `voxel`, `mc`, `pbr`, `music`, …) are compiled ONCE, in one cargo
# invocation over one shared dependency graph, instead of once per run image.
#
# Why this exists
# ---------------
# Each asset-generation image used to carry its own `FROM rust … / COPY . . /
# cargo build -p <crate>` stage with no cargo cache. Because every one of those
# stages started from an empty target directory AND an empty cargo registry, the
# shared dependency graph was recompiled from scratch for every image: 1865
# crate-compilations across the set where only 182 distinct crates exist. `syn`,
# `serde` and `proc-macro2` were each built 23 times; `test-cabinet-model-core` 16
# times; `test-cabinet-voxel-mesh` 11 times; and the ~90-crate `wgpu`/`naga` graph
# that the 13 rendering tools share was built 13 times over. Worse, `ui` and
# `material` compiled the *identical* `test-cabinet-paint` crate twice, differing
# only in which `--bin` they asked for.
#
# Building every binary here in a single pass collapses that to one compile of the
# union, and the BuildKit cache mounts below then make an incremental rebuild cost
# only the crates that actually changed.
#
# What consumes it
# ----------------
# Every asset-generation image (`containers/<kind>/Dockerfile`) declares a global
# `TOOLS_IMAGE` build arg, resolves it to a named stage, and `COPY --from=tools`s
# just the binaries it needs. `build.sh` builds this image first and passes the tag
# it just produced, exactly as it does for `BASE_IMAGE`. (A `COPY --from` cannot
# interpolate a build arg directly — BuildKit requires the arg be resolved through a
# named `FROM` stage first — which is why those Dockerfiles carry a
# `FROM ${TOOLS_IMAGE} AS tools` line.)
#
# The adversarial and performance images are deliberately NOT built from this
# image: they compile to `wasm32-unknown-unknown` as well as the host target and
# assemble a standalone controller/engine buildkit, so they keep their own build
# stages (with the same cache mounts applied directly).
#
# The binaries are dynamically linked against bookworm's glibc, matching the
# bookworm-based run images that consume them — do not statically link musl here.

# --- Stage 1: compile every asset-generation binary in one pass --------------
# The Rust version is pinned to match `containers/base-wasm/Dockerfile` (and
# `rust-toolchain.toml`), so the tools baked into a run image are built with the
# same compiler a model's own in-container build uses. Bump them together.
FROM docker.io/library/rust:1.97.1-bookworm AS build
WORKDIR /build

# The whole workspace is copied (minus `.dockerignore`'d paths) so cargo can
# resolve the workspace graph.
COPY . .

# The registry/git mounts take BuildKit's default id (their target path), which is
# the same id the service images under deployments/images/ use — so the crates.io
# index and the downloaded crate tarballs are fetched once for the whole repository
# rather than re-downloaded per image (a cold registry cost ~7s of every build
# before this). They keep the default `shared` mode: cargo does its own locking
# there and concurrent readers are fine. The target/ mount gets an explicit id so it
# is unmistakably this builder's, and `sharing=locked` because cargo locks a whole
# target directory anyway — making it explicit turns a would-be "Blocking waiting
# for file lock" stall into an orderly queue.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
	--mount=type=cache,target=/usr/local/cargo/git \
	--mount=type=cache,target=/build/target,id=tcab-container-tools,sharing=locked \
	# Refresh the COPYed sources' mtimes before building. BuildKit preserves the
	# mtimes a file had in the build context, and it replays them verbatim when the
	# `COPY . .` layer is served from cache — so a cache-hit COPY can hand cargo
	# sources that are OLDER than artifacts a previous build of a different branch
	# left in the persistent target/ mount. Cargo's freshness check is mtime-based,
	# so it would call those stale artifacts fresh and silently bake the wrong
	# binary. Touching the tree makes every source unambiguously newer than the
	# cache. This is cheap here precisely because it is done ONCE for the whole set,
	# and because it dirties only the workspace crates: registry dependencies are
	# fingerprinted by version+features rather than mtime, so the third-party crates
	# already in the target mount stay fresh and are not rebuilt.
	find /build -path /build/target -prune -o -type f -exec touch {} + \
	# One cargo invocation over the union of every tool's dependency graph.
	# `--bins` takes all binaries each named package exposes, which is what the run
	# images need: `test-cabinet-draw` yields `draw` + `draw-sheet`, and
	# `test-cabinet-paint` yields `paint`, `ui`, `texture` and `pbr`.
	&& cargo build --release --bins \
		-p test-cabinet-draw \
		-p test-cabinet-voxel \
		-p test-cabinet-voxel-anim \
		-p test-cabinet-mc \
		-p test-cabinet-mc-anim \
		-p test-cabinet-sn \
		-p test-cabinet-sn-anim \
		-p test-cabinet-dc \
		-p test-cabinet-dc-anim \
		-p test-cabinet-mc-skin \
		-p test-cabinet-sn-skin \
		-p test-cabinet-dc-skin \
		-p test-cabinet-paint \
		-p test-cabinet-particle-2d \
		-p test-cabinet-particle-3d \
		-p test-cabinet-sfx-synth \
		-p test-cabinet-sfx-sample \
		-p test-cabinet-music \
	# target/ is a cache mount, not a layer, so the binaries must be copied to a
	# stable path INSIDE this RUN — before the mount is detached — for the export
	# stage below to see them. Listing them explicitly (rather than globbing
	# target/release/*) keeps a stray build artifact from riding along and makes a
	# renamed or dropped binary fail the image build here rather than at run time.
	&& mkdir -p /out \
	&& cp \
		target/release/draw \
		target/release/draw-sheet \
		target/release/voxel \
		target/release/voxel-anim \
		target/release/mc \
		target/release/mc-anim \
		target/release/sn \
		target/release/sn-anim \
		target/release/dc \
		target/release/dc-anim \
		target/release/mc-skin \
		target/release/sn-skin \
		target/release/dc-skin \
		target/release/paint \
		target/release/ui \
		target/release/texture \
		target/release/pbr \
		target/release/particle-2d \
		target/release/particle-3d \
		target/release/sfx-synth \
		target/release/sfx-sample \
		target/release/music \
		/out/

# --- Stage 2: export just the binaries ---------------------------------------
# `scratch` so the published-nowhere builder carries no base layers: the image is
# only ever a `COPY --from` source, and keeping it to the binaries alone means the
# consuming images pull the smallest possible thing out of the local image store.
FROM scratch
COPY --from=build /out /out
