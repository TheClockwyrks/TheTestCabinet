#!/usr/bin/env bash
# Table test for npm-install.sh. Run it directly: ./npm-install.test.sh
#
# The script installs the workspace from the lockfile, from the workspace root
# whatever directory it is run in, and asserts no Node version: the Node it
# runs on is the toolchain image's wherever it runs. A stub `npm` records what
# it was asked for and where rather than performing an install, and a stub
# `node` reporting a version no image holds shows the install runs whatever
# Node answers.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$CI_DIR/../.." && pwd)"
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

stubs="$tmp/bin"
mkdir -p "$stubs"
cat >"$stubs/npm" <<'STUB'
#!/usr/bin/env bash
printf '%s %s\n' "$PWD" "$*" >>"$NPM_LOG"
exit "${NPM_STATUS:-0}"
STUB
cat >"$stubs/node" <<'STUB'
#!/usr/bin/env bash
echo "v0.0.1"
STUB
chmod +x "$stubs/npm" "$stubs/node"
export NPM_LOG="$tmp/npm.log"

run() { # npm-status
	(cd / && NPM_STATUS="$1" PATH="$stubs:$PATH" "$CI_DIR/npm-install.sh" 2>&1)
}

echo "--- the install ---"

: >"$NPM_LOG"
out="$(run 0)"
status=$?
check_equal "exits 0 whatever Node version answers" 0 "$status"
check_equal "installs from the lockfile, at the workspace root" "$REPO_ROOT ci" "$(cat "$NPM_LOG")"

echo "--- an install that fails ---"

: >"$NPM_LOG"
out="$(run 1)"
status=$?
if [ "$status" -ne 0 ]; then
	ok "exits non-zero"
else
	bad "exits non-zero" "got exit 0"
fi
check_contains "names the command that reproduces it" "npm ci" "$out"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
