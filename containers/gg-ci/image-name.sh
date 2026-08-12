#!/usr/bin/env bash
# Single source of truth for the gg CI toolchain image's PACKAGE NAME. Prints one line.
#
# WHY A SCRIPT FOR ONE STRING. This name has call sites in two workflows — the build job
# and the manifest job of `.github/workflows/build-gg-ci-image.yml`, which publish it, and
# the `hydrate-gg-toolchains.sh` step in `.github/workflows/ci.yml`'s `rust` job, which
# pulls it — and the two halves are edited by different changes at different times. That would be
# ordinary duplication if getting it wrong were loud. It is the opposite: the consumer is
# `scripts/ci/hydrate-gg-toolchains.sh`, which is deliberately best-effort and exits 0 when
# a pull fails, so renaming the published package or moving its tag does not turn anything
# red. Both CI jobs simply fall back to installing eleven toolchains from upstream, for
# ever, with a green tick — the worst failure mode a duplicated string can have, and the
# reason `containers/image-names.sh` exists for the run images.
#
# WHY IT IS NOT IN containers/image-names.sh. That file is the set of images a RUN
# RESOLVES: `containers/build.sh` dispatches on it by name and
# `every_resolvable_image_is_one_the_build_publishes` in `crates/core/src/harness.test.rs`
# asserts it in both directions. Nothing resolves this image and `build.sh` deliberately
# does not build it (see its header), so it belongs beside its own Dockerfile.
#
# It prints the WHOLE package name rather than a bare `gg-ci` for the same reason: it does
# not go through `build.sh`'s `IMAGE_NAME_PREFIX`, so there is no prefix machinery for a
# caller to reuse and the full name is the thing being kept single. Only the REGISTRY is
# composed by the caller, from `github.repository_owner`, because the namespace is a
# property of the deployment doing the publishing and not of the source — the same rule
# `hydrate-gg-toolchains.sh`'s header states for itself.
#
# Usage:
#   containers/gg-ci/image-name.sh          # -> test-cabinet-gg-ci
set -euo pipefail

echo "test-cabinet-gg-ci"
