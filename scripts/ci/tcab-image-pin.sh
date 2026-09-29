#!/usr/bin/env bash
# Writes, or checks, the Rust CI image the project's own pipeline jobs run in.
#
#   scripts/ci/tcab-image-pin.sh           # write the pin into .azure/project/jobs.yml
#   scripts/ci/tcab-image-pin.sh --check   # exit 1 when the pin is not the current tag
#
# The template's jobs name their image through `${{ variables.rustImageTag }}`,
# read out of ci/images/tags.yml. A jobs template cannot read that variable: it
# is expanded before the pipeline's variables are, so the expression is empty
# there. .azure/project/jobs.yml therefore names the image as the literal
# default of its `rustImage` parameter, and this script is what keeps that
# literal equal to the tag ci/images/tags.yml pins. The `ci-image-pins` gate
# runs `--check`.
#
# After `scripts/ci/ci-image.sh tag` moves the tag, run this with no argument
# and commit both files together.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT
readonly TAGS="ci/images/tags.yml"
readonly JOBS=".azure/project/jobs.yml"
# The repository the Rust track's image is pushed to, which scripts/ci/ci-image.sh
# names and every template job pulls from.
readonly REPOSITORY="testcabinet.azurecr.io/ubuntu-the-test-cabinet-rust-cicd"

usage() {
	echo "usage: scripts/ci/tcab-image-pin.sh [--check]" >&2
	exit 2
}

check=false
case "${1:-}" in
	"") ;;
	--check) check=true ;;
	*) usage ;;
esac
[[ $# -le 1 ]] || usage

cd "$ROOT"

tag="$(sed -n 's/^[[:space:]]*rustImageTag:[[:space:]]*\([^[:space:]#]*\).*$/\1/p' "$TAGS")"
if [[ -z "$tag" ]]; then
	echo "$TAGS pins no rustImageTag." >&2
	echo "Write it with:" >&2
	echo "    scripts/ci/ci-image.sh tag" >&2
	exit 1
fi
readonly wanted="${REPOSITORY}:${tag}"

# The `default:` of the parameter entry whose `name:` is rustImage: from that
# name to the next entry of the list.
read_pin() {
	awk '
		/^[[:space:]]*- name:[[:space:]]*rustImage[[:space:]]*$/ { inside = 1; next }
		inside && /^[[:space:]]*- / { inside = 0 }
		inside && /^[[:space:]]*default:/ { sub(/^[[:space:]]*default:[[:space:]]*/, ""); print; exit }
	' "$JOBS"
}

pinned="$(read_pin)"
if [[ -z "$pinned" ]]; then
	echo "$JOBS has no rustImage parameter with a default, which the project's Rust jobs run in." >&2
	exit 1
fi

if [[ "$pinned" == "$wanted" ]]; then
	echo "$JOBS pins $wanted, the tag $TAGS names."
	exit 0
fi

if [[ "$check" == true ]]; then
	echo "$JOBS pins $pinned," >&2
	echo "but $TAGS names $wanted." >&2
	echo "Write the pin with:" >&2
	echo "    scripts/ci/tcab-image-pin.sh" >&2
	exit 1
fi

tmp="$(mktemp "${JOBS}.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
awk -v wanted="$wanted" '
	/^[[:space:]]*- name:[[:space:]]*rustImage[[:space:]]*$/ { inside = 1; print; next }
	inside && /^[[:space:]]*- / { inside = 0 }
	inside && /^[[:space:]]*default:/ {
		match($0, /^[[:space:]]*default:/)
		print substr($0, 1, RLENGTH) " " wanted
		inside = 0
		next
	}
	{ print }
' "$JOBS" >"$tmp"
chmod --reference="$JOBS" "$tmp" 2>/dev/null || true
mv "$tmp" "$JOBS"
trap - EXIT
echo "$JOBS now pins $wanted (was $pinned)."
