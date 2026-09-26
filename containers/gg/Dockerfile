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
# `--link` IS LOAD-BEARING, and this is the one line in the file where a change costs
# gigabytes. Without it BuildKit computes this layer as a diff against THIS VARIANT'S
# PARENT SNAPSHOT, so the twenty-seven variants each get a DIFFERENT digest for
# byte-identical content — 846 MB compressed (2.18 GB unpacked) stored twenty-seven times
# over in the registry, in every node that pulls more than one variant, and in every
# `docker save` a local `make run-images-gg` feeds to `k3d image import`. That is not a
# theory: the k3d node's content store held one 846.3 MB blob PER VARIANT before this flag
# was added — twenty-six distinct copies of it, that being the size of the set when the
# measurement was taken — and the comment that used to sit here claimed the opposite.
#
# `--link` builds the layer rooted at `scratch` and merges it in, so it does not depend on
# what it is layered onto: every variant gets the SAME digest and the bytes are stored once,
# which is what makes the claim above true rather than aspirational. Nothing about the
# resulting filesystem changes — the tree is identical either way (7826 files, 2 162 625 760
# bytes) — because nothing in any parent image occupies `/opt/gg`, which is the condition
# `--link` asks for.
#
# It needs Dockerfile frontend 1.4+, which every BuildKit this repo builds with has BUILT IN
# (docker buildx locally and on the Azure pipeline's agents). Deliberately
# no `# syntax=` directive: that would make an image build fetch a frontend image, and the
# `containers/` images are the offline-buildable path (see `containers/build.sh`).
COPY --link --from=ggtools /opt/gg /opt/gg

# Put the toolchains on `PATH` ahead of nothing: a language's compiler is found here, and
# anything the base image already provides keeps working unchanged.
ENV PATH=/opt/gg/toolchains/bin:$PATH
