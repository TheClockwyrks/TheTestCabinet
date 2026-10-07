#!/usr/bin/env bash
# Table test for free-disk-linux.sh. Run it directly:
# scripts/ci/free-disk-linux.test.sh
#
# A copy of the script and of report-disk.sh runs with `sudo`, `df` and `docker`
# stubbed first on PATH; the sudo stub records what it was asked to run and runs
# none of it. The subject is the set of directories reclaimed (one of them a
# mobile SDK the template's free-disk.sh leaves in place), that the disk is read
# through report-disk.sh on both sides, and that nothing (a failed removal, a
# failed image prune, an agent without passwordless sudo) ever fails the step.
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

repo="$tmp/repo"
mkdir -p "$repo/scripts/ci" "$repo/bin"
cp "$CI_DIR/free-disk-linux.sh" "$CI_DIR/tcab-lib.sh" "$CI_DIR/report-disk.sh" "$repo/scripts/ci/"
cat >"$repo/bin/sudo" <<'STUB'
#!/usr/bin/env bash
echo "sudo $*" >>"$STUB_LOG"
[[ "$1" == -n ]] && exit "${STUB_SUDO_N_EXIT:-0}"
[[ "$1" == rm ]] && exit "${STUB_RM_EXIT:-0}"
[[ "$1" == docker ]] && exit "${STUB_DOCKER_EXIT:-0}"
exit 0
STUB
# Every path is on `/`, so report-disk.sh reads the one filesystem.
cat >"$repo/bin/df" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == --output=target ]]; then
	printf 'Mounted on\n/\n'
	exit 0
fi
echo "df $*" >>"$STUB_LOG"
STUB
# No daemon: report-disk.sh then reads `/` alone.
cat >"$repo/bin/docker" <<'STUB'
#!/usr/bin/env bash
exit 1
STUB
chmod +x "$repo/bin/sudo" "$repo/bin/df" "$repo/bin/docker"

run() {
	: >"$tmp/calls.log"
	(cd "$tmp" && env -u AGENT_WORKFOLDER STUB_LOG="$tmp/calls.log" PATH="$repo/bin:$PATH" \
		"$repo/scripts/ci/free-disk-linux.sh" 2>&1)
}

out="$(run)"
check_equal "a reclaim succeeds" "0" "$?"
check_contains "and reads the disk before" "==> disk: before reclaim" "$out"
check_contains "and after" "==> disk: after reclaim" "$out"
calls="$(cat "$tmp/calls.log")"
check_equal "measures, probes sudo, removes, prunes, measures" \
	"df -h /
sudo -n true
sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /usr/local/.ghcup /opt/hostedtoolcache/CodeQL /usr/local/share/powershell /usr/local/share/chromium /usr/local/share/boost
sudo docker image prune --all --force
df -h /" "$calls"

STUB_DOCKER_EXIT=1 run >/dev/null
check_equal "a failed image prune does not fail the step" "0" "$?"
check_contains "and the disk is still measured after it" "df -h /" "$(tail -1 "$tmp/calls.log")"

STUB_RM_EXIT=1 run >/dev/null
check_equal "a removal that fails does not fail the step" "0" "$?"
check_contains "and the images are still pruned after it" "sudo docker image prune" "$(cat "$tmp/calls.log")"

out="$(STUB_SUDO_N_EXIT=1 run)"
check_equal "an agent without passwordless sudo does not fail the step" "0" "$?"
check_contains "and says what it skipped" "no usable passwordless sudo" "$out"
check_equal "and removes and prunes nothing, but still measures" \
	"df -h /
sudo -n true
df -h /" "$(cat "$tmp/calls.log")"

echo
echo "free-disk-linux.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
