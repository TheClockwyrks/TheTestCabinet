#!/usr/bin/env bash
# Prints the version pins one CI image consumes, as `NAME=VALUE` lines, for
# scripts/ci/ci-image.sh to pass to `docker buildx build --build-arg` and to
# fold into that image's content-addressed tag.
#
# Usage: ci/images/build-args.sh <rust|web>
#
# There is one place a version is decided in this workspace and it is the
# `x-devcontainer-build-args` anchor in .devcontainer/docker-compose.yml. A CI
# image that kept its own copy of a pin would drift from the container a
# developer works in, and the first symptom would be a gate that passes on a
# laptop and fails in the pipeline, or the reverse. So the pins are read out of
# that anchor as text and handed to the build.
#
# Which pins is decided by the image itself: this reads the `ARG` lines of
# ci/images/<track>.Dockerfile and returns the ones the anchor has a literal
# value for. That is what keeps a bump of a pin no CI image consumes —
# CLAUDE_CODE_VERSION, CODEX_VERSION, LAZYGIT_VERSION — from retiring a
# perfectly good image tag, while a bump of one an image does consume rebuilds
# it.
#
# Not every version an image installs is in the anchor. The devcontainer's
# install scripts pin some of their own — uv, pre-commit, kubectl, rustup,
# cargo-binstall — and those scripts are inputs of the images that run them, so
# a bump in one moves that image's tag through the other half of the digest.
# See "Version pins" in README.md.
#
# The anchor is read with awk rather than with `docker compose config`, for
# three reasons. It needs no compose on the agent, it behaves identically under
# Docker and Podman, and it is the rule this workspace already follows: there is
# no YAML parser here, by design, and scripts/check-devcontainer.py reads the
# same file as text for the same reason.
#
# A value containing `$` is skipped. Those are the anchor's interpolated
# entries — USER_UID and USER_GID — and both of them are properties of the
# host a devcontainer is being built on. A CI image has no host user to match.
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

# The pins the image asks for. Only a bare `ARG NAME` counts: an `ARG` carrying
# its own default is a value the Dockerfile decided for itself and is none of
# this script's business.
mapfile -t declared < <(sed -n 's/^ARG \([A-Z0-9_]*\)$/\1/p' "$DOCKERFILE" | sort -u)

if [[ "${#declared[@]}" -eq 0 ]]; then
	echo "build-args.sh: $DOCKERFILE declares no ARG lines" >&2
	echo "  A CI image with no pins would rebuild from whatever is current today." >&2
	exit 1
fi

# The pins the anchor decides. The block runs from the anchor's own line to the
# next line that starts in column zero, which is the next top-level key.
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
# and an empty string is a version that installs whatever is current. That is
# the drift this whole mechanism exists to prevent, so it fails the build here
# rather than producing an image nobody can reproduce.
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
