#!/usr/bin/env bash
# Put the host AUDIO STORE on this machine: the published `audio-store` image, or the
# audio object store the image itself is built from.
#
# A run is staged with the audio packs its test case declares in `[audio] packs`, copied
# into the container when it starts out of a store on the host (see
# `crates/core/src/audio_stage.rs` and
# `apps/docs/src/content/docs/components/core/execution.md`). In a cluster the driver
# image carries that store at `/opt/tcab-audio`. On a laptop running `tcab run` or
# `tcab validate` there is nothing to carry it, so this script puts it there — once.
#
# The clip bytes live in a private R2 bucket that only the publish-side tooling
# (`scripts/stage-audio-store.mjs`, `scripts/build-sample-pack.mjs`) can read, with the
# `CLOUDFLARE_AUDIO_R2_PRESIGN` pair. The Azure pipeline publishes those bytes into a
# data-only image (`containers/audio-store/Dockerfile`) in the Test Cabinet ACR, so
# anyone who can pull from the registry (`az acr login --name testcabinet`, with
# AcrPull) obtains them without an audio credential.
#
# THE IMAGE IS NOT THE ONLY SOURCE, because it must not be the only source. An image is
# published behind the object store, so anyone who has just published a pack and wants to
# hear it in a run would otherwise have to push a container image first. `--stage` (and
# the automatic fallback when the pull fails) skips the image entirely and materializes
# the store straight out of the object store with the read-scoped presign credentials —
# the same thing `containers/build.sh audio-store` and `deployments/local/Makefile`'s
# `audio-store` target do. Same bytes, same verification against the published-object
# lock; no registry in the loop.
#
# The tree it extracts IS an audio root — the same layout a run container is staged with,
# `objects.lock.json` + `clips/` + `packs/<name>@<version>/pack.toml` — so it can also be
# pointed at directly with `TCAB_AUDIO_DIR` by a host-side tool run (a reference
# implementation's `gen-audio.sh`, say), which reads it as a palette of every pack it
# holds.
#
# Usage:
#   scripts/fetch-audio-store.sh [<dest>]
#   scripts/fetch-audio-store.sh --stage [<dest>]   # skip the image; stage out of R2
#
# The destination defaults to `$TCAB_AUDIO_STORE` when that is set, and otherwise to
# ~/.cache/tcab/audio-store. The image reference is built the way `crates/core` resolves a
# run image — `$TCAB_CONTAINER_REGISTRY` (default testcabinet.azurecr.io) and
# `$TCAB_CONTAINER_TAG` (default latest) — so a deployment that pins its images somewhere
# else fetches its store from the same place, and an override is one variable rather than
# an argument to remember. The pipeline tags every image by the commit it built, so set
# `TCAB_CONTAINER_TAG` to a `master` or `staging` commit to pull the store of that commit.
#
# Re-running it is safe and is how a new pack version arrives: the tree is replaced
# wholesale by whichever source produced it rather than merged into, so the store on disk
# is always exactly one source's content and never an accumulation of several.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# `--stage` skips the image and materializes the store out of the audio object store.
# Anything else is the destination. Parsed rather than taken positionally because the
# flag changes where the bytes come from, not where they go, and the two are independent.
SOURCE=image
DEST_ARG=""
while [ $# -gt 0 ]; do
	case "$1" in
		--stage) SOURCE=stage ;;
		--from-image) SOURCE=image ;;
		-h | --help)
			cat <<'USAGE'
Usage:
  scripts/fetch-audio-store.sh [<dest>]           the published image, falling back to R2
  scripts/fetch-audio-store.sh --stage [<dest>]   skip the image; stage out of R2
  scripts/fetch-audio-store.sh --from-image [<dest>]

<dest> defaults to $TCAB_AUDIO_STORE, else ~/.cache/tcab/audio-store.
USAGE
			exit 0
			;;
		-*)
			echo "ERROR: unknown option \`$1\` (expected --stage, --from-image, or a destination)." >&2
			exit 1
			;;
		*) DEST_ARG="$1" ;;
	esac
	shift
done

REGISTRY="${TCAB_CONTAINER_REGISTRY:-testcabinet.azurecr.io}"
TAG="${TCAB_CONTAINER_TAG:-latest}"
IMAGE="${REGISTRY%/}/test-cabinet-audio-store:${TAG}"
DEST="${DEST_ARG:-${TCAB_AUDIO_STORE:-$HOME/.cache/tcab/audio-store}}"
DOCKER="${DOCKER:-docker}"

