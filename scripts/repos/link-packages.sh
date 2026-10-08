#!/usr/bin/env bash
# Links the TypeScript packages the checked-out repositories produce into every
# workspace of the superrepo that names one, the npm counterpart of the patch
# table in .cargo/config.toml. Run it from anywhere:
#
#   scripts/repos/link-packages.sh
#
# The devcontainer runs it when it is created, and a person runs it again
# after a repository gains a package or a workspace.
#
# It first writes .package-links.json, the table of what each checked-out
# repository's workspace produces (sources.py package-links --write), then
# runs the steps sources.py link-plan derives from it, one tab-separated line
# each, every workspace named from this superrepo's root. A repository's
# workspace is its root, so a workspace is named by the repository:
#
#   install <workspace> [<package directory>...]
#   build <workspace>
#
# A workspace with links is installed with each producer's directory given as a
# package to install, `--install-links=false` and `--no-save`: npm installs
# everything else from the lock and writes a symlink for each linked package in
# place of the version the lock names, so no linked version is fetched from the
# feed and the manifests and the lock stay as committed. The dry run of
# `npm ci` before it holds the lock to the manifests, which `npm install` would
# otherwise settle silently. A producer is installed and built before any
# workspace that links it, since a consumer compiles against its `dist/`.
#
# TCAB_SUPERREPO names the superrepo (the one this script sits in by
# default) and PYTHON the interpreter that runs sources.py (python3), which is
# how the table test drives the script through stubs.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="${TCAB_SUPERREPO:-$(cd "$here/../.." && pwd)}"
python="${PYTHON:-python3}"

"$python" "$here/sources.py" package-links --write
plan="$("$python" "$here/sources.py" link-plan)"
if [ -z "$plan" ]; then
	echo "no checked-out workspace names a package another repository produces; nothing to link"
	exit 0
fi

while IFS=$'\t' read -r -a step; do
	[ "${#step[@]}" -gt 0 ] || continue
	action="${step[0]}"
	workspace="${step[1]:-}"
	if [ -z "$workspace" ] || [ ! -f "$root/$workspace/package.json" ]; then
		echo "link-packages: the plan names ${workspace:-no workspace}, which holds no package.json" >&2
		exit 1
	fi
	case "$action" in
	install)
		packages=()
		for directory in "${step[@]:2}"; do
			if [ ! -f "$root/$directory/package.json" ]; then
				echo "link-packages: $workspace links $directory, which holds no package.json" >&2
				exit 1
			fi
			packages+=("$root/$directory")
		done
		if [ "${#packages[@]}" -eq 0 ]; then
			echo "--- $workspace: installed from its lock"
			(cd "$root/$workspace" && npm ci --no-audit --no-fund)
		else
			echo "--- $workspace: installed with ${step[*]:2}"
			if ! (cd "$root/$workspace" && npm ci --dry-run --no-audit --no-fund >/dev/null); then
				echo "link-packages: the lock of $workspace disagrees with its manifests; npm ci --dry-run says why above" >&2
				exit 1
			fi
			(cd "$root/$workspace" &&
				npm install --no-save --install-links=false --no-audit --no-fund "${packages[@]}")
		fi
		;;
	build)
		echo "--- $workspace: built for the workspaces that link it"
		(cd "$root/$workspace" && npm run build)
		;;
	*)
		echo "link-packages: the plan has an unknown step: ${step[*]}" >&2
		exit 1
		;;
	esac
done <<<"$plan"
echo "linked the packages of the checked-out repositories"
