#!/usr/bin/env bash
# Builds one service image for this machine's architecture and pushes it to the
# registry as `<image>:<sha>-<arch>`.
#
#   scripts/ci/service-image.sh <service> <sha>
#
# <service> is a target of deployments/images/services.Dockerfile (backend, auth,
# dispatcher, driver, artifacts, arena, publisher) or `web`, which has a Dockerfile
# of its own. The build is native: the pipeline runs this once on an amd64 agent and
# once on an arm64 agent, and scripts/ci/manifest.sh fuses the two arch tags into the
# multi-arch `<image>:<sha>` a deployment pins. The caller is already logged in to
# the registry.
#
# <sha> is the commit being built. It is stamped into the binaries as
# TCAB_BUILD_COMMIT, because the build context carries no `.git`. The driver bakes the
# audio store the same run pushed, `test-cabinet-audio-store:<sha>`, so the images of
# one commit always travel together.
#
# Layers are cached in the registry per image and architecture, so a build whose
# inputs did not change skips those stages.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

if [[ $# -ne 2 ]]; then
	echo "usage: scripts/ci/service-image.sh <service> <sha>" >&2
	exit 1
fi
readonly SERVICE="$1"
readonly SHA="$2"

dockerfile=deployments/images/services.Dockerfile
target="$SERVICE"
case "$SERVICE" in
	backend | dispatcher | driver | artifacts | arena | publisher) image="tcab-${SERVICE}" ;;
	auth) image=tcab-auth-service ;;
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
[[ "$SERVICE" == driver ]] && args+=(--build-arg "AUDIO_STORE_IMAGE=${CI_REGISTRY}/test-cabinet-audio-store:${SHA}")

# The default builder can write neither a registry cache nor a multi-platform
# manifest. `docker login`'s credentials reach this one through the CLI config.
docker buildx create --name tcab-ci --driver docker-container --use >/dev/null 2>&1 \
	|| docker buildx use tcab-ci

log "building ${repo}:${SHA}-${arch}"
docker buildx build "${args[@]}" .
