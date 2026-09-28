#!/usr/bin/env bash
# Builds every service image for this machine's architecture, on one builder, and
# pushes each to the registry as `<image>:<sha>-<arch>`.
#
#   scripts/ci/service-images.sh <sha>
#
# It runs scripts/ci/service-image.sh once per service, in a fixed order, and that
# script's arguments and environment (TCAB_PREBUILT_GG for the two images that bake
# this run's gg) are the whole contract; this one adds the order and the builder.
#
# WHY ONE JOB BUILDS THE EIGHT. Seven of the services are targets of
# deployments/images/services.Dockerfile, and every one of them is assembled from
# the same `build` stage: one `cargo build --release` of all seven binaries. Built
# as eight separate jobs, each on a fresh agent with an empty builder, that compile
# ran seven times per architecture — twenty minutes each on a hosted amd64 agent,
# ten on the arm64 pool, which also runs one job at a time and pays a VM provision
# for each. On one builder the first target compiles and the six after it take the
# `build` stage from the builder's local cache, so the compile happens once per
# architecture and the assemblies are seconds. `web` has a Dockerfile of its own
# and shares nothing, so it goes last, after the images that wait on the compile.
#
# The order is the Rust services first, `driver` after `backend` (both take the
# prebuilt gg, and the driver is the larger assembly), then `web`. A failure stops
# the job at the failing service, which the last line names; a re-run of the same
# commit takes every stage already pushed to the registry cache, the compiled
# `build` stage included, so the re-run compiles nothing that already succeeded.
set -euo pipefail

# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

if [[ $# -ne 1 ]]; then
	echo "usage: scripts/ci/service-images.sh <sha>" >&2
	exit 1
fi
readonly SHA="$1"

# The eight services scripts/ci/service-image.sh knows, in the order argued above.
readonly SERVICES=(backend auth dispatcher driver artifacts arena publisher web)

for service in "${SERVICES[@]}"; do
	if ! "${CI_LIB_DIR}/service-image.sh" "$service" "$SHA"; then
		echo "service-images.sh: the ${service} image did not build; the ones before it are pushed." >&2
		exit 1
	fi
done
log "every service image is pushed as <image>:${SHA}-$(ci_arch)"
