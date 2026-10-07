#!/usr/bin/env bash
# Table test for gg-test.sh. Run it directly: scripts/ci/gg-test.test.sh
#
# A copy of the script runs in a throwaway repository with `cargo` stubbed first
# on PATH, recording its arguments. The subject is the nextest invocation, whole
# or as one hash partition, and the partitions it refuses.
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

# A throwaway repository holding a copy of the script, with a `cargo` first on
# PATH that records each invocation and exits with STUB_CARGO_EXIT_<n> for its
# n-th call (0 when unset).
fresh_repo() { # script
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/bin"
	cp "$CI_DIR/$1" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
	cat >"$repo/bin/cargo" <<'STUB'
#!/usr/bin/env bash
echo "cargo $* [cwd=$PWD]" >>"$STUB_LOG"
n="$(grep -c . "$STUB_LOG")"
code="STUB_CARGO_EXIT_$n"
exit "${!code:-0}"
STUB
	chmod +x "$repo/bin/cargo"
	printf '%s' "$repo"
}
run() { # repo script args...
	local repo="$1" script="$2"
	shift 2
	: >"$tmp/cargo.log"
	(cd "$tmp" && STUB_LOG="$tmp/cargo.log" PATH="$repo/bin:$PATH" "$repo/scripts/ci/$script" "$@" 2>&1)
}

repo="$(fresh_repo gg-test.sh)"
out="$(run "$repo" gg-test.sh)"
check_equal "the whole suite passes" "0" "$?"
check_equal "runs gg's lib tests, unpartitioned" \
	"cargo nextest run --locked -p test-cabinet-gg --lib [cwd=$repo]" "$(cat "$tmp/cargo.log")"

out="$(run "$repo" gg-test.sh 2/4)"
check_equal "one partition passes" "0" "$?"
check_equal "runs that hash partition" \
	"cargo nextest run --locked -p test-cabinet-gg --lib --partition hash:2/4 [cwd=$repo]" "$(cat "$tmp/cargo.log")"
check_contains "and names it in the log" "(partition hash:2/4)" "$out"

out="$(run "$repo" gg-test.sh 12/16)"
check_equal "a two-digit partition passes" "0" "$?"
check_contains "and is passed on" "--partition hash:12/16" "$(cat "$tmp/cargo.log")"

out="$(STUB_CARGO_EXIT_1=100 run "$repo" gg-test.sh 1/4)"
check_equal "a failing run fails the step with its status" "100" "$?"

for partition in 0/4 2 2/ /4 a/4 2/4/1 "2/4 " count:2/4; do
	out="$(run "$repo" gg-test.sh "$partition")"
	check_equal "'$partition' is a usage error" "1" "$?"
	check_equal "and runs nothing ('$partition')" "" "$(cat "$tmp/cargo.log")"
done
check_contains "the usage says how to call it" "usage: scripts/ci/gg-test.sh [k/N]" "$out"

out="$(run "$repo" gg-test.sh 1/4 2/4)"
check_equal "two partitions are a usage error" "1" "$?"

echo
echo "gg-test.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
