#!/usr/bin/env bash
# Pushes the checked-out ref to the GitHub mirror.
#
#   scripts/ci/mirror.sh <key-file> <ref>
#
# <ref> is the full ref the pipeline built (`Build.SourceBranch`). A branch is
# force-pushed to the same branch on the mirror together with every tag it
# contains. A tag is force-pushed on its own.
#
# The repository lives on Azure Repos, and GitHub holds a copy of it. The pipeline
# runs this once a commit has passed the gates, so the mirror only ever receives
# commits that did. Nothing else pushes there, which is why every push is forced:
# the mirror follows Azure, whatever it held before.
#
# <key-file> is the private half of a deploy key with write access to the mirror,
# which the pipeline keeps as the secure file `github-mirror-key`. The job needs a
# full clone with tags, because GitHub refuses a push from a shallow one.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

readonly MIRROR="git@github.com:TheClockwyrks/TheTestCabinet.git"
# https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
readonly GITHUB_HOST_KEY="github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"

if [[ $# -ne 2 ]]; then
	echo "usage: scripts/ci/mirror.sh <key-file> <ref>" >&2
	exit 1
fi
readonly KEY_FILE="$1"
readonly REF="$2"

# ssh refuses a key that others can read, and a secure file is downloaded
# world-readable.
chmod 600 "$KEY_FILE"

known_hosts="$(mktemp)"
trap 'rm -f "$known_hosts"' EXIT
echo "$GITHUB_HOST_KEY" >"$known_hosts"
export GIT_SSH_COMMAND="ssh -i '$KEY_FILE' -o IdentitiesOnly=yes -o UserKnownHostsFile='$known_hosts' -o StrictHostKeyChecking=yes"

case "$REF" in
	refs/heads/*)
		refspecs=("HEAD:${REF}")
		while IFS= read -r tag; do
			refspecs+=("refs/tags/${tag}:refs/tags/${tag}")
		done < <(git tag --merged HEAD)
		;;
	refs/tags/*)
		refspecs=("${REF}:${REF}")
		;;
	*)
		echo "mirror.sh: '${REF}' is neither a branch nor a tag" >&2
		exit 1
		;;
esac

log "pushing ${REF} at $(git rev-parse --short HEAD) to ${MIRROR} (${#refspecs[@]} refs)"
git push --force "$MIRROR" "${refspecs[@]}"
