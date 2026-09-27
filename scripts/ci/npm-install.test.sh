#!/usr/bin/env bash
# Table test for npm-install.sh. Run it directly: ./npm-install.test.sh
#
# The assertion the script exists for is the one worth covering: the agent's
# Node and the devcontainer's Node are one version, and a disagreement stops the
# step naming both rather than surfacing later as a gate that fails on one
# machine. A stub `node` decides the version each case reports, and a stub `npm`
# records that the install ran rather than performing one.
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

check_equal() { # label expected actual
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		bad "$1" "expected $2" "got      ${3:-<empty>}"
	fi
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

# The version the compose file pins, read the way the script reads it: through
# lib.sh's own helper, so this test and the script under test cannot disagree
# about what the anchor says.
# SC1091 is suppressed because this repository holds `lib.sh.jinja`, so the
# source above resolves in a render and not here.
# shellcheck disable=SC1091
pinned="$(
	cd "$CI_DIR/../.." && . "$CI_DIR/lib.sh" && build_arg NODE_VERSION
)"
if [ -n "$pinned" ]; then
	ok "the compose file pins NODE_VERSION, $pinned"
else
	bad "the compose file pins NODE_VERSION" "the reader printed nothing"
fi

stubs="$tmp/bin"
mkdir -p "$stubs"
cat >"$stubs/npm" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$NPM_LOG"
STUB
chmod +x "$stubs/npm"
export NPM_LOG="$tmp/npm.log"

# Runs the script with a stub node reporting $1.
run() { # reported-version
	cat >"$stubs/node" <<STUB
#!/usr/bin/env bash
echo "$1"
STUB
	chmod +x "$stubs/node"
	(cd / && PATH="$stubs:$PATH" "$CI_DIR/npm-install.sh" 2>&1)
}

echo "--- the agent's Node is not the pinned one ---"

: >"$NPM_LOG"
out="$(run "v20.11.0")"
status=$?
if [ "$status" -ne 0 ]; then
	ok "exits non-zero"
else
	bad "exits non-zero" "got exit 0"
fi
check_contains "names the version the agent reported" "v20.11.0" "$out"
check_contains "names the version the compose file pins" "v$pinned" "$out"
check_contains "names where the pin lives" ".devcontainer/docker-compose.yml" "$out"
check_equal "does not install" "" "$(cat "$NPM_LOG")"

echo "--- the agent's Node is the pinned one ---"

: >"$NPM_LOG"
out="$(run "v$pinned")"
status=$?
check_equal "exits 0" 0 "$status"
check_equal "installs from the lockfile" "ci" "$(cat "$NPM_LOG")"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
