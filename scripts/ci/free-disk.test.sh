#!/usr/bin/env bash
# Table test for free-disk.sh. Run it directly: ./free-disk.test.sh
#
# No case removes anything. Stub `sudo`, `df` and `docker` first on PATH record
# what they were asked for and answer with the status the case sets, so the
# subject is what the script removes and that a removal which fails cannot fail
# the job.
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

stubs="$tmp/bin"
mkdir -p "$stubs"
for name in sudo df docker; do
	cat >"$stubs/$name" <<STUB
#!/usr/bin/env bash
printf '$name: %s\n' "\$*" >>"\$STUB_LOG"
exit "\${${name^^}_STATUS:-0}"
STUB
	chmod +x "$stubs/$name"
done
export STUB_LOG="$tmp/stub.log"

run() { # env-assignment...
	(
		cd / || exit 1
		env PATH="$stubs:$PATH" "$@" "$CI_DIR/free-disk.sh" 2>&1
	)
}

echo "--- every removal succeeds ---"

: >"$STUB_LOG"
out="$(run)"
status=$?
check_equal "exits 0" 0 "$status"
log="$(cat "$STUB_LOG")"
check_contains "removes the SDKs through sudo" "sudo: rm -rf " "$log"
for path in /usr/share/dotnet /opt/ghc /usr/local/.ghcup \
	/opt/hostedtoolcache/CodeQL /usr/local/share/powershell; do
	check_contains "removes $path" " $path" "$(sed -n 's/^sudo: //p' "$STUB_LOG")"
done
check_contains "removes the preloaded images" "docker: image prune --all --force" "$log"
check_equal "reports the disk before and after" 2 "$(grep -c '^df: -h /$' "$STUB_LOG")"
check_contains "labels the reading before" "Disk before:" "$out"
check_contains "labels the reading after" "Disk after:" "$out"

echo "--- a removal fails ---"

: >"$STUB_LOG"
out="$(run SUDO_STATUS=1)"
status=$?
check_equal "exits 0 when the SDK removal fails" 0 "$status"
check_contains "still prunes the images" "docker: image prune" "$(cat "$STUB_LOG")"
check_contains "still reports the disk after" "Disk after:" "$out"

: >"$STUB_LOG"
out="$(run DOCKER_STATUS=1)"
status=$?
check_equal "exits 0 when the image prune fails" 0 "$status"

: >"$STUB_LOG"
out="$(run SUDO_STATUS=1 DOCKER_STATUS=1 DF_STATUS=1)"
status=$?
check_equal "exits 0 when everything fails" 0 "$status"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
