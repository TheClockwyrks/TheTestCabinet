#!/usr/bin/env bash
# Which groups of the pipeline's check jobs a change reaches. The `paths` job
# of .azure/project/jobs.yml runs it, and every conditional check job reads its
# answer:
#
#   rust        rust_build, binary_linux, binary_windows
#   gg          the gg_tests_<k>_of_N partitions
#   submodules  submodule_pins
#
# Each answer is printed as an output variable of the step,
#
#   ##vso[task.setvariable variable=<group>;isOutput=true]true|false
#
# and a line naming the first changed path that reached the group, or that none
# did.
#
# Only a pull request is narrowed. A pull request's checkout is the merge of
# the source into the target, so its first parent is the target branch and the
# diff between the two is exactly what merging would change. A push, a manual
# run and a run on a tag answer `true` for every group, so the mirror, the
# images, a deployment and a release always follow a full run; so does a pull
# request whose checkout is not a merge commit, which the job never expects.
#
# The classification is by exclusion. A changed path reaches a group unless it
# is one that group's jobs are known never to read, so a path with no rule here
# runs everything, and a new directory costs a run until a rule says otherwise.
# The one allowlist is `submodules`, whose job reads nothing but the pins. The
# rules are in `reaches_rust`, `reaches_gg` and `reaches_submodules`, and
# changed-paths.test.sh is their table test.
#
#   scripts/ci/changed-paths.sh [--reason <Build.Reason>] [--paths-from <file>]
#
# `--reason` defaults to BUILD_REASON, the pipeline's own variable, and
# `--paths-from` takes the changed paths from a file (`-` for stdin) instead of
# git, which is how the test feeds it.
set -euo pipefail

# shellcheck source=scripts/ci/tcab-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

readonly GROUPS_IN_ORDER=(rust gg submodules)

usage() {
	echo "usage: scripts/ci/changed-paths.sh [--reason <Build.Reason>] [--paths-from <file>]" >&2
	exit 2
}

