#!/usr/bin/env bash
# Table test for install-adapter.sh. Run it directly:
# scripts/ci/install-adapter.test.sh
#
# A copy of the script runs in a throwaway repository whose three arm version
# files pin the adapter at the versions the case declares, and whose
# scripts/gg-downloads.sh is a stub that records the version and URL it was
# asked for and writes a small file. The subject is that the three pins must
# agree before anything is fetched, and that the cpp arm's URL is the one used.
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

fresh_repo() { # cpp swift rust
	local repo arm version
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/packages/gg-sandbox-cpp" "$repo/packages/gg-sandbox-swift" \
		"$repo/packages/gg-sandbox-rust"
	cp "$CI_DIR/install-adapter.sh" "$CI_DIR/tcab-lib.sh" "$repo/scripts/ci/"
	for arm in cpp:"$1" swift:"$2" rust:"$3"; do
		version="${arm#*:}"
		arm="${arm%%:*}"
		cat >"$repo/packages/gg-sandbox-$arm/$arm-version.sh" <<EOF2
GG_WASMTIME_ADAPTER_VERSION="$version"
export GG_WASMTIME_ADAPTER_VERSION
gg_wasmtime_adapter_url() { echo "https://example.com/$arm/v\$GG_WASMTIME_ADAPTER_VERSION/adapter.wasm"; }
EOF2
	done
	cat >"$repo/scripts/gg-downloads.sh" <<'EOF2'
gg_wasmtime_adapter() {
	echo "adapter $1 $2" >>"$STUB_LOG"
	mkdir -p "$STUB_DIR"
	printf 'wasm' >"$STUB_DIR/wasi_snapshot_preview1.reactor-$1.wasm"
	echo "$STUB_DIR/wasi_snapshot_preview1.reactor-$1.wasm"
}
EOF2
	printf '%s' "$repo"
}
run() { # repo
	: >"$tmp/calls.log"
	(cd "$tmp" && STUB_LOG="$tmp/calls.log" STUB_DIR="$tmp/adapters" "$1/scripts/ci/install-adapter.sh" 2>&1)
}

repo="$(fresh_repo 36.0.1 36.0.1 36.0.1)"
out="$(run "$repo")"
check_equal "three agreeing pins install" "0" "$?"
check_equal "the one version, from the cpp arm's URL" \
	"adapter 36.0.1 https://example.com/cpp/v36.0.1/adapter.wasm" "$(cat "$tmp/calls.log")"
check_equal "and report where it is" \
	"wasi_snapshot_preview1.reactor 36.0.1 at $tmp/adapters/wasi_snapshot_preview1.reactor-36.0.1.wasm (4 bytes)" "$out"

for pins in "37.0.0 36.0.1 36.0.1" "36.0.1 37.0.0 36.0.1" "36.0.1 36.0.1 37.0.0"; do
	# shellcheck disable=SC2086 # the three pins are split on purpose
	repo="$(fresh_repo $pins)"
	out="$(run "$repo")"
	check_equal "disagreeing pins ($pins) fail" "1" "$?"
	check_contains "naming every pin ($pins)" "the cpp arm pins the wasmtime adapter at ${pins%% *}, the swift arm at" "$out"
	check_equal "and fetch nothing ($pins)" "" "$(cat "$tmp/calls.log")"
done

echo
echo "install-adapter.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
