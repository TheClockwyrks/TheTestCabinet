#!/usr/bin/env bash
# Table test for fetch.sh, the resuming, retrying fetch the toolchain installers
# source. Run it directly: scripts/ci/fetch.test.sh
#
# Each case sources the library into a `set -euo pipefail` shell, as every
# installer does, with `curl` stubbed first on PATH. The stub answers a HEAD
# with the length the case declares, and each GET with the next step of the
# case's plan: the whole remainder, a truncated transfer, a clean but short one,
# or a refusal, always continuing from the bytes already on disk as `-C -` does.
# The subject is that the file ends up whole, which attempts resume and which
# start over, and what is kept when it gives up.
#
# The snippets are single-quoted on purpose: the shell that sourced the library
# expands them.
# shellcheck disable=SC2016
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

readonly URL="https://example.com/releases/tool.tar.gz"
mkdir -p "$tmp/bin"
head -c 1000 /dev/urandom >"$tmp/payload"

cat >"$tmp/bin/curl" <<'STUB'
#!/usr/bin/env bash
# HEAD: -I among the flags.
if [[ " $* " == *" -sSfIL "* ]]; then
	echo "HEAD" >>"$STUB_LOG"
	[[ -n "${STUB_HEAD:-}" ]] || exit 22
	printf '%b' "$STUB_HEAD"
	exit 0
fi
dest=""
while [[ $# -gt 0 ]]; do
	[[ "$1" == -o ]] && dest="$2"
	shift
done
# The next step of the plan: full | partial:N (N bytes, exit 18) | short:N (N bytes, exit 0) | exit:C
step="$(head -1 "$STUB_PLAN")"
sed -i 1d "$STUB_PLAN"
have=0
[[ -f "$dest" ]] && have="$(wc -c <"$dest")"
echo "GET from $have: $step" >>"$STUB_LOG"
case "$step" in
	full) tail -c +"$((have + 1))" "$STUB_PAYLOAD" >>"$dest" ;;
	partial:*) tail -c +"$((have + 1))" "$STUB_PAYLOAD" | head -c "${step#partial:}" >>"$dest"; exit 18 ;;
	short:*) tail -c +"$((have + 1))" "$STUB_PAYLOAD" | head -c "${step#short:}" >>"$dest" ;;
	exit:*) exit "${step#exit:}" ;;
	*) echo "curl stub: no plan left" >&2; exit 7 ;;
esac
STUB
chmod +x "$tmp/bin/curl"

readonly LENGTH='HTTP/2 200\r\ncontent-length: 1000\r\n\r\n'

