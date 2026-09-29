#!/usr/bin/env bash
# Table test for report-disk.sh. Run it directly: scripts/ci/report-disk.test.sh
#
# The script runs with `df` and `docker` stubbed first on PATH. The `df` stub
# answers `--output=target` from a table of path -> mount the case declares and
# records every other call; the `docker` stub answers `info` with the store
# directory the case declares. The subject is which filesystems are read (`/`
# always, the container store and the agent work folder when they are other
# mounts, each mount once) and that nothing makes the script exit non-zero.
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

mkdir -p "$tmp/bin" "$tmp/store" "$tmp/work"
# STUB_MOUNTS holds `path=mount` pairs; a path not named is on `/`.
cat >"$tmp/bin/df" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == --output=target ]]; then
	mount=/
	for pair in ${STUB_MOUNTS:-}; do
		[[ "${pair%%=*}" == "$2" ]] && mount="${pair#*=}"
	done
	printf 'Mounted on\n%s\n' "$mount"
	exit 0
fi
echo "df $*" >>"$STUB_LOG"
exit "${STUB_DF_EXIT:-0}"
STUB
cat >"$tmp/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "$1" in
	info)
		[[ -n "${STUB_DOCKER_ROOT:-}" ]] || exit 1
		echo "$STUB_DOCKER_ROOT"
		;;
	system) echo "TYPE TOTAL" ;;
esac
STUB
chmod +x "$tmp/bin/df" "$tmp/bin/docker"

run() { # args...
	: >"$tmp/calls.log"
	env -u AGENT_WORKFOLDER STUB_LOG="$tmp/calls.log" PATH="$tmp/bin:$PATH" \
		"$CI_DIR/report-disk.sh" "$@" 2>&1
}

out="$(run "before the run images")"
check_equal "a reading succeeds" "0" "$?"
check_contains "under its label" "==> disk: before the run images" "$out"
check_equal "with no daemon and no work folder, reads / alone" "df -h /" "$(cat "$tmp/calls.log")"

out="$(run)"
check_contains "no label is a plain heading" "==> disk" "$out"

out="$(STUB_DOCKER_ROOT="$tmp/store" STUB_MOUNTS="$tmp/store=/var/lib/docker" run x)"
check_equal "reads the container store when it is another mount" \
	"df -h / $tmp/store" "$(cat "$tmp/calls.log")"
check_contains "and the daemon's own usage, indented" "    TYPE TOTAL" "$out"

out="$(STUB_DOCKER_ROOT="$tmp/store" run x)"
check_equal "reads a store on / once" "df -h /" "$(cat "$tmp/calls.log")"

: >"$tmp/calls.log"
out="$(AGENT_WORKFOLDER="$tmp/work" STUB_DOCKER_ROOT="$tmp/store" \
	STUB_MOUNTS="$tmp/store=/mnt $tmp/work=/mnt/vss" STUB_LOG="$tmp/calls.log" PATH="$tmp/bin:$PATH" \
	"$CI_DIR/report-disk.sh" x 2>&1)"
check_equal "reads the agent work folder when it is a third mount" \
	"df -h / $tmp/store $tmp/work" "$(cat "$tmp/calls.log")"

: >"$tmp/calls.log"
out="$(AGENT_WORKFOLDER="$tmp/missing" STUB_LOG="$tmp/calls.log" PATH="$tmp/bin:$PATH" \
	"$CI_DIR/report-disk.sh" x 2>&1)"
check_equal "skips a work folder that does not exist" "df -h /" "$(cat "$tmp/calls.log")"

out="$(STUB_DF_EXIT=1 run x)"
check_equal "a df that fails still exits 0" "0" "$?"

echo
echo "report-disk.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