reason="${BUILD_REASON:-}"
paths_from=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--reason)
			[[ $# -ge 2 ]] || usage
			reason="$2"
			shift 2
			;;
		--paths-from)
			[[ $# -ge 2 ]] || usage
			paths_from="$2"
			shift 2
			;;
		*) usage ;;
	esac
done

# The paths under which a submodule is pinned, from .gitmodules.
submodule_paths() {
	[[ -f .gitmodules ]] || return 0
	git config -f .gitmodules --get-regexp '^submodule\..*\.path$' 2>/dev/null | awk '{ print $2 }'
}

# A change to any of these reaches every group: they are the pipeline itself,
# the image the Rust jobs run in, or this script.
is_pipeline() { # path
	case "$1" in
		.azure/* | azure-pipelines*.yml | ci/images/* | rust-toolchain.toml | \
			scripts/ci/changed-paths.sh | scripts/ci/tcab-lib.sh) return 0 ;;
	esac
	return 1
}

# Whether rust_build, binary_linux and binary_windows read the path. They
# compile the whole workspace and run the core and CLI suites, which read
# `engines/`, `harnesses/`, `orchestrators/`, `packages/` and the test cases
# and game jams at compile time or in a test, so those stay in. What is left
# out is what no Rust job opens: the sites, the board, the manifests, the
# run-container definitions, the gates' sources, prose, every shell test, and
# the scripts only the image, deploy and release jobs run.
reaches_rust() { # path
	is_pipeline "$1" && return 0
	case "$1" in
		apps/docs/* | apps/web/* | apps/site/*) return 1 ;;
		tasks/* | .github/* | .devcontainer/* | .claude/* | .vscode/*) return 1 ;;
		deployments/*) return 1 ;;
		containers/image-names.sh) return 0 ;;
		containers/*) return 1 ;;
		ci/*) return 1 ;;
		test-cases/* | game-jams/* | crates/*.md) return 0 ;;
		*.md) return 1 ;;
		.gitmodules | .gitignore | .editorconfig | .copier-answers.yml | Makefile) return 1 ;;
		.cspell/* | cspell.json | .prettierrc* | .prettierignore | .markdownlint* | \
			eslint.config.* | .pre-commit-config.yaml | LICENSE*) return 1 ;;
		scripts/*.test.sh | scripts/*.test.mjs) return 1 ;;
		scripts/ci/audio-packs-check.mjs | scripts/ci/audio-store-image.sh | \
			scripts/ci/build-context.sh | scripts/ci/build-image.sh | \
			scripts/ci/ci-image-purge.sh | scripts/ci/ci-image.sh | \
			scripts/ci/contract-drift.sh | scripts/ci/deploy-docs.sh | \
			scripts/ci/deploy-environment.sh | scripts/ci/deploy.sh | \
			scripts/ci/gg-dist.sh | scripts/ci/gg-prebuilt.sh | \
			scripts/ci/gg-version-gate.sh | scripts/ci/k8s-deploy-sets.sh | \
			scripts/ci/manifest.sh | scripts/ci/mirror.sh | scripts/ci/npm-install.sh | \
			scripts/ci/pin-images.sh | scripts/ci/post-deploy.sh | \
			scripts/ci/pre-deploy.sh | scripts/ci/publish-gg.sh | \
			scripts/ci/registry-purge.sh | scripts/ci/report-disk.sh | \
			scripts/ci/require-gated-commit.sh | scripts/ci/retire-legacy-backend.sh | \
			scripts/ci/run-image-inputs.sh | scripts/ci/run-images.sh | \
			scripts/ci/seeded-contract-check.sh | scripts/ci/service-image.sh | \
			scripts/ci/service-images.sh | scripts/ci/settle-workloads.sh | \
			scripts/ci/spec-vocabulary-check.mjs | scripts/ci/submodule-pins.sh | \
			scripts/ci/submodules.sh | \
			scripts/ci/tcab-image-pin.sh) return 1 ;;
	esac
	local pin
	for pin in $(submodule_paths); do
		[[ "$1" == "$pin" ]] && return 1
	done
	return 0
}

# Whether the gg test partitions read the path: what reaches the Rust jobs,
# less what only the core and CLI suites and the release build read.
reaches_gg() { # path
	is_pipeline "$1" && return 0
	reaches_rust "$1" || return 1
	case "$1" in
		test-cases/* | game-jams/* | containers/*) return 1 ;;
		scripts/ci/release-build.sh | scripts/ci/release-test.sh | \
			scripts/ci/release-doctest.sh | scripts/ci/binary-smoke.sh | \
			scripts/ci/smoke-binary.sh | scripts/ci/install-nextest.sh | \
			scripts/ci/rust-build.sh) return 1 ;;
	esac
	return 0
}

# Whether submodule_pins reads the path: the pins, their declaration, and the
# script that checks them.
reaches_submodules() { # path
	is_pipeline "$1" && return 0
	case "$1" in
		.gitmodules | scripts/ci/submodule-pins.sh) return 0 ;;
	esac
	local pin
	for pin in $(submodule_paths); do
		[[ "$1" == "$pin" ]] && return 0
	done
	return 1
}

answer() { # group value why
	printf '%-10s %s (%s)\n' "$1" "$([[ "$2" == true ]] && echo runs || echo skipped)" "$3"
	echo "##vso[task.setvariable variable=$1;isOutput=true]$2"
}

every_group() { # why
	local group
	for group in "${GROUPS_IN_ORDER[@]}"; do
		answer "$group" true "$1"
	done
}

if [[ "$reason" != PullRequest ]]; then
	every_group "not a pull request: ${reason:-no reason given}"
	exit 0
fi

paths=()
if [[ -n "$paths_from" ]]; then
	if [[ "$paths_from" == - ]]; then
		mapfile -t paths
	else
		mapfile -t paths <"$paths_from"
	fi
else
	if ! git rev-parse --verify --quiet 'HEAD^2' >/dev/null; then
		echo "##vso[task.logissue type=warning]HEAD is not a merge commit; every check job runs"
		every_group "the checkout is not a merge commit"
		exit 0
	fi
	mapfile -t paths < <(git diff --name-only HEAD^1 HEAD)
fi

log "${#paths[@]} changed path(s) against the target branch"
printf '  %s\n' "${paths[@]}"

for group in "${GROUPS_IN_ORDER[@]}"; do
	hit=""
	for path in "${paths[@]}"; do
		[[ -n "$path" ]] || continue
		if "reaches_$group" "$path"; then
			hit="$path"
			break
		fi
	done
	if [[ -n "$hit" ]]; then
		answer "$group" true "$hit"
	else
		answer "$group" false "no changed path reaches it"
	fi
done
