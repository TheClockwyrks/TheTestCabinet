#!/usr/bin/env bash
# Builds, tags and publishes one of the project's images.
#
# The pipeline's publish stage and a developer call this the same way, so the
# image a run pushes and the image a developer builds come from one command
# with one set of tags, labels, platform and build arguments.
#
#   scripts/ci/build-image.sh <image> <dockerfile> [context]
#
# The context defaults to the repository root, which is where sourcing lib.sh
# puts this script whatever the caller's working directory was, and which is
# the context the Dockerfile under deployments/images/ is written against.
#
# Six variables decide the rest:
#
#   THE_TEST_CABINET_REGISTRY     The registry, prefixed to every reference
#   THE_TEST_CABINET_COMMIT       The commit the tags, the revision label and the build carry
#   THE_TEST_CABINET_PLATFORM     The platform the image is built for; linux/arm64 unless set
#   THE_TEST_CABINET_PUSH         Pushes both tags when it is 1
#   THE_TEST_CABINET_IMAGE_CACHE  Reads the registry build cache when it is 1, and writes it back
#                           when the run is also pushing
#   CONTAINER_TOOL          The client to build with
#
# The platform defaults to the cluster's nodes', which the project answered as
# `image_platform` and DEFAULT_PLATFORM below carries; re-answering it on
# `copier update` is how it changes. The Dockerfile runs every stage as the image's architecture, so a
# build for a platform other than the builder's own runs under QEMU: building
# with docker, this script registers it with the kernel before the build;
# building with podman, the host is expected to have it registered already,
# which a Linux host with qemu-user-static does and a podman machine does out
# of the box.
#
# Leaving THE_TEST_CABINET_PUSH unset builds and tags without contacting the
# registry, which is how this runs in the devcontainer against a throwaway
# registry value:
#
#   THE_TEST_CABINET_REGISTRY=example.invalid THE_TEST_CABINET_COMMIT="$(git rev-parse HEAD)" \
#     scripts/ci/build-image.sh the-test-cabinet-backend deployments/images/backend.Dockerfile
#
# Called by the pipeline's publish stage rather than by the commit hook;
# runnable by hand from any working directory.
set -euo pipefail

# shellcheck source=scripts/ci/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

USAGE="Usage: scripts/ci/build-image.sh <image> <dockerfile> [context]"

# The platform the images are published for: the cluster's nodes'.
DEFAULT_PLATFORM="linux/arm64"

# The image that registers QEMU with the kernel for a foreign platform. Pinned,
# because what it installs is an interpreter every foreign RUN instruction
# executes under.
BINFMT_IMAGE="docker.io/tonistiigi/binfmt:qemu-v10.2.3"

# The name of the builder the registry cache is read and written through. A
# builder on docker's default driver can do neither, so one on the
# docker-container driver is created under this name and reused by it.
BUILDX_BUILDER="the-test-cabinet-cache"

image="${1:-}"
dockerfile="${2:-}"
context="${3:-$PROJECT_ROOT}"

if [ -z "$image" ] || [ -z "$dockerfile" ]; then
	echo >&2 "$USAGE"
	remediation "Build the server image without pushing it with:" \
		"    THE_TEST_CABINET_REGISTRY=example.invalid THE_TEST_CABINET_COMMIT=\"\$(git rev-parse HEAD)\" \\" \
		"      scripts/ci/build-image.sh the-test-cabinet-backend deployments/images/backend.Dockerfile"
	exit 1
fi

if [ -z "${THE_TEST_CABINET_REGISTRY:-}" ]; then
	echo >&2 "THE_TEST_CABINET_REGISTRY is empty."
	remediation \
		"It is the registry the deployed overlays pull from, and every" \
		"reference this builds, tags and pushes is prefixed with it. The" \
		"pipeline sets it from its registry variable; a build by hand names any" \
		"value:" \
		"    THE_TEST_CABINET_REGISTRY=example.invalid scripts/ci/build-image.sh $image $dockerfile"
	exit 1
fi
registry="${THE_TEST_CABINET_REGISTRY}"

# The tags and the revision label are the commit, so a value that is not one
# would publish an image no overlay could pin and no rollback could name.
if ! [[ "${THE_TEST_CABINET_COMMIT:-}" =~ ^[0-9a-f]{40}$ ]]; then
	echo >&2 "THE_TEST_CABINET_COMMIT is not a commit: '${THE_TEST_CABINET_COMMIT:-}'"
	remediation \
		"It carries the forty lowercase hex characters of the commit being" \
		"published, which is the tag the deploy script sets. The pipeline takes" \
		"it from the run's own commit; a build by hand takes it from git:" \
		"    THE_TEST_CABINET_COMMIT=\"\$(git rev-parse HEAD)\" scripts/ci/build-image.sh $image $dockerfile"
	exit 1
