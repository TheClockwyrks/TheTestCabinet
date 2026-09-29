#!/usr/bin/env bash
# Table test for rust-build.sh. Run it directly: scripts/ci/rust-build.test.sh
#
# A copy of the script runs in a throwaway repository with `cargo` stubbed first
# on PATH, recording its arguments and failing whichever call the case says. The
# subject is the link build, and that --seed runs the three template gates'
# commands each whether or not the one before it passed, and fails when any did.
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

readonly SEED="cargo clippy --locked --workspace --all-targets -- -D warnings [cwd=REPO]
cargo doc --locked --workspace --no-deps [cwd=REPO]
cargo nextest list --locked --workspace [cwd=REPO]"

repo="$(fresh_repo rust-build.sh)"
out="$(run "$repo" rust-build.sh)"
check_equal "the build passes" "0" "$?"
check_equal "links every target of the workspace" \
	"cargo build --locked --workspace --all-targets [cwd=$repo]" "$(cat "$tmp/cargo.log")"

out="$(STUB_CARGO_EXIT_1=101 run "$repo" rust-build.sh)"
check_equal "a failed build fails the step with its status" "101" "$?"

out="$(run "$repo" rust-build.sh --seed)"
check_equal "a clean seed passes" "0" "$?"
check_equal "runs clippy, rustdoc and the test build, as the gates do" \
	"${SEED//REPO/$repo}" "$(cat "$tmp/cargo.log")"

for n in 1 2 3; do
	export "STUB_CARGO_EXIT_$n=101"
	out="$(run "$repo" rust-build.sh --seed)"
	status=$?
	unset "STUB_CARGO_EXIT_$n"
	check_equal "a seed whose step $n fails, fails" "1" "$status"
	check_equal "and still runs all three (step $n failing)" "${SEED//REPO/$repo}" "$(cat "$tmp/cargo.log")"
done

out="$(run "$repo" rust-build.sh --everything)"
check_equal "an unknown flag is a usage error" "2" "$?"
check_contains "which says how to call it" "usage: scripts/ci/rust-build.sh [--seed]" "$out"
check_equal "and runs nothing" "" "$(cat "$tmp/cargo.log")"

echo
echo "rust-build.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
