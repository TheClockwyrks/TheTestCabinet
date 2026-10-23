#!/usr/bin/env bash
# Table test for rust-build.sh. Run it directly: scripts/ci/rust-build.test.sh
#
# A copy of the script runs in a throwaway repository with `cargo` stubbed first
# on PATH, recording its arguments and failing whichever call the case says. The
# subject is the link build, and that --seed runs the three template gates'
# commands each whether or not the one before it passed, and fails when any did,
# and that neither leaves Cargo.lock other than it found it: the stub rewrites the
# lock as STUB_CARGO_LOCK says (`reorder` its lines, or `change` one), and a lock
# only reordered is put back while one changed fails the step.
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
	cp "$CI_DIR/cargo-lock.sh" "$repo/scripts/ci/"
	cat >"$repo/bin/cargo" <<'STUB'
#!/usr/bin/env bash
echo "cargo $* [cwd=$PWD]" >>"$STUB_LOG"
n="$(grep -c . "$STUB_LOG")"
case "${STUB_CARGO_LOCK:-}" in
	reorder) tac Cargo.lock >Cargo.lock.new && mv Cargo.lock.new Cargo.lock ;;
	change) sed -i 's/^version = "1.0.0"$/version = "1.0.1"/' Cargo.lock ;;
esac
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
	(cd "$tmp" && STUB_LOG="$tmp/cargo.log" CARGO_HOME="$tmp/cargo-home" PATH="$repo/bin:$PATH" "$repo/scripts/ci/$script" "$@" 2>&1)
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

# Under a patch table cargo writes the lock's unused patches in no stable order, so the
# build runs without `--locked` (scripts/ci/cargo-lock.sh).
mkdir -p "$repo/.cargo"
printf '[patch."https://github.com/TheClockwyrks/engines"]\nx = { path = "x" }\n' >"$repo/.cargo/config.toml"
out="$(run "$repo" rust-build.sh)"
check_equal "under a patch table it builds without --locked" \
	"cargo build --workspace --all-targets [cwd=$repo]" "$(cat "$tmp/cargo.log")"
rm -r "$repo/.cargo"

# The lock is a key of the build-output cache, hashed at the restore and again at the save, so
# the step leaves it exactly as committed.
write_lock() { # repo
	cat >"$1/Cargo.lock" <<'LOCK'
version = 4

[[package]]
name = "a"
version = "1.0.0"

[[package]]
name = "b"
version = "2.0.0"
LOCK
	touch -d '2001-02-03 04:05:06' "$1/Cargo.lock"
	cp -p "$1/Cargo.lock" "$tmp/committed.lock"
}
lock_mtime() { stat -c %Y "$1"; }
write_lock "$repo"
want_mtime="$(lock_mtime "$repo/Cargo.lock")"

out="$(STUB_CARGO_LOCK=reorder run "$repo" rust-build.sh)"
check_equal "a build that only reorders the lock passes" "0" "$?"
if cmp -s "$repo/Cargo.lock" "$tmp/committed.lock"; then
	ok "and leaves the lock's bytes as committed"
else
	bad "and leaves the lock's bytes as committed" "got: $(cat "$repo/Cargo.lock")"
fi
check_equal "and its modification time" "$want_mtime" "$(lock_mtime "$repo/Cargo.lock")"

out="$(STUB_CARGO_LOCK=reorder run "$repo" rust-build.sh --seed)"
check_equal "a seed that only reorders the lock passes" "0" "$?"
if cmp -s "$repo/Cargo.lock" "$tmp/committed.lock"; then
	ok "and leaves the lock as committed"
else
	bad "and leaves the lock as committed" "got: $(cat "$repo/Cargo.lock")"
fi

out="$(STUB_CARGO_LOCK=change run "$repo" rust-build.sh)"
check_equal "a build that changes a line of the lock fails" "1" "$?"
check_contains "and says the lock changed in more than order" \
	"cargo changed Cargo.lock in more than the order of its lines" "$out"
check_contains "and names the dependency-graph gate" "dependency-graph" "$out"
check_contains "and shows the committed line" '-version = "1.0.0"' "$out"
check_contains "and the line cargo wrote" '+version = "1.0.1"' "$out"
check_lacks "but not the lines that did not change" 'name = "b"' "$out"

write_lock "$repo"
out="$(STUB_CARGO_LOCK=change STUB_CARGO_EXIT_1=101 run "$repo" rust-build.sh)"
check_equal "a failed build that also changed the lock keeps cargo's status" "101" "$?"
check_contains "and still reports the lock" "dependency-graph" "$out"

write_lock "$repo"
out="$(STUB_CARGO_LOCK=change run "$repo" rust-build.sh --seed)"
check_equal "a seed that changes the lock fails" "1" "$?"
check_equal "after running all three" "${SEED//REPO/$repo}" "$(cat "$tmp/cargo.log")"
check_contains "and names the dependency-graph gate" "dependency-graph" "$out"

write_lock "$repo"
out="$(run "$repo" rust-build.sh)"
check_equal "a build that leaves the lock alone passes" "0" "$?"
check_lacks "and says nothing of it" "Cargo.lock" "$out"

echo
echo "rust-build.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