fi
commit="${THE_TEST_CABINET_COMMIT}"

# The two architectures the images are built for: the cluster's and a
# developer's host.
platform="${THE_TEST_CABINET_PLATFORM:-$DEFAULT_PLATFORM}"
case "$platform" in
linux/amd64 | linux/arm64) ;;
*)
	echo >&2 "THE_TEST_CABINET_PLATFORM is not a platform the images build for: '$platform'"
	remediation \
		"It is linux/amd64 or linux/arm64. Leave it unset to build for the" \
		"cluster's nodes:" \
		"    THE_TEST_CABINET_PLATFORM=$DEFAULT_PLATFORM scripts/ci/build-image.sh $image $dockerfile"
	exit 1
	;;
esac

if [ ! -f "$dockerfile" ]; then
	echo >&2 "No Dockerfile at $dockerfile"
	remediation "The image this repository publishes is built from:" \
		"    deployments/images/backend.Dockerfile"
	exit 1
fi

# The podman remote client has to be told where the host runtime is. The
# devcontainer's shell config exports this, and a script run from a shell that
# never sourced it gets the same value here, so the probe below asks the same
# socket deployments/local/Makefile asks. Only when the socket is really there,
# so a bare host keeps whatever connection podman is already configured with.
if [ -S /var/run/docker.sock ] && [ -z "${CONTAINER_HOST:-}" ]; then
	export CONTAINER_HOST="unix:///var/run/docker.sock"
fi

# The client to build with, resolved the way deployments/local/Makefile resolves
# it. Which client is installed says nothing about the host: what matters is
# which API the host runtime speaks, because neither client drives the other's
# runtime. So ask the socket: `podman info` succeeds only against a real Podman
# API, and anything else falls to docker. CONTAINER_TOOL overrides both.
if [ -n "${CONTAINER_TOOL:-}" ]; then
	tool="$CONTAINER_TOOL"
elif command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; then
	tool="podman"
else
	tool="docker"
fi

if ! command -v "$tool" >/dev/null 2>&1 && [ ! -x "$tool" ]; then
	echo >&2 "No container client at '$tool'."
	remediation \
		"The devcontainer ships podman and docker, and CONTAINER_TOOL names" \
		"which of them to build with. Leave it unset to resolve one from the" \
		"host runtime socket."
	exit 1
fi

commit_ref="$registry/$image:$commit"
latest_ref="$registry/$image:latest"

# The platform is named in the command rather than left to the machine, so a
# build from a hosted agent and a build from the devcontainer publish the same
# one. The label records the commit inside the image, so a reference pulled
# from the registry answers which commit it is without the tag it was pulled
# by. The build argument hands the same commit to the build, so a Dockerfile
# that declares `ARG THE_TEST_CABINET_COMMIT` can stamp it into what it compiles; one that
# declares none ignores it.
build=(
	--platform "$platform"
	--label "org.opencontainers.image.revision=$commit"
	--build-arg "THE_TEST_CABINET_COMMIT=$commit"
)

# A modern docker CLI routes `build` through buildx, and a builder on the
# docker-container driver leaves its result in the build cache rather than in
# the runtime's image store, which is the store `tag` and `push` read from, so
# without this they fail with "image not known". `--load` is what puts the
# result there, and it is a no-op on the docker driver. Podman builds into its
# own store and takes no such flag, so the flag is added for docker alone.
#
# A build for another architecture runs every stage under QEMU, which docker's
# builders find registered with the kernel or not at all. The registration is
# made here, by the pinned image, for the platform alone and only when the
# daemon's own architecture differs. A daemon that reports none is treated as
# foreign, because registering for the builder's own architecture is a no-op
# and skipping it for a foreign one is a build that fails inside the first RUN.
# Podman runs a foreign stage under the QEMU the host has registered already,
# and is left to it.
if [ "$(basename "$tool")" = "docker" ]; then
	build+=(--load)
	builder_arch="$("$tool" version --format '{{.Server.Arch}}' 2>/dev/null || true)"
	if [ "linux/$builder_arch" != "$platform" ]; then
		echo "Registering QEMU for ${platform#linux/} with the kernel; the builder is ${builder_arch:-of an unreported architecture}."
		if ! "$tool" run --privileged --rm "$BINFMT_IMAGE" --install "${platform#linux/}"; then
			remediation "QEMU could not be registered for ${platform#linux/}, and the image's" \
				"stages run commands as that architecture. The registration runs a" \
				"privileged container from $BINFMT_IMAGE; on a host that forbids one," \
				"build for the host's own architecture:" \
				"    THE_TEST_CABINET_PLATFORM=linux/${builder_arch:-<arch>} scripts/ci/build-image.sh $image $dockerfile"
			exit 1
		fi
	fi
