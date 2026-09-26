#!/usr/bin/env bash
# Checks that the CI image references azure-pipelines.yml pins are the ones this
# checkout's inputs digest to.
#
# The tag of each image is a digest of the files it is built from
# (scripts/ci/ci-image.sh), and the gates pipeline writes the full reference
# literally in its `resources.containers` block. So a change to an image input
# that is not accompanied by the new tag is a pipeline that runs the gates inside
# an image built from something else, silently, until the day the old tag is
# purged. This fails that commit instead, and prints the reference to paste.
#
# It runs in the `checks` job, which runs inside the web image the pipeline
# pinned, so a run that reaches this step at all has pulled a tag that exists;
# what it settles is whether that tag is the current one.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

readonly PIPELINE="azure-pipelines.yml"
problems=0

log "check the CI image pins in $PIPELINE"
for track in rust web; do
	expected="$(./scripts/ci/ci-image.sh reference "$track")"
	if grep -Fqx -- "      image: $expected" "$PIPELINE"; then
		echo "$track: $expected"
		continue
	fi
	pinned="$(grep -E "^\s+image: .*-${track}-cicd:" "$PIPELINE" | sed 's/^ *image: //' || true)"
	echo "error: $PIPELINE pins the $track image as '${pinned:-nothing}', but this checkout's inputs digest to" >&2
	echo "       $expected" >&2
	echo "       Paste that reference into the resources.containers block, push, let" >&2
	echo "       azure-pipelines-ci-images.yml build it, then re-queue the gates. See ci/images/README.md." >&2
	problems=$((problems + 1))
done

((problems == 0)) || exit 1
echo "both CI image pins are current"
