#!/usr/bin/env bash
# Stages the gates stage's published gg as a BuildKit named build context, so the backend
# and driver images bake that binary instead of linking a second one of their own.
#
#   scripts/ci/gg-prebuilt.sh <artifact-dir> <out-dir>
#
# <artifact-dir> is where the `gg-<arch>` pipeline artifact was downloaded: the directory
# scripts/ci/gg-dist.sh wrote, holding `gg-<target>` and `gg-reference.tar.gz`. <out-dir> is
# emptied and filled with the two paths deployments/images/services.Dockerfile's `gg-build`
# stage exports, at the same names:
#
#   <out-dir>/gg                     the static-musl binary the driver image bakes
#   <out-dir>/gg-reference/          the documents the backend image bakes and serves
#
# scripts/ci/service-image.sh then passes it as `--build-context gg-build=<out-dir>`, which
# REPLACES that Dockerfile stage: the stage never enters the build graph and each
# `COPY --from=gg-build <path>` resolves against this directory instead. Both paths resolve,
# so the Dockerfile needs no change and keeps working unmodified for the offline path
# (`make -C deployments/local images`), which builds gg in the stage.
#
# WHY THE IMAGES TAKE THE GATES BINARY. The gg the images used to bake was linked a second
# time, inside the `rust:1-bookworm` stage, and nothing checked it: on x86_64 that link
# produces a binary that segfaults in `gg reference --out`, which failed the amd64 backend
# and driver image builds. The gates artifact is the binary `gg selfcheck` is already driven
# against inside four run images, and the one that projected the documents in this same
# artifact. Consuming it gives one gg per commit across the run images, the driver and the
# backend, and it is the only one of the two that anything gates.
#
# EVERY CHECK LIVES HERE rather than in the image build, because this runs before anything
# is built and costs seconds. A missing, truncated or wrong-architecture artifact fails the
# job by name; a binary that cannot exec on this agent fails before it is baked into a
# pushed image; an empty or wrong tarball cannot reach /opt/gg-reference.
#
# Both paths must be absolute. The staging directory is emptied before it is filled, and a
# relative path would be resolved against the repository root this script works from, so a
# mistyped one would delete part of the checkout.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

if [[ $# -ne 2 ]]; then
	echo "usage: scripts/ci/gg-prebuilt.sh <artifact-dir> <out-dir>" >&2
	exit 1
fi

for path in "$1" "$2"; do
	if [[ "$path" != /* ]]; then
		echo "gg-prebuilt.sh: '${path}' is not an absolute path." >&2
		exit 1
	fi
done

if [[ ! -d "$1" ]]; then
	echo "gg-prebuilt.sh: artifact directory '$1' does not exist." >&2
	echo "       It is the gg-<arch> pipeline artifact the gates stage published; the" >&2
	echo "       service-image job downloads it before calling this." >&2
	exit 1
fi
artifacts="$(cd "$1" && pwd)"
readonly artifacts

# The staging directory is emptied rather than merged into, so what the image bakes is
# exactly what this call staged and never a leftover from an earlier one in the same job.
if [[ "$2" == "/" ]]; then
	echo "gg-prebuilt.sh: refusing to stage into '$2'." >&2
	exit 1
fi
rm -rf "$2"
out="$(mkdir -p "$2" && cd "$2" && pwd)"
readonly out

target="$(uname -m)-unknown-linux-musl"
readonly binary="${artifacts}/gg-${target}"
readonly tarball="${artifacts}/gg-reference.tar.gz"

for required in "$binary" "$tarball"; do
	if [[ ! -f "$required" ]]; then
		echo "gg-prebuilt.sh: ${required} is missing from the gg artifact." >&2
		echo "       scripts/ci/gg-dist.sh writes both the binary and the reference tarball on" >&2
		echo "       both architectures; the gates stage's gg_<arch> job publishes them as" >&2
		echo "       gg-<arch>. Check that job ran for this build." >&2
		exit 1
	fi
done

# A pipeline artifact does not carry the executable bit reliably, and this is also the one
# assertion that matters: the binary an image is about to bake is proved to exec on this
# agent first. A wrong-architecture or truncated artifact dies here, in seconds, rather
# than in a pushed image.
log "checking the gg artifact"
chmod 0755 "$binary"
"$binary" --version

log "staging the gg-build context in ${out}"
install -D -m0755 "$binary" "${out}/gg"
tar -xzf "$tarball" -C "$out"

if [[ ! -s "${out}/gg-reference/index.json" ]]; then
	echo "gg-prebuilt.sh: ${out}/gg-reference/index.json is missing or empty." >&2
	echo "       gg-reference.tar.gz must unpack to a gg-reference/ directory holding the" >&2
	echo "       index and one document per program language (gg reference --out)." >&2
	exit 1
fi

# The backend and driver images run unprivileged, and the driver's own chmod only covers the
# binary. Making the whole staged tree world-readable here means the documents are readable
# however the COPY arrived.
chmod -R a+rX "$out"

# What was staged, so a service image's baked gg is tied to an exact gates artifact: this
# digest is the one scripts/ci/gg-dist.sh printed when it built the binary.
log "what the images will bake"
ls -l "$out" "${out}/gg-reference"
sha256sum "${out}/gg"
