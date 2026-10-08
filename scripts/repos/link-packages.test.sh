#!/usr/bin/env bash
# Table test for link-packages.sh. Run it directly:
# ./link-packages.test.sh
#
# Each case builds a throwaway superrepo holding the workspaces a plan names,
# and drives the script through two stubs: an interpreter standing in for
# sources.py, which records its calls and prints the plan the case wrote, and
# an npm that records each call with the workspace it ran in. Nothing installs
# a package or reaches a registry.
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}

check_passed() { # label status output
	if [ "$2" -eq 0 ]; then
		ok "$1"
	else
		bad "$1" "expected exit 0" "got exit $2: ${3:-<empty>}"
	fi
}

check_failed() { # label status
	if [ "$2" -ne 0 ]; then
		ok "$1"
	else
		bad "$1" "expected a non-zero exit" "got exit 0"
	fi
}

check_contains() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		ok "$1"
	else
		bad "$1" "expected output containing: $2" "got: ${3:-<empty>}"
	fi
}

check_equals() { # label expected actual
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		bad "$1" "expected: $2" "got: $3"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/bin"
# npm: records "<workspace> <arguments>", and fails the call whose arguments
# contain STUB_NPM_FAIL.
cat >"$tmp/bin/npm" <<'STUB'
#!/usr/bin/env bash
echo "$(basename "$PWD") $*" >>"$STUB_LOG"
if [ -n "${STUB_NPM_FAIL:-}" ] && [[ "$*" == *"$STUB_NPM_FAIL"* ]]; then
	echo "npm: failed as asked" >&2
	exit 1
fi
STUB
# The interpreter: records the sources.py command, fails the one named by
# STUB_SOURCES_FAIL, and answers link-plan with the case's plan.
cat >"$tmp/bin/python" <<'STUB'
#!/usr/bin/env bash
shift
echo "sources $*" >>"$STUB_LOG"
if [ "${STUB_SOURCES_FAIL:-}" = "$1" ]; then
	echo "sources: failed as asked" >&2
	exit 1
fi
if [ "$1" = link-plan ]; then cat "$STUB_PLAN"; fi
STUB
chmod +x "$tmp/bin/npm" "$tmp/bin/python"

TAB=$'\t'

# A superrepo holding a workspace per argument, with a package per workspace
# under packages/model.
fresh_superrepo() { # workspace...
	local base
	base="$(mktemp -d "$tmp/caseXXXXXX")"
	for workspace in "$@"; do
		mkdir -p "$base/super/$workspace/packages/model"
		printf '{"name": "%s"}\n' "$workspace" >"$base/super/$workspace/package.json"
		printf '{"name": "@clockwyrks/%s-model"}\n' "${workspace%%/*}" >"$base/super/$workspace/packages/model/package.json"
	done
	printf '%s' "$base"
}

run_link() { # base [VAR=value...]
	local base="$1"
	shift
	: >"$base/log"
	env PATH="$tmp/bin:$PATH" PYTHON="$tmp/bin/python" TCAB_SUPERREPO="$base/super" \
		STUB_LOG="$base/log" STUB_PLAN="$base/plan" "$@" "$SCRIPTS_DIR/link-packages.sh" 2>&1
}

calls() { cat "$1/log"; }

# --- Nothing names a sibling's package ---------------------------------------
base="$(fresh_superrepo contracts)"
: >"$base/plan"
out="$(run_link "$base")"
status=$?
check_passed "an empty plan succeeds" "$status" "$out"
check_contains "it says there is nothing to link" "nothing to link" "$out"
check_equals "it writes the table and reads the plan, and runs no npm" \
	"sources package-links --write
sources link-plan" "$(calls "$base")"

# --- A producer is installed and built before the workspace that links it ----
base="$(fresh_superrepo contracts web)"
{
	printf 'install%scontracts\n' "$TAB"
	printf 'build%scontracts\n' "$TAB"
	printf 'install%sweb%scontracts/packages/model\n' "$TAB" "$TAB"
} >"$base/plan"
out="$(run_link "$base")"
status=$?
check_passed "a plan with a link succeeds" "$status" "$out"
check_equals "the table is written, the producer installed and built, the consumer checked and linked" \
	"sources package-links --write
sources link-plan
contracts ci --no-audit --no-fund
contracts run build
web ci --dry-run --no-audit --no-fund
web install --no-save --install-links=false --no-audit --no-fund $base/super/contracts/packages/model" \
	"$(calls "$base")"
check_contains "it names the links it installs" "web: installed with contracts/packages/model" "$out"
check_contains "it says it is done" "linked the packages of the checked-out repositories" "$out"

# --- Every link of a workspace is one argument of one install ------------------
base="$(fresh_superrepo contracts web the-spec-cabinet)"
printf 'install%sthe-spec-cabinet%scontracts/packages/model%sweb/packages/model\n' \
	"$TAB" "$TAB" "$TAB" >"$base/plan"
out="$(run_link "$base")"
status=$?
check_passed "a workspace with two links succeeds" "$status" "$out"
check_equals "both directories are passed to one install" \
	"the-spec-cabinet install --no-save --install-links=false --no-audit --no-fund $base/super/contracts/packages/model $base/super/web/packages/model" \
	"$(grep ' install ' "$base/log")"

# --- A lock that disagrees with its manifests is refused before the install ---
base="$(fresh_superrepo contracts web)"
printf 'install%sweb%scontracts/packages/model\n' "$TAB" "$TAB" >"$base/plan"
out="$(run_link "$base" STUB_NPM_FAIL=--dry-run)"
check_failed "a failed dry run fails the script" $?
check_contains "it says the lock disagrees" "the lock of web disagrees with its manifests" "$out"
check_equals "nothing is installed after it" "" "$(grep ' install ' "$base/log")"

# --- A producer that does not build stops the script ---------------------------
base="$(fresh_superrepo contracts web)"
{
	printf 'install%scontracts\n' "$TAB"
	printf 'build%scontracts\n' "$TAB"
	printf 'install%sweb%scontracts/packages/model\n' "$TAB" "$TAB"
} >"$base/plan"
out="$(run_link "$base" STUB_NPM_FAIL="run build")"
check_failed "a failed build fails the script" $?
check_equals "the consumer is not installed against it" "" "$(grep '^web' "$base/log")"

# --- A failed install of a producer stops the script ---------------------------
out="$(run_link "$base" STUB_NPM_FAIL="ci --no-audit")"
check_failed "a failed install fails the script" $?
check_equals "the producer is not built" "" "$(grep 'run build' "$base/log")"

# --- A link to a directory that holds no package is refused --------------------
base="$(fresh_superrepo web)"
printf 'install%sweb%scontracts/packages/model\n' "$TAB" "$TAB" >"$base/plan"
out="$(run_link "$base")"
check_failed "a link to a missing directory fails the script" $?
check_contains "it names the directory" "links contracts/packages/model, which holds no package.json" "$out"
check_equals "npm is never run" "" "$(grep -v '^sources' "$base/log")"

# --- A plan naming a workspace that is not there is refused ---------------------
base="$(fresh_superrepo)"
printf 'install%sweb\n' "$TAB" >"$base/plan"
out="$(run_link "$base")"
check_failed "a missing workspace fails the script" $?
check_contains "it names the workspace" "names web, which holds no package.json" "$out"

# --- An unknown step is refused --------------------------------------------------
base="$(fresh_superrepo contracts)"
printf 'publish%scontracts\n' "$TAB" >"$base/plan"
out="$(run_link "$base")"
check_failed "an unknown step fails the script" $?
check_contains "it names the step" "unknown step: publish" "$out"

# --- A table that cannot be written stops the script before any step -----------
base="$(fresh_superrepo contracts)"
printf 'install%scontracts\n' "$TAB" >"$base/plan"
out="$(run_link "$base" STUB_SOURCES_FAIL=package-links)"
check_failed "a failed table write fails the script" $?
check_equals "no plan is read and npm is never run" "sources package-links --write" "$(calls "$base")"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
