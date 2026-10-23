#!/usr/bin/env bash
# Pushes the checked-out ref to the repository's GitHub mirror.
#
#   scripts/ci/mirror.sh [--url <mirror>] [--allow-rewrite] <key-file> <ref>
#
# <ref> is the full ref the pipeline built (`Build.SourceBranch`). A branch is
# pushed to the same branch on the mirror together with every tag it contains.
# A tag is pushed on its own.
#
# THE TARGET. The mirror is the one the repository declares in its own
# `.nyxsis/mirrors.toml`, the file Nyxsis reads its mirrors from: one
# `[[mirror]]` table with a `url`. `--url` names it instead, and when the file
# declares mirrors the URL has to be one of them, so a pipeline parameter can
# never point a repository at a mirror it does not declare. A file declaring
# several mirrors needs `--url` to pick one. With neither, there is nothing to
# push to: the script says so and exits 0 without touching the network. Only
# GitHub mirrors are pushed, over ssh, whichever form the URL is written in.
#
# THE GUARD. The repository lives on Azure Repos, and GitHub holds a copy of it.
# The pipeline runs this once a commit has passed the gates, so the mirror only
# ever receives commits that did, and nothing else writes there. A mirror that
# follows its source only ever moves forward, so before pushing, the script
# reads the mirror's current refs and refuses when the target branch's head is
# not an ancestor of the commit being pushed, or when a tag it would push
# already names a different object there. That is what stops one repository's
# history landing on another's mirror (a pipeline copied with its mirror job, a
# history rewritten by `git filter-repo`). The push itself is not forced either,
# so a mirror that moved between the check and the push is refused by GitHub.
# `--allow-rewrite`, or `MIRROR_ALLOW_REWRITE=true`, skips the guard and forces
# the push, for a rewrite that is meant.
#
# <key-file> is the private half of a deploy key with write access to the mirror,
# which the pipeline keeps as a secure file. The job needs a full clone with
# tags, because GitHub refuses a push from a shallow one and the guard needs the
# mirror's head in the local history to see it is an ancestor.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

# https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
readonly GITHUB_HOST_KEY="github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"
readonly MIRRORS_FILE=".nyxsis/mirrors.toml"
readonly USAGE="usage: scripts/ci/mirror.sh [--url <mirror>] [--allow-rewrite] <key-file> <ref>"

die() {
	echo "mirror.sh: $*" >&2
	exit 1
}

url=""
allow_rewrite=false
[[ "${MIRROR_ALLOW_REWRITE:-}" == true ]] && allow_rewrite=true
while [[ $# -gt 0 ]]; do
	case "$1" in
		--url)
			[[ $# -ge 2 ]] || die "--url needs a value"
			url="$2"
			shift 2
			;;
		--allow-rewrite)
			allow_rewrite=true
			shift
			;;
		--)
			shift
			break
			;;
		-*)
			echo "$USAGE" >&2
			exit 1
			;;
		*) break ;;
	esac
