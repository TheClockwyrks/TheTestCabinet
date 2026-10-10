#!/usr/bin/env bash
# Verifies that every submodule pin is on that submodule's branch of the same
# name, or on its `master`.
#
#   scripts/ci/submodule-pins.sh [--branch <branch>] [<superproject-url>]
#
# THE RULE. A pin on superproject branch B must be on the submodule's B or on
# the submodule's `master`. Each submodule's own pipeline mirrors its branches
# to GitHub, so a superproject commit whose pins all satisfy the rule names only
# submodule commits that the mirror of the same branch, or of `master`, holds,
# and a clone of the superproject's GitHub mirror can fetch its submodules. On
# `master` the rule is the strict one: the submodule's `master` alone. A
# submodule with no branch B is held to its `master`.
#
# WHICH BRANCH IS B. `--branch` names it. Without it, on an Azure Pipelines
# agent a pull request is checked against the branch it merges into
# (SYSTEM_PULLREQUEST_TARGETBRANCH), because that is where the pins land, and
# any other run against the branch it built (BUILD_SOURCEBRANCH). Off an agent,
# B is the branch checked out. A ref that is not a branch, such as a tag or a
# detached HEAD, is held to `master`.
#
# Each submodule's URL comes from `.gitmodules`. A relative URL resolves against
# <superproject-url> exactly as git resolves it, which defaults to the `origin`
# remote. For each submodule the script fetches the commits of `master`, and of
# B where the submodule has it, into a scratch repository without trees or
# blobs, so the check costs kilobytes even for cold-storage.
#
# On an Azure Pipelines agent the job passes its access token in
# SYSTEM_ACCESSTOKEN, and it is sent to dev.azure.com over HTTPS. The job must
# name each submodule repository (it checks each one out, see the
# `submodule_pins` job), because the project scopes the job token to the
# repositories a job names.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

# The resolver alone, for the table test.
if [[ "${1:-}" == "--resolve" ]]; then
	ci_resolve_url "$2" "$3"
	exit
fi

