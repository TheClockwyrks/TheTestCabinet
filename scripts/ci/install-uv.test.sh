#!/usr/bin/env bash
# Table test for install-uv.sh. Run it directly: scripts/ci/install-uv.test.sh
#
# The script runs with `curl` stubbed first on PATH and HOME in a temporary
# directory. The curl stub serves an installer that writes a stand-in `uv` into
# UV_INSTALL_DIR and records the environment it ran with; nothing is
# downloaded. The subject is the pinned installer URL, the install directory,
# that no shell profile is edited, and that a matching uv on PATH is left alone.
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
VERSION="$(sed -n 's/^UV_VERSION="${UV_VERSION:-\(.*\)}"$/\1/p' "$CI_DIR/install-uv.sh")"
readonly VERSION
[ -n "$VERSION" ] || { echo "could not read UV_VERSION out of install-uv.sh" >&2; exit 1; }
mkdir -p "$tmp/bin"
cat >"$tmp/bin/curl" <<STUB
#!/usr/bin/env bash
echo "curl \$*" >>"\$STUB_LOG"
cat <<'INSTALLER'
echo "installer UV_INSTALL_DIR=\$UV_INSTALL_DIR INSTALLER_NO_MODIFY_PATH=\$INSTALLER_NO_MODIFY_PATH" >>"\$STUB_LOG"
printf '#!/bin/sh\necho "uv $VERSION"\n' >"\$UV_INSTALL_DIR/uv"
chmod +x "\$UV_INSTALL_DIR/uv"
INSTALLER
STUB
chmod +x "$tmp/bin/curl"

run() { # home [extra PATH dir]
	: >"$tmp/calls.log"
	mkdir -p "$1"
	(STUB_LOG="$tmp/calls.log" HOME="$1" PATH="${2:+$2:}$1/.local/bin:$tmp/bin:/usr/bin:/bin" \
		env -u UV_VERSION bash "$CI_DIR/install-uv.sh" 2>&1)
}

out="$(run "$tmp/home")"
check_equal "a fresh install succeeds" "0" "$?"
check_equal "runs the pinned installer into ~/.local/bin without touching a profile" \
	"curl -LsSf https://astral.sh/uv/$VERSION/install.sh
installer UV_INSTALL_DIR=$tmp/home/.local/bin INSTALLER_NO_MODIFY_PATH=1" "$(cat "$tmp/calls.log")"
check_contains "and reports the installed version" "uv $VERSION" "$out"

out="$(run "$tmp/home")"
check_equal "a second run succeeds" "0" "$?"
check_contains "and leaves the matching uv alone" "uv $VERSION already installed" "$out"
check_equal "without downloading" "" "$(cat "$tmp/calls.log")"

mkdir -p "$tmp/old/bin"
printf '#!/bin/sh\necho "uv 0.1.0"\n' >"$tmp/old/bin/uv"
chmod +x "$tmp/old/bin/uv"
out="$(run "$tmp/upgrade-home" "$tmp/old/bin")"
check_equal "another uv on PATH is replaced" "0" "$?"
check_contains "by the pinned one" "astral.sh/uv/$VERSION/install.sh" "$(cat "$tmp/calls.log")"

echo
echo "install-uv.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