# Everything lands here first and is swapped into place only once it is complete: a
# half-written store is a run that fails partway through staging with a missing clip,
# which is a much worse failure than not having a store at all. The incoming directory is
# a SIBLING of the destination so the swap is a rename on one filesystem.
INCOMING="${DEST}.incoming.$$"
CONTAINER="tcab-audio-store-$$"
cleanup() {
	"$DOCKER" rm --force "${CONTAINER}" >/dev/null 2>&1 || true
	rm -rf "${INCOMING}"
}
trap cleanup EXIT

# Materialize the store straight out of the audio object store, no image involved. This
# is the same stager `containers/build.sh audio-store` runs, pointed at the same
# `dist/audio-store` root so its content-addressed download cache is shared with the
# image build: whichever ran first pays for the bytes and the other re-verifies them off
# disk. It needs `node` and the read-scoped CLOUDFLARE_AUDIO_R2_PRESIGN credentials
# (repo-root `.env` is loaded by the stager itself), and it is the ONLY source that
# reflects a pack published since the last image was pushed.
stage_from_object_store() {
	if ! command -v node >/dev/null 2>&1; then
		echo "ERROR: no \`node\` on PATH; staging out of the audio object store needs it." >&2
		return 1
	fi
	echo "==> staging out of the audio object store"
	if ! node "${REPO}/scripts/stage-audio-store.mjs" --out "${REPO}/dist/audio-store"; then
		return 1
	fi
	rm -rf "${INCOMING}"
	mkdir -p "$(dirname "${DEST}")"
	cp -a "${REPO}/dist/audio-store/tree" "${INCOMING}"
}

# Pull the published data-only image and copy the tree out of a created-but-never-started
# container: the image has no shell, no user and no entrypoint — it is `FROM scratch` with
# one directory in it — so there is nothing to run and nothing to mount. The container is
# removed on every exit path, so a re-run never trips over a name it left behind.
fetch_from_image() {
	if ! command -v "$DOCKER" >/dev/null 2>&1; then
		echo "ERROR: no \`$DOCKER\` on PATH. Extracting the store from the published image needs" >&2
		echo "       a container runtime (set DOCKER=podman to use podman), or use --stage." >&2
		return 1
	fi
	echo "==> pulling ${IMAGE}"
	if ! "$DOCKER" pull "${IMAGE}"; then
		echo "WARNING: could not pull ${IMAGE}." >&2
		return 1
	fi
	"$DOCKER" create --name "${CONTAINER}" "${IMAGE}" >/dev/null
	rm -rf "${INCOMING}"
	mkdir -p "$(dirname "${DEST}")"
	"$DOCKER" cp "${CONTAINER}:/opt/tcab-audio" "${INCOMING}"
}

# The image first, then the object store — unless `--stage` said otherwise. The fallback
# is not a nicety: the image is published BEHIND the object store, so a tag the registry
# does not hold, a machine not logged in to it, or a pack newer than the last push all land
# here, and in
# every one of those cases the object store still has the right bytes. A pull failure is
# therefore a WARNING and a second attempt rather than the end of the script; only both
# sources failing is fatal.
if [ "${SOURCE}" = stage ]; then
	if ! stage_from_object_store; then
		echo "ERROR: could not stage the audio store out of the audio object store." >&2
		echo "       It needs \`node\` and the read-scoped CLOUDFLARE_AUDIO_R2_PRESIGN credentials" >&2
		echo "       in the environment or the repo-root .env. Drop --stage to use the published" >&2
		echo "       image instead." >&2
		exit 1
	fi
elif ! fetch_from_image; then
	echo "==> falling back to the audio object store" >&2
	if ! stage_from_object_store; then
		echo "ERROR: neither source produced an audio store." >&2
		echo "       Pulling the image needs \`az acr login --name testcabinet\` (AcrPull) and" >&2
		echo "       TCAB_CONTAINER_TAG set to a master or staging commit the pipeline built." >&2
		echo "       Staging directly instead (--stage) needs \`node\` and the read-scoped" >&2
		echo "       CLOUDFLARE_AUDIO_R2_PRESIGN credentials in the environment or the repo-root" >&2
		echo "       .env." >&2
		exit 1
	fi
fi

rm -rf "${DEST}"
mv "${INCOMING}" "${DEST}"

packs="$(find "${DEST}/packs" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
clips="$(find "${DEST}/clips" -type f -name '*.wav' 2>/dev/null | wc -l | tr -d ' ')"
echo "==> ${DEST}: ${packs} pack(s), ${clips} clip(s)"
echo
echo "Point tcab at it for this shell:"
echo "    export TCAB_AUDIO_STORE=${DEST}"
