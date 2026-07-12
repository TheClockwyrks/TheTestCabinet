# The Rust/wasm base run-container image for The Test Cabinet.
#
# This is the shared **middle layer** between the pure-Node base and every run
# image whose model compiles Rust to wasm in-container: it is the base run image
# plus a full browser-oriented Rust → WebAssembly toolchain baked in and shared by
# every run, rather than re-downloaded per run. The images built `FROM` it are:
#
#   - the **end-to-end** run image itself — end-to-end runs resolve THIS image (see
#     `harness::resolve_run_image`), so any end-to-end (or full-stack) case may
#     author its core simulation in Rust and ship it as a committed wasm build
#     input (see `apps/docs/src/content/docs/testing/full-stack/`);
#   - the **full-stack-2d** image (`containers/full-stack-2d/Dockerfile`), which
#     adds the six 2D asset-generation binaries and the audio packs on top; and
#   - the **adversarial** and **performance** images
#     (`containers/adversarial/Dockerfile`, `containers/performance/Dockerfile`),
#     which add their Foray / Lattice tooling on top and no longer install a Rust
#     toolchain of their own — they inherit it from here.
#
# The pure-Node base (`containers/base/Dockerfile`) stays free of Rust: the
# asset-generation images (sprite, voxel, …) are built `FROM` it directly, and an
# asset-generation run never compiles Rust, so the toolchain — a large layer — does
# not belong in the image every one of those runs shares. This image is the one
# extra hop that carries it for the runs that do.
#
# What it bakes on top of the base:
#   - the **Rust toolchain** (pinned, minimal profile) with the
#     `wasm32-unknown-unknown` target, so `cargo build --target wasm32-unknown-unknown`
#     works in-container during a run;
#   - **`wasm-bindgen-cli`**, so a model can use the `wasm-bindgen` crate to pass
#     rich values (structs, slices, strings) across the JS ↔ wasm boundary rather
#     than hand-marshalling integers through linear memory — the ergonomic path for
#     a browser simulation core; and
#   - **`wasm-pack`** plus **`binaryen`** (`wasm-opt`), the conventional
#     build/optimize pipeline `wasm-pack` drives — present so an offline run never
#     needs to fetch a matching `wasm-opt` at build time.
#
# IMPORTANT — the compiled wasm is a build INPUT, not a build step. As with the
# asset-generation binaries, this toolchain is on `PATH` only while the run is live;
# it is NOT present when a build is re-run to validate it or when the published
# source is rebuilt (that rebuild is a bare Node-only `npm ci && npm run build` off
# the run container — see `crates/core/src/validator.rs`). A case's build must
# therefore commit the compiled `.wasm` (and any generated JS glue) and consume it
# directly; `npm run build` must NOT invoke `cargo`/`wasm-pack`, exactly as it must
# not shell out to `draw`. The case's specification is where that contract is stated.
#
# The build context is the repository root (like the other images) so a repo-root
# `.dockerignore` keeps it lean; this image itself compiles nothing from `crates/`,
# it only installs the public toolchain.

# `BASE_IMAGE` is the pure-Node base image to extend. It is declared BEFORE the
# `FROM` so it is a global build arg the `FROM` below can consume. `build.sh` passes
# the base image it just built (e.g. the local `test-cabinet-base:latest`, or a
# registry-qualified tag) so this image is always `FROM` the matching base.
ARG BASE_IMAGE=test-cabinet-base:latest

FROM ${BASE_IMAGE}

# The pinned Rust toolchain version. Pin it (rather than tracking `stable`) so every
# run compiles a model's wasm with the same compiler, keeping produced wasm
# reproducible; bump it deliberately. It must stay compatible with the buildkit
# crates the adversarial and performance images bake on top (Foray / Lattice), which
# path-depend on `crates/` at this same toolchain — bump all three together.
ARG RUST_VERSION=1.96.0

# The pinned wasm tooling versions. `wasm-bindgen-cli` MUST match the version of the
# `wasm-bindgen` crate a build depends on — a skew between the CLI and the crate is a
# hard build error — so a case's specification pins its `wasm-bindgen` crate to this
# exact version. `wasm-pack` is the convenience wrapper on top. Bump the CLI and the
# spec's crate pin together.
ARG WASM_BINDGEN_VERSION=0.2.100
ARG WASM_PACK_VERSION=0.13.1

USER root

# `binaryen` provides `wasm-opt`, the optimizer `wasm-pack` invokes. Install it from
# apt (already how the base gets its system libraries) so an offline run never has to
# fetch a matching optimizer. `pkg-config` + `libssl-dev` are build-time headers some
# `cargo install` dependency graphs still want; they cost little and remove a class
# of source-build failures.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		binaryen \
		libssl-dev \
		pkg-config \
	&& rm -rf /var/lib/apt/lists/*

# Install the Rust toolchain into a system-wide, root-owned location so it is shared
# by every run rather than re-downloaded per run, and add the
# `wasm32-unknown-unknown` target. rustup needs root to write under /usr/local, so
# this runs as root (the base image's run user is `node`); we drop back at the end.
ENV RUSTUP_HOME=/usr/local/rustup \
	CARGO_HOME=/usr/local/cargo \
	PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
		| sh -s -- -y --no-modify-path --profile minimal \
			--default-toolchain "${RUST_VERSION}" \
			--target wasm32-unknown-unknown \
	# Install the browser wasm tooling into CARGO_HOME/bin (already on PATH above).
	# `--locked` builds against each tool's committed lockfile for a reproducible
	# install. These compile from source for the image's build architecture, so the
	# same Dockerfile produces a working image on x86_64 and aarch64 hosts alike.
	&& cargo install wasm-bindgen-cli --version "${WASM_BINDGEN_VERSION}" --locked \
	&& cargo install wasm-pack --version "${WASM_PACK_VERSION}" --locked \
	# Make the toolchain and the installed CLIs world-readable/executable so the
	# unprivileged `node` run user can invoke `cargo`/`rustc`/`wasm-bindgen`/`wasm-pack`
	# and the wasm target without owning the install.
	&& chmod -R a+rX /usr/local/rustup /usr/local/cargo \
	# CARGO_HOME's registry/cache must be writable by the run user so a build can
	# resolve and compile its own crate dependencies at run time.
	&& mkdir -p /usr/local/cargo/registry \
	&& chown -R node:node /usr/local/cargo/registry \
	# The `ENV PATH` above only covers the container's main process and non-login
	# execs (e.g. the harness's run-time install command). The agent harness runs its
	# own shell commands through a *login* shell (`bash -lc`), which sources
	# `/etc/profile`; on Debian that unconditionally re-sets PATH to a fixed default,
	# dropping `/usr/local/cargo/bin` — so an agent that shells out to `cargo` would
	# not find it. Drop a profile.d snippet that re-adds cargo's bin dir; profile.d
	# scripts run *after* `/etc/profile` sets its default PATH, so login shells see it.
	&& printf 'export PATH=/usr/local/cargo/bin:$PATH\n' > /etc/profile.d/rust-cargo.sh \
	&& chmod a+r /etc/profile.d/rust-cargo.sh

# Drop back to the unprivileged run user the base image runs as. The base already
# sets `WORKDIR /work` and the keep-alive CMD, so nothing else is needed here.
USER node
