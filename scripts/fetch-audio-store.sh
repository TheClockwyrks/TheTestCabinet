#!/usr/bin/env bash
# Fetch the host AUDIO STORE onto this machine, out of the published `audio-store` image.
#
# A run is staged with the audio packs its test case declares in `[audio] packs`, copied
# into the container when it starts out of a store on the host (see
# `crates/core/src/audio_stage.rs` and
# `apps/docs/src/content/docs/components/core/execution.md`). In a cluster the driver
# image carries that store at `/opt/tcab-audio`. On a laptop running `tcab run` or
# `tcab validate` there is nothing to carry it, so this script puts it there — once.
#
# It needs NO CREDENTIALS, and that is the point of the whole arrangement. The clip bytes
# live in a private R2 bucket that only the publish-side tooling
# (`scripts/stage-audio-store.mjs`, `scripts/build-sample-pack.mjs`) can read, with the
# `CLOUDFLARE_AUDIO_R2_PRESIGN` pair. Those bytes are published ONCE into a public,
# data-only image (`containers/audio-store/Dockerfile`), and everything downstream — this
# script, the driver image build, `make -C deployments/local images` — obtains them by
# pulling that image. A contributor needs exactly the capability they already have: the
# ability to pull a public GHCR image.
#
# The tree it extracts IS an audio root — the same layout a run container is staged with,
# `objects.lock.json` + `clips/` + `packs/<name>@<version>/pack.toml` — so it can also be
# pointed at directly with `TCAB_AUDIO_DIR` by a host-side tool run (a reference
# implementation's `gen-audio.sh`, say), which reads it as a palette of every pack it
# holds.
#
# Usage:
#   scripts/fetch-audio-store.sh [<dest>]
#
# The destination defaults to `$TCAB_AUDIO_STORE` when that is set, and otherwise to
# ~/.cache/tcab/audio-store. The image reference is built the way `crates/core` resolves a
# run image — `$TCAB_CONTAINER_REGISTRY` (default ghcr.io/theclockwyrks) and
# `$TCAB_CONTAINER_TAG` (default latest) — so a deployment that pins its images somewhere
# else fetches its store from the same place, and an override is one variable rather than
# an argument to remember.
#
# Re-running it is safe and is how a new pack version arrives: the tree is replaced
# wholesale from the pulled image rather than merged into, so the store on disk is always
# exactly one published image's content and never an accumulation of several.
set -euo pipefail

REGISTRY="${TCAB_CONTAINER_REGISTRY:-ghcr.io/theclockwyrks}"
TAG="${TCAB_CONTAINER_TAG:-latest}"
IMAGE="${REGISTRY%/}/test-cabinet-audio-store:${TAG}"
DEST="${1:-${TCAB_AUDIO_STORE:-$HOME/.cache/tcab/audio-store}}"
DOCKER="${DOCKER:-docker}"

if ! command -v "$DOCKER" >/dev/null 2>&1; then
	echo "ERROR: no \`$DOCKER\` on PATH. This script extracts the store from a published" >&2
	echo "       container image, so it needs a container runtime (set DOCKER=podman to use podman)." >&2
	exit 1
fi

echo "==> pulling ${IMAGE}"
if ! "$DOCKER" pull "${IMAGE}"; then
	echo "ERROR: could not pull ${IMAGE}." >&2
	echo "       It is a PUBLIC image and needs no login. If this is a fork or a private" >&2
	echo "       namespace, point TCAB_CONTAINER_REGISTRY at one that publishes it, or build" >&2
	echo "       it yourself with \`./containers/build.sh audio-store\` (which does need the" >&2
	echo "       CLOUDFLARE_AUDIO_R2_PRESIGN credentials)." >&2
	exit 1
fi

# `docker cp` out of a created-but-never-started container: the image has no shell, no
# user and no entrypoint — it is `FROM scratch` with one directory in it — so there is
# nothing to run and nothing to mount. The container is removed on every exit path,
# including a failed copy, so a re-run never trips over a name it left behind.
CONTAINER="tcab-audio-store-$$"
cleanup() { "$DOCKER" rm --force "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT
"$DOCKER" create --name "${CONTAINER}" "${IMAGE}" >/dev/null

# Extracted beside the destination and swapped in only once the copy has exited 0: a
# half-copied store is a run that fails partway through staging with a missing clip, which
# is a much worse failure than not having a store at all. The staging directory is a
# sibling so the swap is a rename on one filesystem rather than a second copy.
mkdir -p "$(dirname "${DEST}")"
STAGE="${DEST}.incoming.$$"
rm -rf "${STAGE}"
"$DOCKER" cp "${CONTAINER}:/opt/tcab-audio" "${STAGE}"
rm -rf "${DEST}"
mv "${STAGE}" "${DEST}"

packs="$(find "${DEST}/packs" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
clips="$(find "${DEST}/clips" -type f -name '*.wav' 2>/dev/null | wc -l | tr -d ' ')"
echo "==> ${DEST}: ${packs} pack(s), ${clips} clip(s)"
echo
echo "Point tcab at it for this shell:"
echo "    export TCAB_AUDIO_STORE=${DEST}"
