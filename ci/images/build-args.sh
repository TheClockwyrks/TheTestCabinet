#!/usr/bin/env bash
# Prints the version pins one CI image consumes, as `NAME=VALUE` lines, for
# scripts/ci/ci-image.sh to pass to `docker buildx build --build-arg` and to fold
# into that image's content-addressed tag.
#
# Usage: ci/images/build-args.sh <rust|web>
#
# A version is decided in one place, the `x-devcontainer-build-args` anchor in
# .devcontainer/docker-compose.yml, so that the toolchain a gate runs under in
# the pipeline is the one a developer runs under in the devcontainer. A CI image
# with its own copy of a pin would drift, and the first symptom would be a gate
# that passes in a terminal and fails in the pipeline, or the reverse.
#
# Which pins is decided by the image: this reads the bare `ARG NAME` lines of
# ci/images/<track>.Dockerfile and returns the anchor's literal value for each.
# That is what keeps a bump of a pin no CI image consumes (LAZYGIT_VERSION) from
# retiring a good image tag, while a bump of one an image does consume rebuilds
# it. An `ARG` carrying its own default is a value the Dockerfile decided for
# itself and is not read here.
#
# The anchor is read with awk rather than a YAML parser: it needs no compose on
# the agent and behaves identically under Docker and Podman, and it is how
# .devcontainer/tools/browsers.sh already reads the same file. A value containing
# `$` is skipped: those are the anchor's interpolated entries (USERNAME, USER_UID,
# USER_GID, DOCKER_GID, TZ), each a property of the host a devcontainer is built
# on, which a CI image has none of.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT="$here/../.."
readonly COMPOSE="$ROOT/.devcontainer/docker-compose.yml"

readonly TRACK="${1:-}"
case "$TRACK" in
	rust | web) ;;
	*)
		echo "build-args.sh: usage: build-args.sh <rust|web>" >&2
		exit 2
		;;
esac

readonly DOCKERFILE="$ROOT/ci/images/${TRACK}.Dockerfile"

if [[ ! -f "$DOCKERFILE" ]]; then
	echo "build-args.sh: no such image: $DOCKERFILE" >&2
	exit 1
fi

mapfile -t declared < <(sed -n 's/^ARG \([A-Z0-9_]*\)$/\1/p' "$DOCKERFILE" | sort -u)

if [[ "${#declared[@]}" -eq 0 ]]; then
	echo "build-args.sh: $DOCKERFILE declares no ARG lines" >&2
	echo "  A CI image with no pins would rebuild from whatever is current today." >&2
	exit 1
fi

# The block runs from the anchor's own line to the next line that starts in
# column zero, which is the next top-level key.
declare -A pinned=()
while IFS='=' read -r name value; do
	pinned["$name"]="$value"
done < <(awk '
	/^x-devcontainer-build-args:/ { in_anchor = 1; next }
	in_anchor && /^[^[:space:]]/ { in_anchor = 0 }
	in_anchor && match($0, /^  [A-Z0-9_]+: /) {
		name = substr($0, 3, RLENGTH - 4)
		value = substr($0, RLENGTH + 1)
		sub(/[[:space:]]+$/, "", value)
		if (value !~ /\$/ && value != "") {
			print name "=" value
		}
	}
' "$COMPOSE")

if [[ "${#pinned[@]}" -eq 0 ]]; then
	echo "build-args.sh: no literal pins in $COMPOSE" >&2
	echo "  Expected an x-devcontainer-build-args anchor holding NAME: VALUE lines." >&2
	exit 1
fi

# A declared ARG with no pin behind it would reach the build as an empty string,
# and an empty string is a version that installs whatever is current, so it
# fails here rather than producing an image nobody can reproduce.
missing=()
extracted=()

for name in "${declared[@]}"; do
	if [[ -z "${pinned[$name]+set}" ]]; then
		missing+=("$name")
		continue
	fi
	extracted+=("$name=${pinned[$name]}")
done

if [[ "${#missing[@]}" -gt 0 ]]; then
	echo "build-args.sh: ci/images/${TRACK}.Dockerfile declares pins the anchor does not decide:" >&2
	printf '  %s\n' "${missing[@]}" >&2
	echo "  Add each one to x-devcontainer-build-args in .devcontainer/docker-compose.yml," >&2
	echo "  which is the one place a version is decided. See the header of this script." >&2
	exit 1
fi

printf '%s\n' "${extracted[@]}" | sort