# branch_of <ref>: the branch a ref names, or nothing for a ref that is not a
# branch. A pull request's target arrives as `refs/heads/<b>` from Azure Repos
# and as a bare `<b>` from GitHub.
branch_of() {
	case "$1" in
		refs/heads/*) printf '%s\n' "${1#refs/heads/}" ;;
		refs/* | "") ;;
		*) printf '%s\n' "$1" ;;
	esac
}

branch=""
branch_given=0
superproject_url=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--branch)
			[[ $# -ge 2 ]] || {
				echo "usage: scripts/ci/submodule-pins.sh [--branch <branch>] [<superproject-url>]" >&2
				exit 2
			}
			branch="$(branch_of "$2")"
			branch_given=1
			shift 2
			;;
		-*)
			echo "usage: scripts/ci/submodule-pins.sh [--branch <branch>] [<superproject-url>]" >&2
			exit 2
			;;
		*)
			superproject_url="$1"
			shift
			;;
	esac
done
if ((!branch_given)); then
	if [[ -n "${SYSTEM_PULLREQUEST_TARGETBRANCH:-}" ]]; then
		branch="$(branch_of "$SYSTEM_PULLREQUEST_TARGETBRANCH")"
	elif [[ -n "${BUILD_SOURCEBRANCH:-}" ]]; then
		branch="$(branch_of "$BUILD_SOURCEBRANCH")"
	else
		branch="$(git symbolic-ref --quiet --short HEAD || true)"
	fi
fi
[[ -n "$superproject_url" ]] || superproject_url="$(git remote get-url origin)"

# or_list <word>...: the words joined with " or ".
or_list() {
	local out="$1"
	shift
	while [[ $# -gt 0 ]]; do
		out+=" or $1"
		shift
	done
	printf '%s' "$out"
}

# The branches a pin may be on, in the order they are tried.
allowed=(master)
if [[ -n "$branch" && "$branch" != master ]]; then
	allowed=("$branch" master)
fi
echo "Superproject branch: ${branch:-(none; held to master)}. A pin must be on $(or_list "${allowed[@]}")."

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

# The gitlinks HEAD records, as "<commit> <path>".
mapfile -t pins < <(git ls-tree -r HEAD | awk -F'\t' '$1 ~ / commit / { split($1, f, " "); print f[3] " " $2 }')

if [[ ${#pins[@]} -eq 0 ]]; then
	echo "No submodules are pinned."
	exit 0
fi

failed=0
for pin in "${pins[@]}"; do
	commit="${pin%% *}"
	path="${pin#* }"

	name="$(git config -f .gitmodules --get-regexp '^submodule\..*\.path$' |
		awk -v p="$path" '$2 == p { sub(/^submodule\./, "", $1); sub(/\.path$/, "", $1); print $1; exit }')"
	if [[ -z "$name" ]]; then
		echo "FAIL ${path}: pinned at ${commit}, but .gitmodules does not declare it" >&2
		failed=1
		continue
	fi
	url="$(ci_resolve_url "$superproject_url" "$(git config -f .gitmodules "submodule.${name}.url")")"

	log "${path}: is ${commit} on $(or_list "${allowed[@]}") of ${url}?"
	repo="${scratch}/${name}"
	git init --quiet --bare "$repo"
	auth=()
	if [[ -n "${SYSTEM_ACCESSTOKEN:-}" && "$url" == https://*dev.azure.com/* ]]; then
		auth=(-c "http.extraheader=AUTHORIZATION: bearer ${SYSTEM_ACCESSTOKEN}")
	fi

	# Which of the allowed branches the submodule has. `master` must exist; a
	# missing B only narrows the rule to `master`.
	if ! heads="$(git "${auth[@]}" ls-remote --heads "$url" 2>&1)"; then
		echo "FAIL ${path}: could not list the branches of ${url}" >&2
		printf '     %s\n' "$heads" >&2
		if [[ ${#auth[@]} -gt 0 ]]; then
			echo "     The job token reaches only the repositories the job names; the submodule_pins job checks each one out." >&2
		fi
		failed=1
		continue
	fi
	present=()
	for candidate in "${allowed[@]}"; do
		if awk -v ref="refs/heads/${candidate}" '$2 == ref { found = 1 } END { exit !found }' <<<"$heads"; then
			present+=("$candidate")
		fi
	done
	if [[ " ${present[*]} " != *" master "* ]]; then
		echo "FAIL ${path}: ${url} has no master branch" >&2
		failed=1
		continue
	fi

	refspecs=()
	for candidate in "${present[@]}"; do
		refspecs+=("+refs/heads/${candidate}:refs/remotes/pins/${candidate}")
	done
	if ! git "${auth[@]}" -C "$repo" fetch --quiet --no-tags --filter=tree:0 "$url" "${refspecs[@]}"; then
		echo "FAIL ${path}: could not fetch ${present[*]} from ${url}" >&2
		failed=1
		continue
	fi

	# The scratch repository is a partial clone, so git would fetch a missing
	# commit on demand. A pin absent from the history fetched is already off
	# every allowed branch, so nothing is fetched.
	on=""
	if GIT_NO_LAZY_FETCH=1 git -C "$repo" cat-file -e "${commit}^{commit}" 2>/dev/null; then
		for candidate in "${present[@]}"; do
			if git -C "$repo" merge-base --is-ancestor "$commit" "refs/remotes/pins/${candidate}"; then
				on="$candidate"
				break
			fi
		done
	fi
	if [[ -n "$on" ]]; then
		echo "ok   ${path}: ${commit} is on ${on} ($(git -C "$repo" rev-parse --short "refs/remotes/pins/${on}"))"
	else
		echo "FAIL ${path}: ${commit} is not on $(or_list "${present[@]}") of ${url}; push it to one of them there before pinning it" >&2
		failed=1
	fi
done

exit "$failed"
