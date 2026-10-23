#!/usr/bin/env bash
# Table test for install-nextest.sh. Run it directly:
# scripts/ci/install-nextest.test.sh
#
# The script runs with `uname`, `curl` and `cargo` stubbed first on PATH and
# CARGO_HOME in a temporary directory. The curl stub serves a tarball holding a
# stand-in cargo-nextest and records the URL; nothing is downloaded. The subject
# is the platform slug per machine, where the binary lands, and that a matching
# install already on PATH is left alone.
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

# The pin, read out of the script so a bump needs no edit here.
# shellcheck disable=SC2016 # the pattern matches a literal ${...}
VERSION="$(sed -n 's/^NEXTEST_VERSION="${NEXTEST_VERSION:-\(.*\)}"$/\1/p' "$CI_DIR/install-nextest.sh")"
readonly VERSION
[ -n "$VERSION" ] || { echo "could not read NEXTEST_VERSION out of install-nextest.sh" >&2; exit 1; }
mkdir -p "$tmp/bin" "$tmp/payload"
printf '#!/bin/sh\necho "cargo-nextest %s"\n' "$VERSION" >"$tmp/payload/cargo-nextest"
chmod +x "$tmp/payload/cargo-nextest"
tar -C "$tmp/payload" -czf "$tmp/nextest.tar.gz" cargo-nextest
cat >"$tmp/bin/uname" <<'STUB'
#!/usr/bin/env bash
case "$1" in
	-s) echo "${STUB_UNAME_S:-Linux}" ;;
	-m) echo "${STUB_UNAME_M:-x86_64}" ;;
esac
STUB
cat >"$tmp/bin/curl" <<STUB
#!/usr/bin/env bash
echo "curl \$*" >>"\$STUB_LOG"
cat "$tmp/nextest.tar.gz"
STUB
# cargo answers `nextest --version` through whichever cargo-nextest is first on PATH.
cat >"$tmp/bin/cargo" <<'STUB'
#!/usr/bin/env bash
[[ "$1" == nextest ]] || exit 1
shift
exec cargo-nextest "$@"
STUB
chmod +x "$tmp/bin/uname" "$tmp/bin/curl" "$tmp/bin/cargo"

run() { # cargo-home [extra PATH dir]
	: >"$tmp/curl.log"
	(STUB_LOG="$tmp/curl.log" CARGO_HOME="$1" PATH="${2:+$2:}$1/bin:$tmp/bin:/usr/bin:/bin" \
		env -u NEXTEST_VERSION bash "$CI_DIR/install-nextest.sh" 2>&1)
}

out="$(run "$tmp/linux-home")"
check_equal "a fresh Linux x86_64 install succeeds" "0" "$?"
check_equal "fetches the pinned linux tarball" \
	"curl -LsSf https://get.nexte.st/$VERSION/linux" "$(cat "$tmp/curl.log")"
check_exists "into CARGO_HOME/bin" "$tmp/linux-home/bin/cargo-nextest"
check_contains "and reports the installed version" "cargo-nextest $VERSION" "$out"

out="$(STUB_UNAME_M=aarch64 run "$tmp/arm-home")"
check_equal "a Linux aarch64 install succeeds" "0" "$?"
check_contains "with the linux-arm slug" "get.nexte.st/$VERSION/linux-arm" "$(cat "$tmp/curl.log")"

out="$(STUB_UNAME_S=Darwin STUB_UNAME_M=arm64 run "$tmp/mac-home")"
check_equal "a macOS install succeeds" "0" "$?"
check_contains "with the mac slug" "get.nexte.st/$VERSION/mac" "$(cat "$tmp/curl.log")"

out="$(run "$tmp/linux-home")"
check_equal "a second run succeeds" "0" "$?"
check_contains "and leaves the matching install alone" "cargo-nextest $VERSION already installed" "$out"
check_equal "without downloading" "" "$(cat "$tmp/curl.log")"

mkdir -p "$tmp/old/bin"
printf '#!/bin/sh\necho "cargo-nextest 0.9.1"\n' >"$tmp/old/bin/cargo-nextest"
chmod +x "$tmp/old/bin/cargo-nextest"
out="$(run "$tmp/upgrade-home" "$tmp/old/bin")"
check_contains "another version on PATH is not accepted" "Installing cargo-nextest $VERSION" "$out"
check_exists "and the pinned one is installed" "$tmp/upgrade-home/bin/cargo-nextest"

out="$(STUB_UNAME_S=Plan9 run "$tmp/plan9-home")"
check_equal "an unknown platform fails" "1" "$?"
check_contains "naming it" "unsupported platform Plan9" "$out"
check_equal "without downloading" "" "$(cat "$tmp/curl.log")"

echo
echo "install-nextest.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
