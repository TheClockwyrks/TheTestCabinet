#!/usr/bin/env bash
# Builds one service image for this machine's architecture and pushes it to the
# registry as `<image>:<sha>-<arch>`.
#
#   scripts/ci/service-image.sh <service> <sha>
#
# <service> is a target of deployments/images/services.Dockerfile (backend,
# artifacts, arena, publisher) or `web`, which has a Dockerfile of its own. The
# driver's image is microservice-driver's, built by that repository's pipeline. The build is native: the pipeline runs this once on an amd64 agent and
# once on an arm64 agent, and scripts/ci/manifest.sh fuses the two arch tags into the
# multi-arch `<image>:<sha>` a deployment pins. The caller is already logged in to
# the registry.
#
# <sha> is the commit being built. It is stamped into the binaries as
# TCAB_BUILD_COMMIT, because the build context carries no `.git`.
#
# Layers are cached in the registry per image and architecture, so a build whose
# inputs did not change skips those stages.
#
# The backend bakes the reference documents of the gg release the driver pins
# (microservice-driver/crates/driver/gg-release-version), which the Dockerfile's
# `gg-release` stage reads and fetches itself, so it needs no argument from here.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

if [[ $# -ne 2 ]]; then
	echo "usage: scripts/ci/service-image.sh <service> <sha>" >&2
	exit 1
fi
readonly SERVICE="$1"
readonly SHA="$2"

dockerfile=deployments/images/services.Dockerfile
target="$SERVICE"
case "$SERVICE" in
	backend | artifacts | arena | publisher) image="tcab-${SERVICE}" ;;
	web)
		image=tcab-web
		dockerfile=deployments/images/web.Dockerfile
		target=""
		;;
	*)
		echo "service-image.sh: unknown service '${SERVICE}'" >&2
		exit 1
		;;
esac

arch="$(ci_arch)"
readonly repo="${CI_REGISTRY}/${image}"
readonly cache="${repo}:buildcache-${arch}"

args=(
	--platform "linux/${arch}"
	--file "$dockerfile"
	--tag "${repo}:${SHA}-${arch}"
	--build-arg "TCAB_BUILD_COMMIT=${SHA}"
	--provenance=false
	--cache-from "type=registry,ref=${cache}"
	--cache-to "type=registry,ref=${cache},mode=max,image-manifest=true,oci-mediatypes=true"
	--push
)
[[ -n "$target" ]] && args+=(--target "$target")

# The default builder can write neither a registry cache nor a multi-platform
# manifest. `docker login`'s credentials reach this one through the CLI config.
docker buildx create --name tcab-ci --driver docker-container --use >/dev/null 2>&1 \
	|| docker buildx use tcab-ci

log "building ${repo}:${SHA}-${arch}"
docker buildx build "${args[@]}" .