done
if [[ $# -ne 2 ]]; then
	echo "$USAGE" >&2
	exit 1
fi
readonly KEY_FILE="$1"
readonly REF="$2"

case "$REF" in
	refs/heads/* | refs/tags/*) ;;
	*) die "'${REF}' is neither a branch nor a tag" ;;
esac

# The `owner/name` of a GitHub repository URL, or nothing for a URL that is not
# GitHub's. GitHub's names are case-insensitive, so a comparison lower-cases it.
github_slug() { # url
	local slug
	case "$1" in
		https://github.com/*) slug="${1#https://github.com/}" ;;
		ssh://git@github.com/*) slug="${1#ssh://git@github.com/}" ;;
		git@github.com:*) slug="${1#git@github.com:}" ;;
		*) return 0 ;;
	esac
	slug="${slug%/}"
	slug="${slug%.git}"
	[[ "$slug" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || return 0
	echo "$slug"
}

# The URLs `.nyxsis/mirrors.toml` declares, one per line.
declared_mirrors() {
	[[ -f "$MIRRORS_FILE" ]] || return 0
	python3 -I - "$MIRRORS_FILE" <<'PY'
import sys, tomllib
with open(sys.argv[1], "rb") as f:
    doc = tomllib.load(f)
for mirror in doc.get("mirror", []):
    if isinstance(mirror, dict) and isinstance(mirror.get("url"), str) and mirror["url"]:
        print(mirror["url"])
PY
}

listing="$(declared_mirrors)" || die "${MIRRORS_FILE} is not valid TOML"
declared=()
if [[ -n "$listing" ]]; then
	mapfile -t declared <<<"$listing"
fi

if [[ -n "$url" ]]; then
	if [[ ${#declared[@]} -gt 0 ]]; then
		want="$(github_slug "$url")"
		want="${want,,}"
		found=false
		for d in "${declared[@]}"; do
			have="$(github_slug "$d")"
			if [[ -n "$want" && "${have,,}" == "$want" ]]; then
				found=true
			fi
		done
		$found || die "--url ${url} is not a mirror ${MIRRORS_FILE} declares (${declared[*]})"
	fi
elif [[ ${#declared[@]} -eq 1 ]]; then
	url="${declared[0]}"
elif [[ ${#declared[@]} -gt 1 ]]; then
	die "${MIRRORS_FILE} declares ${#declared[@]} mirrors; name one with --url"
else
	log "no mirror configured (no --url, and ${MIRRORS_FILE} declares none); nothing pushed"
	exit 0
fi

slug="$(github_slug "$url")"
[[ -n "$slug" ]] || die "'${url}' is not a GitHub repository URL"
MIRROR="git@github.com:${slug}.git"
readonly MIRROR

# ssh refuses a key that others can read, and a secure file is downloaded
# world-readable.
chmod 600 "$KEY_FILE"

known_hosts="$(mktemp)"
trap 'rm -f "$known_hosts"' EXIT
echo "$GITHUB_HOST_KEY" >"$known_hosts"
export GIT_SSH_COMMAND="ssh -i '$KEY_FILE' -o IdentitiesOnly=yes -o UserKnownHostsFile='$known_hosts' -o StrictHostKeyChecking=yes"

tags=()
case "$REF" in
	refs/heads/*)
		refspecs=("HEAD:${REF}")
		while IFS= read -r tag; do
			tags+=("refs/tags/${tag}")
			refspecs+=("refs/tags/${tag}:refs/tags/${tag}")
		done < <(git tag --merged HEAD)
		;;
	refs/tags/*)
		tags=("$REF")
		refspecs=("${REF}:${REF}")
		;;
esac

if $allow_rewrite; then
	log "rewrite allowed: pushing ${REF} to ${MIRROR} without the ancestor guard"
else
	remote="$(git ls-remote "$MIRROR")" || die "could not read the refs of ${MIRROR}"
	remote_ref() { # ref -> the object it names on the mirror, or nothing
		awk -v ref="$1" '$2 == ref { print $1 }' <<<"$remote"
	}
	if [[ "$REF" == refs/heads/* ]]; then
		theirs="$(remote_ref "$REF")"
		if [[ -n "$theirs" ]] && ! git merge-base --is-ancestor "$theirs" HEAD 2>/dev/null; then
			die "refusing to push: ${MIRROR}'s ${REF#refs/heads/} is at ${theirs}," \
				"which is not an ancestor of $(git rev-parse HEAD). The mirror holds history" \
				"this repository does not; if replacing it is meant, run with --allow-rewrite" \
				"(the pipeline variable mirrorAllowRewrite=true)."
		fi
	fi
	for tag in "${tags[@]}"; do
		theirs="$(remote_ref "$tag")"
		ours="$(git rev-parse "$tag")"
		if [[ -n "$theirs" && "$theirs" != "$ours" ]]; then
			die "refusing to push: ${MIRROR}'s ${tag} names ${theirs}, not ${ours}." \
				"A tag on the mirror is never moved; if moving it is meant, run with" \
				"--allow-rewrite (the pipeline variable mirrorAllowRewrite=true)."
		fi
	done
fi

push=(git push --atomic)
$allow_rewrite && push+=(--force)
log "pushing ${REF} at $(git rev-parse --short HEAD) to ${MIRROR} (${#refspecs[@]} refs)"
"${push[@]}" "$MIRROR" "${refspecs[@]}"
