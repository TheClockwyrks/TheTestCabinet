#!/usr/bin/env bash
# Table test for install-playwright-chromium.sh. Run it directly:
# scripts/ci/install-playwright-chromium.test.sh
#
# The script runs with `npx` stubbed first on PATH. The stub records each call's
# arguments and exits with the status the case gives the install or the
# screenshot. What is held: the script installs Chromium with its system
# libraries at the pinned Playwright version (from the environment, else from
# the compose file), then starts it once; and it fails when either step fails,
# when no pin is found, or when there is no npx at all.
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

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# A checkout of its own: the script at its real path, and a compose file whose
# pin differs from the one any case passes in the environment.
checkout="$tmp/checkout"
mkdir -p "$checkout/scripts/ci" "$checkout/.devcontainer"
cp "$CI_DIR/install-playwright-chromium.sh" "$checkout/scripts/ci/"
printf 'x-devcontainer-build-args: &build-args\n  PLAYWRIGHT_VERSION: 1.2.3\n' >"$checkout/.devcontainer/docker-compose.yml"
# The same script with no compose file beside it, as the image build copies it.
bare="$tmp/bare"
mkdir -p "$bare"
cp "$CI_DIR/install-playwright-chromium.sh" "$bare/"

mkdir -p "$tmp/bin"
cat >"$tmp/bin/npx" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_LOG"
case "$*" in
*" install "*) exit "${STUB_INSTALL_EXIT:-0}" ;;
*" screenshot "*) exit "${STUB_SCREENSHOT_EXIT:-0}" ;;
esac
exit 0
STUB
chmod +x "$tmp/bin/npx"

# A PATH with the basic tools and no npx, for the case that has none.
mkdir -p "$tmp/no-npx"
for tool in bash dirname sed mktemp rm uname dpkg cat; do
	found="$(command -v "$tool")" && ln -sf "$found" "$tmp/no-npx/$tool"
done

log="$tmp/npx.log"
out="$tmp/out"

# script | PLAYWRIGHT_VERSION | install exit | screenshot exit
run() {
	: >"$log"
	env -u PLAYWRIGHT_VERSION ${2:+PLAYWRIGHT_VERSION="$2"} \
		PATH="$tmp/bin:$PATH" STUB_LOG="$log" \
		STUB_INSTALL_EXIT="$3" STUB_SCREENSHOT_EXIT="$4" \
		bash "$1" >"$out" 2>&1
	status=$?
}

run "$checkout/scripts/ci/install-playwright-chromium.sh" 9.8.7 0 0
check_equal "a pinned run exits zero" 0 "$status"
check_equal "it installs chromium with its libraries, then starts it" \
	"--yes playwright@9.8.7 install --with-deps chromium|--yes playwright@9.8.7 screenshot --browser chromium about:blank" \
	"$(sed 's| /[^ ]*/chromium.png$||' "$log" | paste -sd '|')"

run "$checkout/scripts/ci/install-playwright-chromium.sh" "" 0 0
check_equal "an unpinned run in a checkout exits zero" 0 "$status"
check_contains "it reads the compose file's pin" "playwright@1.2.3 install --with-deps chromium" "$(cat "$log")"

run "$bare/install-playwright-chromium.sh" "" 0 0
check_equal "an unpinned run with no compose file fails" 1 "$status"
check_contains "and names the missing pin" "PLAYWRIGHT_VERSION is not set" "$(cat "$out")"
check_equal "without calling npx" "" "$(cat "$log")"

run "$bare/install-playwright-chromium.sh" 9.8.7 0 0
check_equal "a pinned run with no compose file exits zero" 0 "$status"

run "$checkout/scripts/ci/install-playwright-chromium.sh" 9.8.7 3 0
check_equal "a failed install fails the script with its status" 3 "$status"
check_equal "and starts no browser" 1 "$(wc -l <"$log" | tr -d ' ')"

run "$checkout/scripts/ci/install-playwright-chromium.sh" 9.8.7 0 1
check_equal "a browser that does not start fails the script" 1 "$status"
check_contains "and says so" "chromium does not start here" "$(cat "$out")"

: >"$log"
env -u PLAYWRIGHT_VERSION PLAYWRIGHT_VERSION=9.8.7 PATH="$tmp/no-npx" \
	"$tmp/no-npx/bash" "$checkout/scripts/ci/install-playwright-chromium.sh" >"$out" 2>&1
status=$?
check_equal "a machine with no npx fails" 1 "$status"
check_contains "and names it" "no npx on PATH" "$(cat "$out")"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
