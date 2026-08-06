# The **gg variant** of a Test Cabinet run image: that image, plus the language toolchains
# a gg run's responses-as-code programs are compiled with.
#
# One parameterized Dockerfile serves every gg variant. The variants differ only in which
# image they are `FROM` — `build.sh` passes it as `BASE_IMAGE`, the same way `game-jam` is
# built `FROM` the full-stack-2d image it inherits everything from. Writing one file per
# variant would be one file per parent saying the same two lines.
#
# Why the variant exists rather than a layer on the shared image: the toolchains are for
# ONE harness. Every other harness installs a CLI into the run container at run time and
# has no compiler on its turn path at all, so a run it drives must not pull gigabytes it
# cannot use — and must not offer a model a compiler no other arm of its comparison has.
# `containers/gg-toolchains/Dockerfile` is where the tree is assembled and where the
# constraints on adding one are written down; `harness::gg_variant` in `crates/core` is
# what resolves a gg run to the variant.
#
# Nothing else is added. A gg variant is the same run image with the same binaries, the
# same run user and the same working directory — a case that runs under gg and under
# another harness must differ in the harness and in nothing else, or the comparison the
# whole repository exists for is not a comparison.
#
# The build context is the repository root, matching every other image (see
# `containers/build.sh`).

# The run image to extend. Declared BEFORE the first `FROM` so it is a global build arg the
# `FROM` below can consume — an `ARG` after a `FROM` is scoped to that stage. `build.sh`
# passes the image it just built (e.g. the local `test-cabinet-base-wasm:latest`, or a
# registry-qualified tag), so a variant is always `FROM` the matching parent.
ARG BASE_IMAGE=test-cabinet-base-wasm:latest

# The toolchain builder. Same reason for being declared here, and the same reason it has to
# arrive through a named `FROM`: `COPY --from=` cannot interpolate a build arg
# ("variable expansion is not supported for --from").
ARG GG_TOOLCHAINS_IMAGE=test-cabinet-gg-toolchains:latest
FROM ${GG_TOOLCHAINS_IMAGE} AS ggtools

FROM ${BASE_IMAGE}

# The whole toolchain tree, at the same absolute path on every variant — which is what lets
# one gg binary drive a Debian-based image and the Ubuntu-based Blender one without
# knowing which it is in. `COPY` writes as root regardless of the inherited `USER node`;
# the unprivileged run user only executes what is here.
#
# The copied layer's content is identical on every variant, so the registry stores it once
# however many variants are published and a node that has pulled one has the bytes for all
# of them.
COPY --from=ggtools /opt/gg /opt/gg

# Put the toolchains on `PATH` ahead of nothing: a language's compiler is found here, and
# anything the base image already provides keeps working unchanged.
ENV PATH=/opt/gg/toolchains/bin:$PATH
