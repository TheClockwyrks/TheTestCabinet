#!/usr/bin/env bash
# Table test for git-sources.sh. Run it directly: ./git-sources.test.sh
#
# A stub `git` first on PATH records the configuration it is asked to write.
# Inside the kit the script still carries its placeholder, so the test renders
# a copy with two sources of its own; in a rendered repository the copy is
# the script as it is.
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
cat >"$stubs/git" <<'STUB'
#!/usr/bin/env bash
printf 'git: %s\n' "$*" >>"$STUB_LOG"
STUB
chmod +x "$stubs/git"
export STUB_LOG="$tmp/stub.log"

script="$tmp/git-sources.sh"
# In the kit the script is a Jinja template, named with the suffix; in a
# rendered repository it is the script itself.
source="$CI_DIR/git-sources.sh"
[ -f "$source" ] || source="$source.jinja"
# Spelled in pieces so that a render of this file leaves it a placeholder.
placeholder='{{'ci_sources'}}'
if grep -qF "$placeholder" "$source"; then
	sed "s#$placeholder#https://dev.azure.com/o/p/_git/one https://github.com/Org/One\nhttps://dev.azure.com/o/p/_git/two https://github.com/Org/Two#" \
		"$source" >"$script"
	rendered=0
else
	cp "$source" "$script"
	rendered=1
fi
chmod +x "$script"

run() { # env-assignment...
	(
		cd "$tmp" || exit 1
		env PATH="$stubs:$PATH" "$@" "$script" 2>&1
	)
}

echo "--- with the job's token every source is rewritten ---"

: >"$STUB_LOG"
out="$(run SYSTEM_ACCESSTOKEN=tok-123)"
status=$?
check_equal "exits 0" 0 "$status"
log="$(cat "$STUB_LOG")"
check_contains "sends the token to dev.azure.com" \
	"git: config --global http.https://dev.azure.com/.extraheader AUTHORIZATION: bearer tok-123" "$log"
if [ "$rendered" -eq 0 ]; then
	check_contains "rewrites the first source" \
		"git: config --global url.https://dev.azure.com/o/p/_git/one.insteadOf https://github.com/Org/One" "$log"
	check_contains "rewrites the second source" \
		"git: config --global url.https://dev.azure.com/o/p/_git/two.insteadOf https://github.com/Org/Two" "$log"
	check_contains "counts the sources" "git-sources: 2 public sources fetch from Azure" "$out"
else
	check_contains "rewrites a GitHub source to dev.azure.com" \
		".insteadOf https://github.com/" "$log"
	check_contains "counts the sources" "public sources fetch from Azure" "$out"
fi
check_equal "writes one rewrite per source and one header" \
	"$(($(grep -c '^git: config --global url\.' "$STUB_LOG") + 1))" "$(grep -c '^git: ' "$STUB_LOG")"

echo "--- without the token nothing is written ---"

: >"$STUB_LOG"
out="$(run)"
status=$?
check_equal "exits 1" 1 "$status"
check_contains "says what is missing" "SYSTEM_ACCESSTOKEN must carry the access token of the job" "$out"
check_equal "writes no configuration" "" "$(cat "$STUB_LOG")"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
