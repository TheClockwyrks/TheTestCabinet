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
# TWO CLAIMS LIVE ON THIS LINE, and only the first of them holds today.
#
# THE TREE IS BYTE-IDENTICAL on every variant: 7826 files, 2 162 625 760 bytes, at the same
# absolute path, copied out of one builder image. That is what lets one gg binary drive a
# Debian-based image and the Ubuntu-based Blender one without knowing which it is in, and it
# is the premise `containers/build.sh`'s five-representative `gg selfcheck` argument rests on
# (what differs between two variants is the environment, never the tree). Nothing here
# affects it.
#
# THE LAYER IS NOT SHARED, however, and `--link` is the flag meant to make it so: it asks
# BuildKit to build the layer rooted at `scratch` and merge it in, rather than diffing it
# against this variant's parent snapshot, so every variant would carry ONE digest for those
# bytes and a registry, a node pull and a `docker save` would each hold them once. Measured
# against the pipeline's own output that is not what happens: the registry holds one
# distinct ~898.6 MB blob PER VARIANT, 12.6 GB of the 13.3 GB a run-image build pushes,
# while the entire rest of the run-image set is 0.8 GB. Under `RECLAIM=1`, which
# `scripts/ci/run-images.sh` sets, `containers/build.sh` removes each pushed image and prunes
# the builder cache as it goes, so the agent's store survives the set regardless; and
# `build_gg_variant` prints this layer's digest per variant, so the next build answers the
# sharing question in its own log.
#
# WHY THIS FILE STILL HAS NO `# syntax=` DIRECTIVE, having been tried. `containers/base`,
# `containers/tools` and `containers/gg-toolchains` all name the pinned external Dockerfile
# frontend and this one does not, so a variant is built with the daemon's VENDORED frontend —
# which is the likeliest place `--link` is being dropped, and therefore a tempting one-line
# experiment. It does not belong in this file by default, for two reasons that are about cost
# rather than about the hypothesis:
#
#   - This file is built TWENTY-SEVEN TIMES per run-image job, and `containers/build.sh`
#     prunes the builder cache between variants, which discards the cached frontend
#     resolution too. The last run-image build made exactly three Docker Hub frontend
#     requests for all fifty-five images; the directive here would make it thirty per leg,
#     sixty per staging run. Any one of them answering `toomanyrequests` fails a variant
#     roughly two hours into the one job in the pipeline that cannot be exercised before it
#     merges and must be re-run whole.
#   - The offline argument is not void. `containers/README.md` documents pointing
#     `GG_TOOLCHAINS_IMAGE` at the published toolchain tag so that `./build.sh <name>-gg`
#     rebuilds nothing else; on that path this Dockerfile is the only one built, so a
#     directive here would be the only thing reaching a registry for a frontend.
#
# `--link` is ACCEPTED by the vendored frontend — these twenty-seven variants have been built
# with it — so nothing here fails without the directive, and `build_gg_variant` prints each
# variant's layer digest so the sharing question is answered from an ordinary build log. Test
# the directive deliberately under the backlog issue that owns the duplication
# (`tasks/backlog/share-one-opt-gg-layer-across-the-gg-run-image-variants.md`), not as a side
# effect of a disk fix.
COPY --link --from=ggtools /opt/gg /opt/gg

# Put the toolchains on `PATH` ahead of nothing: a language's compiler is found here, and
# anything the base image already provides keeps working unchanged.
ENV PATH=/opt/gg/toolchains/bin:$PATH
