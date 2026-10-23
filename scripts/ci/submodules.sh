#!/usr/bin/env bash
# Initializes the submodules one job needs, and no others.
#
#   scripts/ci/submodules.sh init [--build-context] [<path>...]
#   scripts/ci/submodules.sh list [--build-context] [<path>...]
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
# SYSTEM_ACCESSTOKEN, and it is sent to dev.azure.com alone. The token reads
# every repository of the project, so a job that runs this names no submodule
# repository for the token's sake.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

usage() {
	cat >&2 <<'EOF'
usage: scripts/ci/submodules.sh init [--build-context] [<path>...]
       scripts/ci/submodules.sh list [--build-context] [<path>...]
EOF
	exit 2
}

# The path of every submodule .gitmodules declares, one per line.
declared_paths() {
	[[ -f .gitmodules ]] || return 0
	git config -f .gitmodules --get-regexp '^submodule\..*\.path$' 2>/dev/null | awk '{ print $2 }'
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
		# grep reads a here-string, not a pipe: under pipefail, `grep -q` leaving on
		# its first match would fail the writer with SIGPIPE, and the lookup with it.
		if ! grep -qxF -- "$path" <<<"$(printf '%s\n' "${declared[@]}")"; then
			echo "submodules.sh: .gitmodules declares no submodule at '$path'" >&2
			exit 1
		fi
		[[ "$seen" == *" $path "* ]] && continue
		seen+="$path "
		selected+=("$path")
	done
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
				echo "     The job token reads every repository of the project only while the project setting \"Protect access to repositories in YAML pipelines\" is off and the repository is authorized for the pipeline." >&2
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
	*) usage ;;
esac
