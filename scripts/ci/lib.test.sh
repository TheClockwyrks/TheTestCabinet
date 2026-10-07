#!/usr/bin/env bash
# Table test for lib.sh. Run it directly: ./lib.test.sh
#
# The subject is what every pipeline script depends on: that sourcing lib.sh
# puts the caller in the repository root whatever the working directory was,
# and that the helpers answer the way the scripts expect. Every case runs
# against a throwaway tree holding a copy of lib.sh, so the assertions do not
# depend on the state of this repository.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}

# Compares two paths by what they physically resolve to, so a symlinked or
# relocated tree still compares equal to itself.
real() { (cd "$1" 2>/dev/null && pwd -P) || printf '<missing:%s>' "$1"; }

check_path() { # label expected-path actual-path
	if [ "$(real "$2")" = "$(real "$3")" ]; then
		ok "$1"
	else
		bad "$1" "expected $(real "$2")" "got      $(real "$3")"
	fi
}

check_status() { # label expected-status actual-status
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		bad "$1" "expected exit $2" "got      exit $3"
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
		bad "$1" "expected no occurrence of: $2" "got: ${3:-<empty>}"
	else
		ok "$1"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Writes a throwaway repository tree at $1: a copy of lib.sh, a compose file
# pinning one version, and a probe that exercises one helper per argument.
make_tree() {
	local root="$1"
	mkdir -p "$root/scripts/ci" "$root/.devcontainer"
	cp "$CI_DIR/lib.sh" "$root/scripts/ci/"
	printf 'x-devcontainer-build-args: &devcontainer-build-args\n  NODE_VERSION: 24.0.0\n' \
		>"$root/.devcontainer/docker-compose.yml"
	cat >"$root/scripts/ci/probe.sh" <<'PROBE'
#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
case "${1:-root}" in
root)
	echo "$PROJECT_ROOT"
	echo "$PWD"
	;;
build-arg)
	build_arg "$2"
	echo "the script ran on"
	;;
require-npm-install)
	require_npm_install probe-tool
	echo "the script ran on"
	;;
remediation)
	remediation "first line" "second line"
	;;
esac
PROBE
	chmod +x "$root/scripts/ci/probe.sh"
}

tree="$tmp/tree"
make_tree "$tree"
mkdir -p "$tmp/sibling" "$tree/apps/docs"
ln -s "$tree" "$tmp/link"

echo "--- the root is resolved from the script's own path ---"

out="$("$tree/scripts/ci/probe.sh")"
check_path "absolute invocation resolves the tree root" "$tree" "$(printf '%s' "$out" | sed -n 1p)"
check_path "absolute invocation leaves the caller in the root" "$tree" \
	"$(printf '%s' "$out" | sed -n 2p)"

out="$(cd "$tmp/sibling" && ../tree/scripts/ci/probe.sh)"
check_path "relative invocation from a sibling resolves the tree root" \
	"$tree" "$(printf '%s' "$out" | sed -n 1p)"

out="$("$tmp/link/scripts/ci/probe.sh")"
check_path "invocation through a symlink to the tree resolves the tree root" \
	"$tree" "$(printf '%s' "$out" | sed -n 1p)"

out="$(cd / && "$tree/scripts/ci/probe.sh")"
check_path "invocation from / resolves the tree root" "$tree" "$(printf '%s' "$out" | sed -n 1p)"

out="$(cd "$tree/apps/docs" && "$tree/scripts/ci/probe.sh")"
check_path "invocation from a nested directory resolves the tree root" \
	"$tree" "$(printf '%s' "$out" | sed -n 1p)"

echo "--- build_arg ---"

out="$(cd / && "$tree/scripts/ci/probe.sh" build-arg NODE_VERSION 2>&1)"
status=$?
check_status "exits 0 for an argument the file declares" 0 "$status"
check_contains "prints its value" "24.0.0" "$out"
check_contains "runs the script on" "the script ran on" "$out"

out="$(cd / && "$tree/scripts/ci/probe.sh" build-arg RUST_VERSION 2>&1)"
status=$?
if [ "$status" -ne 0 ]; then
	ok "exits non-zero for an argument the file does not declare"
else
	bad "exits non-zero for an argument the file does not declare" "got exit 0"
fi
check_contains "names the argument" "RUST_VERSION" "$out"
check_contains "names the file the versions are decided in" ".devcontainer/docker-compose.yml" "$out"
check_lacks "stops the script before it runs on" "the script ran on" "$out"

echo "--- require_npm_install ---"

out="$("$tree/scripts/ci/probe.sh" require-npm-install 2>&1)"
status=$?
if [ "$status" -ne 0 ]; then
	ok "exits non-zero without node_modules"
else
	bad "exits non-zero without node_modules" "got exit 0"
fi
check_contains "names the tool" "probe-tool" "$out"
check_contains "names the install command" "npm ci" "$out"
check_lacks "stops the script before it runs on" "the script ran on" "$out"

mkdir -p "$tree/node_modules/.bin"
printf '#!/bin/sh\n' >"$tree/node_modules/.bin/probe-tool"
chmod +x "$tree/node_modules/.bin/probe-tool"
out="$("$tree/scripts/ci/probe.sh" require-npm-install 2>&1)"
status=$?
check_status "exits 0 once the tool is installed" 0 "$status"
check_contains "runs the script on" "the script ran on" "$out"

echo "--- remediation ---"

out="$("$tree/scripts/ci/probe.sh" remediation 2>&1)"
check_contains "prints its first argument" "first line" "$out"
check_contains "prints its second argument" "second line" "$out"
if [ -z "$("$tree/scripts/ci/probe.sh" remediation 2>/dev/null)" ]; then
	ok "writes to stderr, not stdout"
else
	bad "writes to stderr, not stdout" "it printed to stdout"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
