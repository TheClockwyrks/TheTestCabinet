#!/usr/bin/env bash
# Builds the repository's image for this machine's architecture and pushes it
# to the registry as `<image>:<sha>-<arch>`.
#
#   scripts/ci/image.sh <image> <sha>
#
# The image is the Dockerfile at the repository root, built with the root as
# its context. The build is native: the pipeline runs this once on an amd64
# agent and once on an arm64 one, and scripts/ci/manifest.sh fuses the two
# arch tags into the multi-arch `<image>:<sha>` a deployment pins. The caller
# is already logged in to the registry.
#
# <sha> is the commit being built, passed to the build as TCAB_BUILD_COMMIT
# because the context carries no `.git`.
#
# THE SOURCES. A manifest names a dependency on another repository by its
# public source, which the build cannot reach while the mirrors are private.
# scripts/ci/git-sources.sh has written the rewrites to Azure and the job's
# token into the user's git configuration; that file is handed to the build
# as the secret `gitconfig`, which the Dockerfile mounts for the RUN that
# fetches and which never enters a layer. IMAGE_GIT_CONFIG names another file,
# and with no such file the build fetches from the public sources as named.
#
# THE FEED. A Dockerfile that installs a package of the project names the
# `the-test-cabinet` feed, which is private. scripts/ci/npm-feed.sh has written
# the job's token as npm's credential for it into the user's npm
# configuration (NPM_CONFIG_USERCONFIG, else ~/.npmrc); that file is handed to
# the build as the secret `npmrc`, mounted for the RUN that installs alone.
# IMAGE_NPM_CONFIG names another file, and with no such file the build is
# handed none, which a Dockerfile installing nothing from the feed never
# notices.
#
# Layers are cached in the registry per image and architecture
# (`<image>:buildcache-<arch>`), so a build whose inputs did not change skips
# those stages. IMAGE_REGISTRY names another registry than the project's.
set -euo pipefail

# From the repository root, whose Dockerfile and context are built.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 1

if [[ $# -ne 2 ]]; then
	echo "usage: scripts/ci/image.sh <image> <sha>" >&2
	exit 1
fi
readonly IMAGE="$1"
readonly SHA="$2"
if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
	echo "image.sh: '$SHA' is not a full commit hash; an image is tagged with the commit it is built from" >&2
	exit 1
fi
if [[ ! -f Dockerfile ]]; then
	echo "image.sh: there is no Dockerfile at the repository root to build" >&2
	exit 1
fi

case "$(uname -m)" in
x86_64 | amd64) arch=amd64 ;;
aarch64 | arm64) arch=arm64 ;;
*)
	echo "image.sh: unsupported architecture '$(uname -m)'" >&2
	exit 1
	;;
esac

readonly registry="${IMAGE_REGISTRY:-testcabinet.azurecr.io}"
readonly repo="${registry}/${IMAGE}"
readonly cache="${repo}:buildcache-${arch}"
git_config="${IMAGE_GIT_CONFIG:-${HOME:-}/.gitconfig}"
npm_config="${IMAGE_NPM_CONFIG:-${NPM_CONFIG_USERCONFIG:-${HOME:-}/.npmrc}}"

args=(
	--platform "linux/${arch}"
	--file Dockerfile
	--tag "${repo}:${SHA}-${arch}"
	--build-arg "TCAB_BUILD_COMMIT=${SHA}"
	--provenance=false
	--cache-from "type=registry,ref=${cache}"
	--cache-to "type=registry,ref=${cache},mode=max,image-manifest=true,oci-mediatypes=true"
	--push
)
if [[ -f "$git_config" ]]; then
	args+=(--secret "id=gitconfig,src=${git_config}")
else
	echo "image.sh: no git configuration at '${git_config}', so the build fetches from the public sources" >&2
fi
if [[ -f "$npm_config" ]]; then
	args+=(--secret "id=npmrc,src=${npm_config}")
else
	echo "image.sh: no npm configuration at '${npm_config}', so the build holds no credential for the feed" >&2
fi

# The default builder can write neither a registry cache nor a multi-platform
# manifest. `docker login`'s credentials reach this one through the CLI config.
docker buildx create --name repository-image --driver docker-container --use >/dev/null 2>&1 \
	|| docker buildx use repository-image

echo "image.sh: building ${repo}:${SHA}-${arch}"
docker buildx build "${args[@]}" .
