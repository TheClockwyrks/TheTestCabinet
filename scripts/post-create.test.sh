#!/usr/bin/env bash
# Table test for .devcontainer/post-create.sh. Run it directly:
# ./post-create.test.sh
#
# Each case copies post-create.sh into a throwaway tree whose tools are stubs:
# the agent and submodule scripts, the hook installer, the package linker and
# an `npm` first on PATH each append a line to a log, so the subject is what
# post-create runs and in which order. The linker runs after the submodule
# checkout and both installs; a linker that fails leaves the creation
# succeeding and names the command to run again; a tree that is not a git
# repository, or one with no .gitmodules, skips the linker and says so.
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPTS_DIR/.." && pwd)"
pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}

check() { # label detail command...: passes when the command succeeds
	local label="$1" detail="$2"
	shift 2
	if "$@"; then ok "$label"; else bad "$label" "$detail"; fi
}

succeeded() { [ "$status" -eq 0 ]; }
said() { grep -qF -- "$1" <<<"$out"; }
before() { [ "$1" -gt 0 ] && [ "$2" -gt "$1" ]; }
logged_times() { [ "$(grep -cF -- "$1" <<<"$log")" -eq "$2" ]; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export GIT_CEILING_DIRECTORIES="$tmp"

# A stub that logs its name and exits with $2 (0 by default).
stub() { # path name [status]
	mkdir -p "$(dirname "$1")"
	# shellcheck disable=SC2016 # the stub expands these when it runs
	printf '#!/usr/bin/env bash\necho "%s $*" >>"$POST_CREATE_LOG"\nexit %s\n' \
		"$2" "${3:-0}" >"$1"
	chmod +x "$1"
}

# A tree holding post-create.sh and its stubbed tools. $2 is the linker's exit
# status; $3 is "git" for a repository with .gitmodules, "git-bare" for one
# without, and anything else for a plain directory.
fresh_tree() { # name link-status kind
	local tree="$tmp/$1"
	mkdir -p "$tree/.devcontainer" "$tree/gg" "$tree/bin"
	cp "$REPO_ROOT/.devcontainer/post-create.sh" "$tree/.devcontainer/"
	stub "$tree/.devcontainer/tools/ssh-agent.sh" ssh-agent
	stub "$tree/.devcontainer/tools/submodule-checkout.sh" submodule-checkout
	stub "$tree/scripts/setup-hooks.sh" setup-hooks
	stub "$tree/scripts/repos/link-packages.sh" link-packages "$2"
	stub "$tree/bin/npm" npm
	echo '{}' >"$tree/gg/package.json"
	case "$3" in
	git)
		git -C "$tree" init -q
		: >"$tree/.gitmodules"
		;;
	git-bare) git -C "$tree" init -q ;;
	esac
	printf '%s\n' "$tree"
}

run_post_create() { # tree -> sets out, status, log
	local tree="$1"
	export POST_CREATE_LOG="$tree/log"
	: >"$POST_CREATE_LOG"
	out="$(cd "$tree" && PATH="$tree/bin:$PATH" bash .devcontainer/post-create.sh 2>&1)"
	status=$?
	log="$(cat "$POST_CREATE_LOG")"
}

line_of() { # needle -> the line number of its first match in $log, or 0
	local n
	n="$(grep -nF -- "$1" <<<"$log" | head -n 1 | cut -d: -f1)"
	echo "${n:-0}"
}

echo "post-create.sh"

tree="$(fresh_tree linked 0 git)"
run_post_create "$tree"
check "a repository's creation succeeds" "got exit $status: $out" succeeded
checkout="$(line_of submodule-checkout)"
root_ci="$(line_of 'npm ci')"
gg_ci="$(line_of 'npm ci --prefix gg')"
link="$(line_of link-packages)"
check "the submodules are checked out before npm ci" "log: $log" \
	before "$checkout" "$root_ci"
check "gg's npm ci follows the root's" "log: $log" before "$root_ci" "$gg_ci"
check "the packages are linked after both installs" "log: $log" \
	before "$gg_ci" "$link"
check "the packages are linked once" "log: $log" logged_times link-packages 1

tree="$(fresh_tree failing 1 git)"
run_post_create "$tree"
check "a failing link leaves the creation succeeding" "got exit $status: $out" \
	succeeded
check "a failing link says so" "got: $out" said "not linked"
check "a failing link names the command to run again" "got: $out" \
	said "run 'bash scripts/repos/link-packages.sh'"

tree="$(fresh_tree plain 0 none)"
run_post_create "$tree"
check "a plain directory's creation succeeds" "got exit $status: $out" succeeded
check "a plain directory skips the link" "log: $log" \
	logged_times link-packages 0
check "a plain directory says the link was skipped" "got: $out" \
	said "packages (skipped"

tree="$(fresh_tree nomodules 0 git-bare)"
run_post_create "$tree"
check "a repository without .gitmodules succeeds" "got exit $status: $out" \
	succeeded
check "a repository without .gitmodules skips the link" "log: $log" \
	logged_times link-packages 0

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
