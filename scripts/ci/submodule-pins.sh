#!/usr/bin/env bash
# Verifies that every submodule pin is on that submodule's `master`.
#
#   scripts/ci/submodule-pins.sh [<superproject-url>]
#
# A submodule's own pipeline mirrors its `master` to GitHub, and nothing else
# reaches the mirror. A superproject commit whose pins are all on `master`
# therefore names only submodule commits the mirror holds, so a clone of the
# superproject's GitHub mirror can always fetch its submodules.
#
# Each submodule's URL comes from `.gitmodules`. A relative URL resolves against
# <superproject-url> exactly as git resolves it, which defaults to the `origin`
# remote. For each submodule the script fetches the commits of `master` into a
# scratch repository without trees or blobs, so the check costs kilobytes even
# for cold-storage.
#
# On an Azure Pipelines agent the job passes its access token in
# SYSTEM_ACCESSTOKEN, and it is sent to dev.azure.com over HTTPS. The job must
# reference each submodule repository (a `uses:` statement), because the project
# scopes the job token to the repositories a pipeline names.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

readonly BRANCH="master"

# resolve_url <base> <url>: the address git clones a submodule from when
# `.gitmodules` names it <url> in a superproject cloned from <base>. An absolute
# URL is returned as it is. Each leading `../` drops one path component of
# <base>, which may be a URL, an scp-style address, or a local path.
resolve_url() {
	local base="$1" url="$2"
	if [[ "$url" != ./* && "$url" != ../* ]]; then
		printf '%s\n' "$url"
		return
	fi
	base="${base%/}"
	while :; do
		case "$url" in
			./*) url="${url#./}" ;;
			../*)
				url="${url#../}"
				if [[ "$base" == */* ]]; then
					base="${base%/*}"
				elif [[ "$base" == *:* ]]; then
					base="${base%:*}:"
				else
					echo "submodule-pins.sh: cannot resolve a relative URL against '$1'" >&2
					return 1
				fi
				;;
			*) break ;;
		esac
	done
	if [[ "$base" == *: ]]; then
		printf '%s%s\n' "$base" "$url"
	else
		printf '%s/%s\n' "$base" "$url"
	fi
}

# The resolver alone, for the table test.
if [[ "${1:-}" == "--resolve" ]]; then
	resolve_url "$2" "$3"
	exit
fi

superproject_url="${1:-$(git remote get-url origin)}"

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
	url="$(resolve_url "$superproject_url" "$(git config -f .gitmodules "submodule.${name}.url")")"

	log "${path}: is ${commit} on ${BRANCH} of ${url}?"
	repo="${scratch}/${name}"
	git init --quiet --bare "$repo"
	auth=()
	if [[ -n "${SYSTEM_ACCESSTOKEN:-}" && "$url" == https://*dev.azure.com/* ]]; then
		auth=(-c "http.extraheader=AUTHORIZATION: bearer ${SYSTEM_ACCESSTOKEN}")
	fi
	if ! git "${auth[@]}" -C "$repo" fetch --quiet --no-tags --filter=tree:0 "$url" "refs/heads/${BRANCH}"; then
		echo "FAIL ${path}: could not fetch ${BRANCH} from ${url}" >&2
		if [[ ${#auth[@]} -gt 0 ]]; then
			echo "     The job token reaches only the repositories the job names in a \`uses:\` statement." >&2
		fi
		failed=1
		continue
	fi

	# The scratch repository is a partial clone, so git would fetch a missing
	# commit on demand. A pin absent from the history fetched is already off
	# `master`, so nothing is fetched.
	if GIT_NO_LAZY_FETCH=1 git -C "$repo" cat-file -e "${commit}^{commit}" 2>/dev/null &&
		git -C "$repo" merge-base --is-ancestor "$commit" FETCH_HEAD; then
		echo "ok   ${path}: ${commit} is on ${BRANCH} ($(git -C "$repo" rev-parse --short FETCH_HEAD))"
	else
		echo "FAIL ${path}: ${commit} is not on ${BRANCH} of ${url}; push it to ${BRANCH} there before pinning it" >&2
		failed=1
	fi
done

exit "$failed"
