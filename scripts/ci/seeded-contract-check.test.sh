#!/usr/bin/env bash
# Table test for seeded-contract-check.sh. Run it directly:
# scripts/ci/seeded-contract-check.test.sh
#
# A copy of the script runs in a throwaway git repository holding a small
# asset-contract package, a staging script whose SHIPPABLE list names it and
# two more packages, and those packages' manifests and sources. It runs the
# real `node`, which it needs; without one the test is skipped. The subject is
# each of its three checks: the generated contract's wording, the seeded
# packages' wording, and that no seeded package reaches the run-record contract.
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

if ! command -v node >/dev/null 2>&1; then
	echo "node is not installed here; skipping the seeded-contract-check test."
	exit 0
fi
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

manifest() { # dir name dependencies-json
	mkdir -p "$1"
	printf '{ "name": "%s", "dependencies": %s }\n' "$2" "$3" >"$1/package.json"
}
fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/packages/asset-contract/src" "$repo/packages/engine/src/testing" \
		"$repo/packages/case-harness/src"
	cp "$CI_DIR/seeded-contract-check.sh" "$repo/scripts/ci/"
	cat >"$repo/scripts/stage-tcab-packages.mjs" <<'MJS'
const SHIPPABLE = [
  "@clockwyrks/asset-contract",
  "@clockwyrks/engine",
  "@clockwyrks/case-harness",
];
export default SHIPPABLE;
MJS
	manifest "$repo/packages/asset-contract" @clockwyrks/asset-contract '{}'
	manifest "$repo/packages/engine" @clockwyrks/engine '{ "@clockwyrks/asset-contract": "file:../asset-contract" }'
	manifest "$repo/packages/case-harness" @clockwyrks/case-harness '{ "@clockwyrks/run-record": "file:../run-record" }'
	manifest "$repo/packages/run-record" @clockwyrks/run-record '{}'
	manifest "$repo/packages/util" @clockwyrks/util '{ "@clockwyrks/run-record": "file:../run-record" }'
	echo '/** A rig: the bones a model is posed by. */ export interface Rig { bones: string[] }' \
		>"$repo/packages/asset-contract/src/index.ts"
	echo '/** Steps the game world one tick. */ export function step() {}' >"$repo/packages/engine/src/index.ts"
	echo '// the leaderboard fixture a test reads' >"$repo/packages/engine/src/testing/fixture.ts"
	echo '// asserts the run record is not imported' >"$repo/packages/engine/src/index.test.ts"
	echo '// reads the run record after the container is gone' >"$repo/packages/case-harness/src/index.ts"
	git -C "$repo" init --quiet
	printf '%s' "$repo"
}
run() { (cd "$1" && scripts/ci/seeded-contract-check.sh 2>&1); }

repo="$(fresh_repo)"
out="$(run "$repo")"
check_equal "clean seeded packages pass" "0" "$?"
check_equal "naming the seeded packages, case-harness excepted" \
	"Seeded packages (asset-contract engine) name nothing about evaluation and none reaches the contract." "$out"

for word in leaderboard benchmark "run record" harness "https://testcabinet.ai" reviewed scoring; do
	repo="$(fresh_repo)"
	echo "/** Used by the $word. */ export type X = 1;" >>"$repo/packages/asset-contract/src/index.ts"
	out="$(run "$repo")"
	check_equal "the generated contract naming '$word' fails" "1" "$?"
	check_contains "saying so ('$word')" "The seeded contract package names what a model must not learn" "$out"
done

for word in leaderboard "run record" "the review UI" TestCabinet; do
	repo="$(fresh_repo)"
	echo "// shown on the $word" >>"$repo/packages/engine/src/index.ts"
	out="$(run "$repo")"
	check_equal "a seeded package naming '$word' fails" "1" "$?"
	check_contains "naming the line ('$word')" "packages/engine/src/index.ts:2:" "$out"
done

repo="$(fresh_repo)"
echo "// the reviewer reads this" >>"$repo/packages/engine/src/index.ts"
out="$(run "$repo")"
check_equal "a seeded package naming a reviewer passes" "0" "$?"

repo="$(fresh_repo)"
manifest "$repo/packages/engine" @clockwyrks/engine '{ "@clockwyrks/run-record": "file:../run-record" }'
out="$(run "$repo")"
check_equal "a seeded package depending on the run record fails" "1" "$?"
check_contains "with the trail" "@clockwyrks/engine -> @clockwyrks/run-record" "$out"

repo="$(fresh_repo)"
manifest "$repo/packages/engine" @clockwyrks/engine '{ "@clockwyrks/util": "file:../util" }'
out="$(run "$repo")"
check_equal "one reaching it through another package fails" "1" "$?"
check_contains "with the whole trail" "@clockwyrks/engine -> @clockwyrks/util -> @clockwyrks/run-record" "$out"

repo="$(fresh_repo)"
rm "$repo/packages/asset-contract/src/index.ts"
out="$(run "$repo")"
check_equal "a contract package holding no TypeScript fails" "1" "$?"
check_contains "saying how to generate it" "Run \`npm run gen:contract\`." "$out"

repo="$(fresh_repo)"
rm -r "$repo/packages/asset-contract/src"
out="$(run "$repo")"
check_equal "a missing contract package fails" "1" "$?"
check_contains "saying not to delete the gate" "If the package moved, update this gate" "$out"

repo="$(fresh_repo)"
printf 'export default [];\n' >"$repo/scripts/stage-tcab-packages.mjs"
out="$(run "$repo")"
check_equal "a staging script whose list cannot be read fails" "1" "$?"
check_contains "saying so" "could not read SHIPPABLE" "$out"

echo
echo "seeded-contract-check.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
