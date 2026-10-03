#!/usr/bin/env bash
# Hermetic test for .devcontainer/tools/cargo-target.sh. Run it directly:
# ./scripts/devcontainer-cargo-target.test.sh
#
# Each case builds a throwaway checkout holding a copy of the script at the
# path the checkout runs it from, a throwaway HOME and a throwaway link root,
# and stands in for the checkout's filesystem with TCAB_DEVCONTAINER_TEST_FSTYPE.
# Nothing reaches the real /cargo-target or the developer's ~/.cargo.
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBJECT="$SCRIPTS_DIR/../.devcontainer/tools/cargo-target.sh"
pass=0
fail=0

ok() {
	pass=$((pass + 1))
	printf '  ok   %s\n' "$1"
}
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}
check_contains() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		ok "$1"
	else
		bad "$1" "expected output containing: $2" "got: ${3:-<empty>}"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# A checkout, a HOME and a link root of their own.
fresh() { # name
	CASE="$tmp/$1"
	mkdir -p "$CASE/ws/.devcontainer/tools" "$CASE/home" "$CASE/links"
	cp "$SUBJECT" "$CASE/ws/.devcontainer/tools/cargo-target.sh"
}

# Run the subject from the case's checkout, as post-create.sh would, on a
# native filesystem unless the case says otherwise. Extra `VAR=value`
# arguments come first.
run_placement() { # [VAR=value...]
	(cd "$CASE/ws" && env -u CARGO_TARGET_DIR -u CARGO_HOME -u TCAB_CARGO_TARGET_RELOCATE \
		HOME="$CASE/home" TCAB_DEVCONTAINER_TEST_FSTYPE=xfs \
		TCAB_CARGO_TARGET_LINK_ROOT="$CASE/links" \
		"$@" bash .devcontainer/tools/cargo-target.sh 2>&1)
}

echo "=== a native filesystem ==="
fresh native
out="$(run_placement)"
status=$?
if [ "$status" -eq 0 ]; then ok "exits 0"; else bad "exits 0" "status $status: $out"; fi
check_contains "it says where cargo builds" "cargo builds into $CASE/ws/target (the checkout is on xfs)" "$out"
if [ "$(readlink "$CASE/links/the-test-cabinet")" = "$CASE/ws/target" ]; then
	ok "the link points at the checkout's target/"
else
	bad "the link points at the checkout's target/" "$(readlink "$CASE/links/the-test-cabinet")"
fi
if [ ! -e "$CASE/home/.cargo/config.toml" ] && [ ! -e "$CASE/home/.bashrc" ]; then
	ok "nothing is written under HOME"
else
	bad "nothing is written under HOME" "$(ls -A "$CASE/home")"
fi

fresh link-dir
mkdir -p "$CASE/links/the-test-cabinet"
out="$(run_placement)"
if [ -d "$CASE/links/the-test-cabinet" ] && [ ! -L "$CASE/links/the-test-cabinet" ]; then
	ok "a real directory at the link's path is left alone"
else
	bad "a real directory at the link's path is left alone"
fi
check_contains "a real directory is reported" "is a real directory, not a link; left untouched" "$out"

# Root writes through any mode, so this case has nothing to say when the
# suite runs as root.
if [ "$(id -u)" -ne 0 ]; then
	fresh link-unwritable
	chmod 0555 "$CASE/links"
	out="$(run_placement)"
	status=$?
	chmod 0755 "$CASE/links"
	if [ "$status" -eq 0 ]; then ok "an unwritable link root still exits 0"; else bad "an unwritable link root still exits 0" "status $status"; fi
	check_contains "an unwritable link root prints the manual command" \
		"sudo mkdir -p $CASE/links && sudo ln -sfn \"$CASE/ws/target\" $CASE/links/the-test-cabinet" "$out"
else
	echo "  --   running as root; the unwritable link root case is not run"
fi

echo "=== relocating on virtiofs ==="
fresh virtiofs
relocated="$CASE/home/.cache/cargo-target/the-test-cabinet"
run_placement TCAB_DEVCONTAINER_TEST_FSTYPE=virtiofs >/dev/null
out="$(run_placement TCAB_DEVCONTAINER_TEST_FSTYPE=virtiofs)"
check_contains "it says why it relocates" "E0463" "$out"
config="$CASE/home/.cargo/config.toml"
if [ "$(grep -c '^target-dir = ' "$config")" = 1 ] && grep -qxF "target-dir = \"$relocated\"" "$config"; then
	ok "the cargo config block is written once over two runs"
else
	bad "the cargo config block is written once over two runs" "$(cat "$config" 2>/dev/null)"
fi
if [ "$(grep -c '^export CARGO_TARGET_DIR=' "$CASE/home/.bashrc")" = 1 ] &&
	grep -qxF "export CARGO_TARGET_DIR=\"$relocated\"" "$CASE/home/.bashrc"; then
	ok "the bashrc block is written once over two runs"
