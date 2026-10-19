#!/usr/bin/env bash
# Table test for cargo-lock.sh. Run it directly: scripts/gg-cargo-lock.test.sh
#
# `cargo_locked_args` against throwaway trees with and without a patch table, and
# `cargo_keeping_lock_order` against a command that reorders a lock, one that changes it,
# and one that fails.
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPTS_DIR
# shellcheck source=scripts/gg-cargo-lock.sh
source "$SCRIPTS_DIR/gg-cargo-lock.sh"
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

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export CARGO_HOME="$tmp/cargo-home"
mkdir -p "$CARGO_HOME"

mkdir -p "$tmp/plain/app"
check_equal "no patch table: --locked" "--locked" "$(cargo_locked_args "$tmp/plain/app")"

mkdir -p "$tmp/super/.cargo" "$tmp/super/packages/guest"
printf '#   [patch."https://example"]\n' >"$tmp/super/.cargo/config.toml"
check_equal "a commented table: --locked" "--locked" "$(cargo_locked_args "$tmp/super/packages/guest")"
printf '[patch."https://github.com/TheClockwyrks/engines"]\nx = { path = "x" }\n' >"$tmp/super/.cargo/config.toml"
check_equal "a table above the workspace: nothing" "" "$(cargo_locked_args "$tmp/super/packages/guest")"
check_equal "a table in the workspace itself: nothing" "" "$(cargo_locked_args "$tmp/super")"
check_equal "a workspace not there yet is judged from its parent" "" \
	"$(cargo_locked_args "$tmp/super/packages/absent/guest")"
check_equal "and outside any table that is --locked" "--locked" "$(cargo_locked_args "$tmp/plain/absent")"

printf '[patch.crates-io]\nx = { path = "x" }\n' >"$CARGO_HOME/config.toml"
check_equal "a table in CARGO_HOME: nothing" "" "$(cargo_locked_args "$tmp/plain/app")"
rm "$CARGO_HOME/config.toml"

lock="$tmp/Cargo.lock"
first='version = 4

[[patch.unused]]
name = "api-codegen"

[[patch.unused]]
name = "foray-cli"'
second='version = 4

[[patch.unused]]
name = "foray-cli"

[[patch.unused]]
name = "api-codegen"'
printf '%s\n' "$first" >"$lock"
touch -d '2001-01-01 00:00:00' "$lock"
before="$(stat -c %Y "$lock")"

cargo_keeping_lock_order "$lock" sh -c "printf '%s\n' '$second' >'$lock'"
check_equal "a reordering command passes" "0" "$?"
check_equal "the reordered lock is put back" "$first" "$(cat "$lock")"
check_equal "with its modification time" "$before" "$(stat -c %Y "$lock")"

cargo_keeping_lock_order "$lock" sh -c "printf '%s\n' '$second' >'$lock'; exit 101"
check_equal "a failing command keeps its status" "101" "$?"
check_equal "and a lock it reordered is still put back" "$first" "$(cat "$lock")"

changed='version = 4

[[patch.unused]]
name = "api-codegen"'
cargo_keeping_lock_order "$lock" sh -c "printf '%s\n' '$changed' >'$lock'"
check_equal "a lock whose resolution changed keeps the change" "$changed" "$(cat "$lock")"

cargo_keeping_lock_order "$tmp/absent.lock" true
check_equal "an absent lock runs the command alone" "0" "$?"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
