# The adversarial run-container image for The Test Cabinet.
#
# Every adversarial run executes in this one image (all adversarial test cases
# share it). It is the base run-container image plus exactly one addition: the
# Rust toolchain with the `wasm32-unknown-unknown` target, so a model's
# controller compiles to a wasm core module *in-container* during the run (see
# the adversarial docs under
# `apps/docs/src/content/docs/testing/adversarial/`).
#
# Unlike the asset-generation image, nothing of The Test Cabinet's own is baked
# in here: the controller a model writes is built by the model inside the
# container (the `[build]` commands its test case declares run here at run time),
# and the host that *runs* the produced wasm (the `foray` engine + wasmtime) is
# part of the orchestrator/validator, not this image. So the only thing this
# image adds beyond the base is the build toolchain that turns the model's Rust
# source into wasm — there is no compile stage and no repository context needed.
#
# This image inherits everything from the base — the Node toolchain, the
# unprivileged `node` run user, the `/work` working directory, and the keep-alive
# CMD — so it only adds the Rust toolchain below. End-to-end runs use the base
# image directly; the image a run resolves is selected by its test type (see
# crate `harness::resolve_run_image`).

# `BASE_IMAGE` is the base image to extend. It is declared here, BEFORE the first
# `FROM`, so it is a global build arg the `FROM` for the run image below can
# consume — an `ARG` declared after a `FROM` is scoped to that stage and would be
# blank in a later `FROM`. `build.sh` passes the base image it just built (e.g.
# the local `test-cabinet-base:latest`, or a registry-qualified tag) so this image
# is always `FROM` the matching base.
ARG BASE_IMAGE=test-cabinet-base:latest

FROM ${BASE_IMAGE}

# The pinned Rust toolchain version installed for in-container controller builds.
# Pin it (rather than tracking `stable`) so every adversarial run compiles a
# model's controller with the same compiler, keeping produced wasm reproducible;
# bump it deliberately. This must stay compatible with the controller SDK and the
# reference controller sources the run is seeded with.
ARG RUST_VERSION=1.83.0

# Install the Rust toolchain into a system-wide, root-owned location so it is
# shared by every run rather than re-downloaded per run, and add the
# `wasm32-unknown-unknown` target the controller compiles to. rustup needs root
# to write under /usr/local, so this runs before the base image's `USER node`
# would otherwise take effect — switch to root explicitly, then drop back.
USER root
ENV RUSTUP_HOME=/usr/local/rustup \
	CARGO_HOME=/usr/local/cargo \
	PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
		| sh -s -- -y --no-modify-path --profile minimal \
			--default-toolchain "${RUST_VERSION}" \
			--target wasm32-unknown-unknown \
	# Make the toolchain world-readable/executable so the unprivileged `node`
	# run user can invoke `cargo`/`rustc` and the wasm target without owning the
	# install. CARGO_HOME's registry/cache must be writable by the run user so a
	# controller build can resolve and compile its dependencies at run time.
	&& chmod -R a+rX /usr/local/rustup /usr/local/cargo \
	&& mkdir -p /usr/local/cargo/registry \
	&& chown -R node:node /usr/local/cargo/registry

# Drop back to the unprivileged run user the base image runs as. The base already
# sets `WORKDIR /work` and the keep-alive CMD, so nothing else is needed here.
USER node
