#!/usr/bin/env bash
# Table test for resolve-lock.sh: the lock file it writes is the standalone
# one even when a patch table above the checkout would rewrite it.
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

check_absent() { # label needle file
	if grep -qF -- "$2" "$3" 2>/dev/null; then
		bad "$1" "expected no line containing: $2" "in $3"
	else
		ok "$1"
	fi
}

if ! command -v cargo >/dev/null 2>&1; then
	printf '  skip every case (no cargo on this machine)\n'
	exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# A patch table above the checkout, of the kind the superrepo carries, naming
# a crate this workspace does not use, so cargo would record it as unused.
mkdir -p "$tmp/super/.cargo" "$tmp/super/app/src" "$tmp/super/app/scripts" "$tmp/super/other/src"
printf '[package]\nname = "other"\nversion = "0.0.0"\nedition = "2024"\n' >"$tmp/super/other/Cargo.toml"
printf '' >"$tmp/super/other/src/lib.rs"
printf '[patch."https://example.invalid/other"]\nother = { path = "other" }\n' >"$tmp/super/.cargo/config.toml"
printf '[package]\nname = "app"\nversion = "0.0.0"\nedition = "2024"\n' >"$tmp/super/app/Cargo.toml"
printf 'fn main() {}\n' >"$tmp/super/app/src/main.rs"
cp "$SCRIPTS_DIR/resolve-lock.sh" "$tmp/super/app/scripts/resolve-lock.sh"
printf 'stale\n' >"$tmp/super/app/Cargo.lock"

# --- The lock file is resolved outside the patch table ----------------------
out="$("$tmp/super/app/scripts/resolve-lock.sh" --offline 2>&1)"
status=$?
check_passed "resolve-lock succeeds" "$status" "$out"
check_absent "the lock file records no unused patch" "patch.unused" "$tmp/super/app/Cargo.lock"
check_absent "the stale lock file is replaced" "stale" "$tmp/super/app/Cargo.lock"
if grep -qF 'name = "app"' "$tmp/super/app/Cargo.lock"; then
	ok "the lock file names the package"
else
	bad "the lock file names the package" "Cargo.lock holds: $(cat "$tmp/super/app/Cargo.lock")"
fi

# --- The copy fetches through the git on PATH ------------------------------
mkdir -p "$tmp/super/app/.cargo"
printf '[net]\ngit-fetch-with-cli = true\n' >"$tmp/super/app/.cargo/config.toml"
out="$("$tmp/super/app/scripts/resolve-lock.sh" --offline 2>&1)"
status=$?
check_passed "resolve-lock succeeds with the repository's own cargo configuration" "$status" "$out"

# --- Beside the manifest, the in-place resolution would record the patch ---
(cd "$tmp/super/app" && cargo generate-lockfile --offline --quiet 2>/dev/null)
if grep -qF 'patch.unused' "$tmp/super/app/Cargo.lock"; then
	ok "cargo in place records the unused patch, which is what the script avoids"
else
	bad "cargo in place records the unused patch, which is what the script avoids" "no [[patch.unused]] in the in-place lock file"
fi

# --- A directory with no manifest is refused ------------------------------
mkdir -p "$tmp/bare/scripts"
cp "$SCRIPTS_DIR/resolve-lock.sh" "$tmp/bare/scripts/resolve-lock.sh"
out="$("$tmp/bare/scripts/resolve-lock.sh" --offline 2>&1)"
status=$?
check_failed "a directory without Cargo.toml is refused" "$status"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
