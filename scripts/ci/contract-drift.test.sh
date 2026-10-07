#!/usr/bin/env bash
# Table test for contract-drift.sh. Run it directly:
# scripts/ci/contract-drift.test.sh
#
# A copy of the script runs in a throwaway git repository holding committed
# stand-ins for the generated contract artifacts, with `npm` stubbed first on
# PATH: its `run gen:contract` rewrites whichever file the case names, or
# nothing. The subject is which differences fail the gate: the generated
# TypeScript and JSON Schema, and nothing else in the tree.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}

check_equal() { # label expected actual
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		bad "$1" "expected: $2" "got:      ${3:-<empty>}"
	fi
}

check_contains() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		ok "$1"
	else
		bad "$1" "expected output containing: $2" "got: ${3:-<empty>}"
	fi
}

check_lacks() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		bad "$1" "expected no output containing: $2" "got: ${3:-<empty>}"
	else
		ok "$1"
	fi
}

check_exists() { # label path
	if [ -e "$2" ] || [ -L "$2" ]; then
		ok "$1"
	else
		bad "$1" "expected $2 to exist"
	fi
}

check_absent() { # label path
	if [ -e "$2" ] || [ -L "$2" ]; then
		bad "$1" "expected $2 to be gone"
	else
		ok "$1"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

readonly GENERATED="packages/run-record/src/index.ts packages/asset-contract/src/index.ts apps/docs/public/schema/run-record.json"
fresh_repo() {
	local repo file
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/bin"
	cp "$CI_DIR/contract-drift.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
	for file in $GENERATED README.md; do
		mkdir -p "$repo/$(dirname "$file")"
		echo "generated" >"$repo/$file"
	done
	cat >"$repo/bin/npm" <<'STUB'
#!/usr/bin/env bash
echo "npm $* [cwd=$PWD]" >>"$STUB_LOG"
[[ -n "${STUB_DRIFT:-}" ]] && echo "regenerated" >"$STUB_DRIFT"
exit "${STUB_NPM_EXIT:-0}"
STUB
	chmod +x "$repo/bin/npm"
	git -C "$repo" init --quiet
	git -C "$repo" add -A
	git -C "$repo" commit --quiet -m generated
	printf '%s' "$repo"
}
run() { # repo [env...]
	local repo="$1"
	shift
	: >"$tmp/npm.log"
	(cd "$tmp" && env PATH="$repo/bin:$PATH" STUB_LOG="$tmp/npm.log" "$@" "$repo/scripts/ci/contract-drift.sh" 2>&1)
}

repo="$(fresh_repo)"
out="$(run "$repo")"
check_equal "a contract that regenerates identically passes" "0" "$?"
check_equal "after regenerating it from the repository root" "npm run gen:contract [cwd=$repo]" "$(cat "$tmp/npm.log")"

for file in $GENERATED; do
	repo="$(fresh_repo)"
	out="$(run "$repo" STUB_DRIFT="$repo/$file")"
	check_equal "drift in $file fails" "1" "$?"
	check_contains "showing the difference ($file)" "+regenerated" "$out"
	check_contains "and how to fix it ($file)" "Run \`npm run gen:contract\` and commit the result." "$out"
done

repo="$(fresh_repo)"
out="$(run "$repo" STUB_DRIFT="$repo/README.md")"
check_equal "a change outside the generated artifacts passes" "0" "$?"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_NPM_EXIT=1)"
check_equal "a generator that fails fails the gate" "1" "$?"
check_lacks "before any drift is checked" "check for drift" "$out"

echo
echo "contract-drift.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
