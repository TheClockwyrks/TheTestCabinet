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

# The whole toolchain tree. `COPY` writes as root regardless of the inherited `USER node`;
# the unprivileged run user only executes what is here.
#
# TWO CLAIMS LIVE ON THIS LINE.
#
# THE TREE IS BYTE-IDENTICAL on every variant: 7826 files, 2 162 625 760 bytes, at the same
# absolute path, copied out of one builder image. That is what lets one gg binary drive a
# Debian-based image and the Ubuntu-based Blender one without knowing which it is in, and it
# is the premise `containers/build.sh`'s five-representative `gg selfcheck` argument rests on
# (what differs between two variants is the environment, never the tree). Nothing here
# affects it.
#
# THE LAYER IS SHARED: every variant carries ONE digest for those bytes, so a registry, a
# node pull and a `docker save` each hold them once, and a push of the twenty-seventh variant
# mounts the blob the first one uploaded instead of uploading ~900 MB again. `--link` is what
# asks for that: BuildKit builds the layer rooted at `scratch` and merges it in, rather than
# diffing it against this variant's parent snapshot. IT IS THE SOURCE PATH THAT DELIVERS IT.
# This line copies `/opt`, the root of the builder image's whole filesystem
# (`containers/gg-toolchains/Dockerfile` ends `FROM scratch` and copies `/opt/gg` into it, so
# `/opt` holds `gg` and nothing else), and not `/opt/gg`. Copying `/opt/gg` made the copy
# create `opt/` itself as the parent of what it wrote, and a directory the copy creates gets
# the moment of the build as its mtime, so the layer's tar carried one `opt/` entry per
# variant with a different timestamp in each: twenty-seven distinct blobs of the same bytes,
# 12.6 GB of the 13.3 GB a run-image build pushed. Copying `/opt` makes that entry the
# builder image's own, stamped once when the builder was built, and the layer is then
# bit-identical from variant to variant. Measured on the daemon's builtin builder, with the
# stock image store: two variants of different parents got one digest, and the second push
# was mounted. Neither the containerd image store nor a `# syntax=` directive changes the
# outcome (each was measured too, and each leaves the parent-directory timestamp in place),
# which is why this file names no frontend and the agents run a stock daemon.
#
# `build_gg_variant` in `containers/build.sh` prints this layer's diff ID per variant, so
# every run-image build answers the sharing question in its own log: the twenty-seven lines
# must agree. A change that reintroduces a created parent directory, or copies anything the
# builder image did not stamp itself, shows up there as twenty-seven different digests.
#
# WHY THIS FILE HAS NO `# syntax=` DIRECTIVE. `containers/base`, `containers/tools` and
# `containers/gg-toolchains` all name the pinned external Dockerfile frontend and this one
# does not, so a variant is built with the daemon's vendored frontend, which accepts `--link`
# and shares the layer as measured above. The directive would cost what it cannot buy: this
# file is built TWENTY-SEVEN TIMES per run-image job, and `containers/build.sh` prunes the
# builder cache between variants, which discards the cached frontend resolution too, so the
# directive would turn three Docker Hub frontend requests per run-image build into thirty per
# leg. Any one of them answering `toomanyrequests` fails a variant roughly an hour into the
# one job in the pipeline that cannot be exercised before it merges and must be re-run whole.
COPY --link --from=ggtools /opt /opt

# Put the toolchains on `PATH` ahead of nothing: a language's compiler is found here, and
# anything the base image already provides keeps working unchanged.
ENV PATH=/opt/gg/toolchains/bin:$PATH