else
	bad "the bashrc block is written once over two runs" "$(cat "$CASE/home/.bashrc" 2>/dev/null)"
fi
if [ -d "$relocated" ] && [ "$(readlink "$CASE/links/the-test-cabinet")" = "$relocated" ]; then
	ok "the link points at the relocated target"
else
	bad "the link points at the relocated target" "$(readlink "$CASE/links/the-test-cabinet")"
fi

fresh fuse
out="$(run_placement TCAB_DEVCONTAINER_TEST_FSTYPE=fuse.grpcfuse)"
if [ "$(readlink "$CASE/links/the-test-cabinet")" = "$CASE/home/.cache/cargo-target/the-test-cabinet" ]; then
	ok "a fuse.* filesystem relocates too"
else
	bad "a fuse.* filesystem relocates too" "$(readlink "$CASE/links/the-test-cabinet")"
fi

fresh foreign-build
mkdir -p "$CASE/home/.cargo"
printf '[build]\njobs = 4\n' >"$CASE/home/.cargo/config.toml"
out="$(run_placement TCAB_DEVCONTAINER_TEST_FSTYPE=virtiofs)"
if [ "$(cat "$CASE/home/.cargo/config.toml")" = "$(printf '[build]\njobs = 4')" ]; then
	ok "an existing [build] table is left alone"
else
	bad "an existing [build] table is left alone" "$(cat "$CASE/home/.cargo/config.toml")"
fi
check_contains "the line to add is printed" "target-dir = \"$CASE/home/.cache/cargo-target/the-test-cabinet\"" "$out"

fresh bashrc-kept
printf 'alias ll="ls -l"' >"$CASE/home/.bashrc"
run_placement TCAB_DEVCONTAINER_TEST_FSTYPE=virtiofs >/dev/null
if [ "$(head -n 1 "$CASE/home/.bashrc")" = 'alias ll="ls -l"' ] && grep -q '^export CARGO_TARGET_DIR=' "$CASE/home/.bashrc"; then
	ok "a bashrc without a final newline keeps its last line and gains the block"
else
	bad "a bashrc without a final newline keeps its last line and gains the block" "$(cat "$CASE/home/.bashrc")"
fi

echo "=== the switches ==="
fresh forbidden
out="$(run_placement TCAB_DEVCONTAINER_TEST_FSTYPE=virtiofs TCAB_CARGO_TARGET_RELOCATE=0)"
if [ ! -e "$CASE/home/.cargo/config.toml" ] && [ "$(readlink "$CASE/links/the-test-cabinet")" = "$CASE/ws/target" ]; then
	ok "TCAB_CARGO_TARGET_RELOCATE=0 keeps target/ on virtiofs"
else
	bad "TCAB_CARGO_TARGET_RELOCATE=0 keeps target/ on virtiofs"
fi

fresh forced
out="$(run_placement TCAB_CARGO_TARGET_RELOCATE=1)"
if [ -f "$CASE/home/.cargo/config.toml" ] && [ "$(readlink "$CASE/links/the-test-cabinet")" = "$CASE/home/.cache/cargo-target/the-test-cabinet" ]; then
	ok "TCAB_CARGO_TARGET_RELOCATE=1 relocates on a native filesystem"
else
	bad "TCAB_CARGO_TARGET_RELOCATE=1 relocates on a native filesystem"
fi

fresh preset
out="$(run_placement TCAB_DEVCONTAINER_TEST_FSTYPE=virtiofs CARGO_TARGET_DIR=/somewhere)"
if [ ! -e "$CASE/home/.cargo/config.toml" ] && [ ! -e "$CASE/home/.bashrc" ] && [ ! -e "$CASE/links/the-test-cabinet" ]; then
	ok "a preset CARGO_TARGET_DIR writes nothing and leaves the link alone"
else
	bad "a preset CARGO_TARGET_DIR writes nothing and leaves the link alone" "$(ls -A "$CASE/home" "$CASE/links")"
fi
check_contains "a preset CARGO_TARGET_DIR is reported" "CARGO_TARGET_DIR is already /somewhere" "$out"

fresh cargo-home
out="$(run_placement TCAB_DEVCONTAINER_TEST_FSTYPE=virtiofs CARGO_HOME="$CASE/cargo")"
if grep -qF 'target-dir = ' "$CASE/cargo/config.toml" 2>/dev/null && [ ! -e "$CASE/home/.cargo" ]; then
	ok "CARGO_HOME decides where the config block goes"
else
	bad "CARGO_HOME decides where the config block goes" "$(ls -A "$CASE" 2>/dev/null)"
fi

echo "=== devcontainer-cargo-target: $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
