#!/usr/bin/env bash
# Table test for npm-feed.sh. Run it directly: ./npm-feed.test.sh
#
# The script runs with a PATH holding nothing but stubs: `npm` answers where
# the user configuration lives, and every other command it may call is a
# wrapper that records its arguments before running the real one. So the log
# holds every argument any command was handed, which is what shows the token
# reached none of them, and a command the script calls without a wrapper
# here fails the case.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$CI_DIR/npm-feed.sh"
REGISTRY="https://pkgs.example.invalid/org/project/_packaging/feed/npm/registry/"
KEY="//pkgs.example.invalid/org/project/_packaging/feed/npm/registry/:_authToken="
TOKEN="tok-5ecret-123"
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
		bad "$1" "expected no: $2" "got: $3"
	else
		ok "$1"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

stubs="$tmp/bin"
mkdir -p "$stubs"
cat >"$stubs/npm" <<'STUB'
#!/bin/sh
printf 'npm %s\n' "$*" >>"$STUB_LOG"
if [ "$*" = "config get userconfig" ]; then
	printf '%s\n' "$STUB_USERCONFIG"
	exit 0
fi
echo "npm stub: unexpected arguments: $*" >&2
exit 2
STUB
for tool in awk dirname mkdir mktemp mv rm; do
	real="$(command -v "$tool")"
	# shellcheck disable=SC2016 # the stub body is written verbatim; nothing expands here
	printf '#!/bin/sh\nprintf "%%s %%s\\n" %s "$*" >>"$STUB_LOG"\nexec %s "$@"\n' \
		"$tool" "$real" >"$stubs/$tool"
done
chmod +x "$stubs"/*
export STUB_LOG="$tmp/stub.log"

run() { # env-assignment... -- argument...
	local assignments=()
	while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
		assignments+=("$1")
		shift
	done
	shift
	(
		cd "$tmp" || exit 1
		env -i PATH="$stubs" HOME="$tmp/home" STUB_LOG="$STUB_LOG" \
			"${assignments[@]}" "$BASH" "$SCRIPT" "$@" 2>&1
	)
}

echo "--- the credential is written for the feed's registry from the token ---"

config="$tmp/home/.npmrc"
: >"$STUB_LOG"
out="$(run STUB_USERCONFIG="$config" SYSTEM_ACCESSTOKEN="$TOKEN" -- "$REGISTRY")"
status=$?
check_equal "exits 0" 0 "$status"
check_equal "writes the one credential line" "${KEY}${TOKEN}" "$(cat "$config" 2>/dev/null)"
check_equal "keeps the file to its owner" 600 "$(stat -c %a "$config" 2>/dev/null)"
check_contains "says which registry" "npm authenticates to $REGISTRY" "$out"
check_contains "asks npm where the user configuration is" "npm config get userconfig" "$(cat "$STUB_LOG")"
check_lacks "hands the token to no command" "$TOKEN" "$(cat "$STUB_LOG")"
check_lacks "prints no token" "$TOKEN" "$out"
check_equal "leaves no temporary file" ".npmrc" "$(ls -A "$tmp/home")"

echo "--- a registry without its final slash is keyed the same ---"

: >"$STUB_LOG"
out="$(run STUB_USERCONFIG="$config" SYSTEM_ACCESSTOKEN="$TOKEN" -- "${REGISTRY%/}")"
check_equal "exits 0" 0 "$?"
check_equal "replaces the earlier line rather than repeating it" "${KEY}${TOKEN}" "$(cat "$config")"

echo "--- the rest of an existing configuration is kept ---"

printf 'fund=false\n%sold-token\n//registry.npmjs.org/:_authToken=other\n' "$KEY" >"$config"
: >"$STUB_LOG"
out="$(run STUB_USERCONFIG="$config" SYSTEM_ACCESSTOKEN="$TOKEN" -- "$REGISTRY")"
check_equal "exits 0" 0 "$?"
check_equal "replaces the feed's line and keeps every other" \
	"$(printf 'fund=false\n//registry.npmjs.org/:_authToken=other\n%s%s' "$KEY" "$TOKEN")" "$(cat "$config")"
check_lacks "hands the token to no command" "$TOKEN" "$(cat "$STUB_LOG")"

echo "--- a configuration file npm names elsewhere is the one written ---"

elsewhere="$tmp/other/place/npmrc"
: >"$STUB_LOG"
out="$(run STUB_USERCONFIG="$elsewhere" SYSTEM_ACCESSTOKEN="$TOKEN" -- "$REGISTRY")"
check_equal "exits 0" 0 "$?"
check_equal "writes where npm reads" "${KEY}${TOKEN}" "$(cat "$elsewhere" 2>/dev/null)"

echo "--- the failures ---"

cases=(
	# label | environment (space-separated) | argument | expected message
	"a missing token|STUB_USERCONFIG=$tmp/fail/.npmrc|$REGISTRY|SYSTEM_ACCESSTOKEN must carry the access token of the job"
	"an empty token|STUB_USERCONFIG=$tmp/fail/.npmrc SYSTEM_ACCESSTOKEN=|$REGISTRY|SYSTEM_ACCESSTOKEN must carry the access token of the job"
	"a missing registry|STUB_USERCONFIG=$tmp/fail/.npmrc SYSTEM_ACCESSTOKEN=$TOKEN||the url of the npm registry of the feed is the first argument"
	"a registry over http|STUB_USERCONFIG=$tmp/fail/.npmrc SYSTEM_ACCESSTOKEN=$TOKEN|http://pkgs.example.invalid/npm/registry/|the registry must be an https url"
	"a token holding a space|STUB_USERCONFIG=$tmp/fail/.npmrc SYSTEM_ACCESSTOKEN=a_b|$REGISTRY|SYSTEM_ACCESSTOKEN holds whitespace"
	"npm naming no configuration|STUB_USERCONFIG= SYSTEM_ACCESSTOKEN=$TOKEN|$REGISTRY|npm names no user configuration file"
)
for row in "${cases[@]}"; do
	IFS='|' read -r label environment argument message <<<"$row"
	read -r -a assignments <<<"$environment"
	# A space cannot be spelled inside the table's space-separated field.
	for i in "${!assignments[@]}"; do
		[ "${assignments[$i]}" = "SYSTEM_ACCESSTOKEN=a_b" ] && assignments[i]="SYSTEM_ACCESSTOKEN=a b"
	done
	: >"$STUB_LOG"
	if [ -n "$argument" ]; then
		out="$(run "${assignments[@]}" -- "$argument")"
	else
		out="$(run "${assignments[@]}" --)"
	fi
	status=$?
	check_equal "$label: exits 1" 1 "$status"
	check_contains "$label: says why" "$message" "$out"
	check_equal "$label: writes no configuration" "" "$(ls -A "$tmp/fail" 2>/dev/null)"
done

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