fi

# The layers of the last run, in a cache repository of its own beside the
# image. Every expensive step of the image is in a builder stage — `npm ci` and
# the bundle in the web stage, the Rust compile in the build stage —
# and a builder stage's layers are in none of the published image, so an inline
# cache would leave all of that to run cold on each run. A registry cache
# written with `mode=max` holds every stage, which is the whole point of having
# one. Reading it costs nothing on the first run, when the repository is empty;
# writing it reaches the registry, so only a run that is already pushing does.
cache_ref="$registry/$image-cache:latest"
build_cmd=("$tool" build)
if [ "${THE_TEST_CABINET_IMAGE_CACHE:-}" = "1" ]; then
	echo "Reading the build cache from $cache_ref."
	if [ "$(basename "$tool")" = "docker" ]; then
		# docker exports a registry cache only from a builder on the
		# docker-container driver, and creates none by itself. The builder is
		# made once and found by name on every run after it, so an agent that
		# keeps its state between runs builds it once.
		if ! "$tool" buildx inspect "$BUILDX_BUILDER" >/dev/null 2>&1; then
			echo "Creating the $BUILDX_BUILDER builder."
			"$tool" buildx create --name "$BUILDX_BUILDER" --driver docker-container >/dev/null
		fi
		build_cmd=("$tool" buildx build --builder "$BUILDX_BUILDER")
		build+=(--cache-from "type=registry,ref=$cache_ref")
		if [ "${THE_TEST_CABINET_PUSH:-}" = "1" ]; then
			build+=(--cache-to "type=registry,ref=$cache_ref,mode=max")
		fi
	else
		# podman takes a plain reference and caches the intermediate stages
		# under it without being told a mode.
		build+=(--cache-from "$cache_ref")
		if [ "${THE_TEST_CABINET_PUSH:-}" = "1" ]; then
			build+=(--cache-to "$cache_ref")
		fi
	fi
fi

echo "Building $commit_ref for $platform with $tool."
if ! "${build_cmd[@]}" "${build[@]}" -f "$dockerfile" -t "$commit_ref" "$context"; then
	remediation "The image build failed. Reproduce it with:" \
		"    THE_TEST_CABINET_REGISTRY=$registry THE_TEST_CABINET_COMMIT=$commit THE_TEST_CABINET_PLATFORM=$platform \\" \
		"      scripts/ci/build-image.sh $image $dockerfile"
	exit 1
fi

# One build under both tags, so `latest` names the same image the commit tag
# does rather than a second build of the same sources.
"$tool" tag "$commit_ref" "$latest_ref"

# What the client reports the registry holds for a reference, which is the
# digest the push wrote.
digest_of() { # reference
	local repository="${1%:*}" digests digest
	digests="$("$tool" inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$1" 2>/dev/null || true)"
	digest="$(printf '%s\n' "$digests" | sed -n "s|^${repository}@||p" | head -n 1)"
	printf '%s' "${digest:-<no digest reported>}"
}

if [ "${THE_TEST_CABINET_PUSH:-}" != "1" ]; then
	echo "THE_TEST_CABINET_PUSH is not 1; built and tagged without contacting the registry:"
	printf '    %s\n' "$commit_ref" "$latest_ref"
	exit 0
fi

# The commit tag first, so `latest` moves only once the image it names is in
# the registry. Each reference is printed with the digest read back from the
# client, so a run's log records exactly what the registry holds.
for reference in "$commit_ref" "$latest_ref"; do
	if ! "$tool" push "$reference"; then
		remediation "The push failed. The pipeline signs in through its service" \
			"connection, and a push by hand signs in first:" \
			"    az acr login --name ${registry%%.*}"
		exit 1
	fi
	printf 'pushed %s %s\n' "$reference" "$(digest_of "$reference")"
done