# Runs gg_fetch <url> <dest> in a strict shell; plan steps are the remaining arguments.
fetch() { # dest head plan...
	local dest="$1" head="$2"
	shift 2
	printf '%s\n' "$@" >"$tmp/plan"
	: >"$tmp/curl.log"
	(STUB_LOG="$tmp/curl.log" STUB_PLAN="$tmp/plan" STUB_PAYLOAD="$tmp/payload" STUB_HEAD="$head" \
		GG_FETCH_DELAY=0 PATH="$tmp/bin:$PATH" bash -c '
		set -euo pipefail
		source "$1"
		gg_fetch "$2" "$3"
	' _ "$CI_DIR/fetch.sh" "$URL" "$dest" 2>&1)
}
same() { # label file
	if cmp -s "$tmp/payload" "$2"; then ok "$1"; else bad "$1" "$2 is not the payload"; fi
}

echo "--- a fresh fetch ---"
out="$(fetch "$tmp/a/deep/tool.tar.gz" "$LENGTH" full)"
check_equal "succeeds" "0" "$?"
same "the file is whole, in a directory it made" "$tmp/a/deep/tool.tar.gz"
check_contains "names the size it expects" "fetching tool.tar.gz (1000 bytes)" "$out"
check_equal "asks the length, then fetches once" "HEAD
GET from 0: full" "$(cat "$tmp/curl.log")"

echo "--- a file already fetched ---"
out="$(fetch "$tmp/a/deep/tool.tar.gz" "$LENGTH")"
check_equal "succeeds" "0" "$?"
check_contains "and says it has it" "have tool.tar.gz (1000 bytes, already fetched)" "$out"
check_equal "without a GET" "HEAD" "$(cat "$tmp/curl.log")"

echo "--- a truncated transfer ---"
out="$(fetch "$tmp/b.tar.gz" "$LENGTH" partial:300 partial:200 full)"
check_equal "succeeds" "0" "$?"
same "the file is whole" "$tmp/b.tar.gz"
check_equal "each attempt resumes where the last stopped" "HEAD
GET from 0: partial:300
GET from 300: partial:200
GET from 500: full" "$(cat "$tmp/curl.log")"
check_contains "and says so" "attempt 3/6, resuming at byte 500" "$out"

echo "--- a partial file left by an earlier run ---"
head -c 400 "$tmp/payload" >"$tmp/c.tar.gz"
out="$(fetch "$tmp/c.tar.gz" "$LENGTH" full)"
check_equal "succeeds" "0" "$?"
same "the file is whole" "$tmp/c.tar.gz"
check_contains "the first attempt resumes it" "fetching c.tar.gz (1000 bytes), resuming at byte 400" "$out"

echo "--- a clean exit with a short body ---"
out="$(fetch "$tmp/d.tar.gz" "$LENGTH" short:500 full)"
check_equal "succeeds" "0" "$?"
same "the file is whole" "$tmp/d.tar.gz"
check_contains "the short body is named" "short: 500 of 1000 bytes" "$out"

echo "--- a partial that cannot be resumed ---"
for code in 22 33 36; do
	head -c 400 /dev/zero >"$tmp/e$code.tar.gz"
	out="$(fetch "$tmp/e$code.tar.gz" "$LENGTH" "exit:$code" full)"
	check_equal "exit $code: succeeds" "0" "$?"
	same "exit $code: the file is the payload, not the stale bytes" "$tmp/e$code.tar.gz"
	check_contains "exit $code: starts over" "cannot resume (curl exit $code); starting over" "$out"
	check_contains "exit $code: from byte zero" "GET from 0: full" "$(cat "$tmp/curl.log")"
done

echo "--- giving up ---"
out="$(GG_FETCH_ATTEMPTS=3 fetch "$tmp/f.tar.gz" "$LENGTH" partial:100 partial:100 partial:100)"
check_equal "three failed attempts fail" "1" "$?"
check_equal "after exactly three" "3" "$(grep -c '^GET' "$tmp/curl.log")"
check_contains "naming the URL" "error: could not fetch $URL after 3 attempts." "$out"
check_contains "and the bytes kept for the next run" "300 bytes are kept at $tmp/f.tar.gz" "$out"
check_equal "which are still there" "300" "$(wc -c <"$tmp/f.tar.gz" | tr -d ' ')"

echo "--- no advertised length ---"
out="$(fetch "$tmp/g.tar.gz" "" full)"
check_equal "a refused HEAD does not fail the fetch" "0" "$?"
same "the file is whole" "$tmp/g.tar.gz"
check_contains "no size is claimed" "fetching g.tar.gz" "$out"
check_lacks "no size is claimed (bytes)" "bytes)" "$out"
out="$(fetch "$tmp/h.tar.gz" "" short:10)"
check_equal "and a body it cannot measure is accepted" "0" "$?"

echo "--- a redirect ---"
out="$(fetch "$tmp/i.tar.gz" 'HTTP/2 302\r\ncontent-length: 7\r\nlocation: x\r\n\r\nHTTP/2 200\r\nContent-Length: 1000\r\n\r\n' full)"
check_equal "succeeds" "0" "$?"
check_contains "the last hop's length counts" "(1000 bytes)" "$out"

echo "--- gg_fetch_dir ---"
dir_of() { # env...
	env -u TCAB_DOWNLOAD_CACHE -u XDG_CACHE_HOME HOME=/home/someone "$@" \
		bash -c 'source "$1"; gg_fetch_dir' _ "$CI_DIR/fetch.sh"
}
check_equal "defaults under HOME's cache" "/home/someone/.cache/tcab/downloads" "$(dir_of)"
check_equal "follows XDG_CACHE_HOME" "/xdg/tcab/downloads" "$(dir_of XDG_CACHE_HOME=/xdg)"
check_equal "and TCAB_DOWNLOAD_CACHE above both" "/pinned" "$(dir_of XDG_CACHE_HOME=/xdg TCAB_DOWNLOAD_CACHE=/pinned)"

echo
echo "fetch.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
