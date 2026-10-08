#!/usr/bin/env bash
# Initializes the submodules one job needs, and no others.
#
#   scripts/ci/submodules.sh init [--build-context] [<path>...]
#   scripts/ci/submodules.sh list [--build-context] [<path>...]
#   scripts/ci/submodules.sh check
#
# WHY A JOB NAMES ITS SUBMODULES. Every checkout in the pipeline is made with
# `submodules: false`, and nothing clones recursively: cold-storage alone is
# about 2 GB of media that no build reads, and each repository split out of
# this one later arrives as another submodule that only some jobs read. So a job
# that needs a submodule's files says which, and this script fetches exactly
# those, each at the commit the superproject pins, one commit deep, without
# their own submodules.
#
# `init` takes submodule paths as .gitmodules declares them; a path it does not
# declare is refused. `--build-context` adds every submodule the root
# .dockerignore admits any part of (scripts/ci/build-context.sh --submodules),
# which is what a job that builds an image from the repository root passes, so
# the allowlist stays the one place that says what an image reads. With nothing
# to initialize it says so and succeeds. `list` prints the paths `init` would
# initialize, one per line, and touches nothing.
#
# On an Azure Pipelines agent the job passes its access token in
# SYSTEM_ACCESSTOKEN, and it is sent to dev.azure.com alone. The project scopes
# the job token to the repositories a job names, so a job that runs this must
# also check out each submodule's repository (as the `submodule_pins` job does),
# or the fetch is refused.
#
# `check` holds the `submodules` parameter of .azure/project/jobs.yml, the list
# the `submodule_pins` job checks out, to .gitmodules: the same paths, each with
# the repository its URL names. scripts/ci/submodules.test.sh runs it against
# the repository, so the shell-tests gate fails on a submodule added to one and
# not the other.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

readonly JOBS_FILE=".azure/project/jobs.yml"

usage() {
	cat >&2 <<'EOF'
usage: scripts/ci/submodules.sh init [--build-context] [<path>...]
       scripts/ci/submodules.sh list [--build-context] [<path>...]
       scripts/ci/submodules.sh check
EOF
	exit 2
}

# The path of every submodule .gitmodules declares, one per line.
declared_paths() {
	[[ -f .gitmodules ]] || return 0
	git config -f .gitmodules --get-regexp '^submodule\..*\.path$' 2>/dev/null | awk '{ print $2 }'
}

# The name .gitmodules gives the submodule at path `$1`.
name_of() {
	git config -f .gitmodules --get-regexp '^submodule\..*\.path$' 2>/dev/null |
		awk -v p="$1" '$2 == p { sub(/^submodule\./, "", $1); sub(/\.path$/, "", $1); print $1; exit }'
}

# The paths a `list` or `init` names, deduplicated in the order given.
selected=()
select_paths() {
	local build_context=0 path declared seen=" "
	local -a wanted=()
	while [[ $# -gt 0 ]]; do
		case "$1" in
			--build-context) build_context=1 ;;
			--recursive)
				echo "submodules.sh: a job initializes the submodules it names, never recursively" >&2
				exit 2
				;;
			-*) usage ;;
			*) wanted+=("${1%/}") ;;
		esac
		shift
	done
	if ((build_context)); then
		mapfile -t -O "${#wanted[@]}" wanted < <(scripts/ci/build-context.sh --submodules)
	fi
	mapfile -t declared < <(declared_paths)
	for path in "${wanted[@]}"; do
		[[ -n "$path" ]] || continue
		if ! printf '%s\n' "${declared[@]}" | grep -qxF -- "$path"; then
			echo "submodules.sh: .gitmodules declares no submodule at '$path'" >&2
			exit 1
		fi
		[[ "$seen" == *" $path "* ]] && continue
		seen+="$path "
		selected+=("$path")
	done
}

# The repository a submodule URL names: its last path component, without `.git`.
repository_of() {
	local url="${1%/}"
	url="${url%.git}"
	url="${url##*/}"
	printf '%s\n' "${url##*:}"
}

check() {
	local failed=0 path name url repository
	[[ -f "$JOBS_FILE" ]] || {
		echo "FAIL $JOBS_FILE does not exist" >&2
		return 1
	}
	# The parameter's default, as "<path> <repository>" lines: the block from
	# `- name: submodules` to the next parameter or the end of the list.
	local -a listed
	mapfile -t listed < <(awk '
		/^  - name: / { inside = ($3 == "submodules"); next }
		/^[^ #]/ { inside = 0 }
		inside && /^ *- path: / { path = $3 }
		inside && /^ *repository: / { print path " " $2; path = "" }
	' "$JOBS_FILE")
	for path in $(declared_paths); do
		name="$(name_of "$path")"
		url="$(git config -f .gitmodules "submodule.${name}.url")"
		repository="$(repository_of "$url")"
		if printf '%s\n' "${listed[@]}" | grep -qxF -- "$path $repository"; then
			echo "ok   ${path}: ${JOBS_FILE} checks out ${repository}"
		else
			echo "FAIL ${path}: .gitmodules declares it from ${url}, and the submodules parameter of ${JOBS_FILE} has no entry 'path: ${path}' with 'repository: ${repository}'" >&2
			failed=1
		fi
	done
	local entry
	for entry in "${listed[@]}"; do
		[[ -n "$entry" ]] || continue
		path="${entry%% *}"
		if ! declared_paths | grep -qxF -- "$path"; then
			echo "FAIL ${path}: the submodules parameter of ${JOBS_FILE} lists it, and .gitmodules declares no submodule there" >&2
			failed=1
		fi
	done
	return "$failed"
}

init() {
	local path auth=()
	if ((${#selected[@]} == 0)); then
		echo "No submodule to initialize."
		return 0
	fi
	if [[ -n "${SYSTEM_ACCESSTOKEN:-}" ]]; then
		auth=(-c "http.https://dev.azure.com/.extraheader=AUTHORIZATION: bearer ${SYSTEM_ACCESSTOKEN}")
	fi
	for path in "${selected[@]}"; do
		log "${path}: the pinned commit, one deep"
		if ! git "${auth[@]}" -c submodule.recurse=false submodule update --init --depth 1 -- "$path"; then
			echo "submodules.sh: could not initialize ${path}" >&2
			if [[ ${#auth[@]} -gt 0 ]]; then
				echo "     The job token reaches only the repositories the job names; check the submodule's repository out in the job." >&2
			fi
			return 1
		fi
		echo "ok   ${path} at $(git -C "$path" rev-parse --short HEAD)"
	done
}

[[ $# -ge 1 ]] || usage
command="$1"
shift
case "$command" in
	init)
		select_paths "$@"
		init
		;;
	list)
		select_paths "$@"
		((${#selected[@]} == 0)) || printf '%s\n' "${selected[@]}"
		;;
	check)
		[[ $# -eq 0 ]] || usage
		check
		;;
	*) usage ;;
esac
