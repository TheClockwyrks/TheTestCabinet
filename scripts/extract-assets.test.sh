#!/usr/bin/env bash
# Table test for extract-assets.sh and extract-cluster-assets.sh. Run it directly:
# ./extract-assets.test.sh
#
# Both scripts fetch a run's `archive.tar.gz` from the artifact service and unpack
# it under DEST. Each case runs a script from a throwaway copy of the scripts with a
# stub `curl` on PATH, which records its arguments and the header file it was handed
# and answers the status and body the case chose, so the subject is what a script
# asks for and what it leaves in DEST.
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() {
	fail=$((fail + 1))
	printf 'FAIL  %s\n' "$1"
	shift
	printf '        %s\n' "$@"
}

check_equal() { # label want got
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		bad "$1" "want: $2" "got:  $3"
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
		bad "$1" "expected output without: $2" "got: $3"
	else
		ok "$1"
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The archive the stub serves: `<run-id>/` with a record and a sprite, as the
# service's whole-run archive is laid out.
RUN="0b5e2c1a-run"
mkdir -p "$tmp/tree/$RUN/implementation/out"
echo '{}' >"$tmp/tree/$RUN/run-record.json"
printf 'png' >"$tmp/tree/$RUN/implementation/out/sprite.png"
tar -C "$tmp/tree" -czf "$tmp/archive.tar.gz" "$RUN"
head -c 40 "$tmp/archive.tar.gz" >"$tmp/truncated.tar.gz"

# A copy of the scripts the way they sit in the repository, plus the stub curl.
fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/lib" "$repo/bin"
	cp "$SCRIPTS_DIR/extract-assets.sh" "$SCRIPTS_DIR/extract-cluster-assets.sh" "$repo/scripts/"
	cp "$SCRIPTS_DIR/lib/env.sh" "$repo/scripts/lib/"
	cat >"$repo/bin/curl" <<'STUB'
#!/usr/bin/env bash
# Stub curl: log the arguments, copy any `-H @file` header file, write the chosen
# body to the -o file and print the chosen status for -w.
out=""
printf '%s\n' "$*" >>"$STUB_LOG"
while [ $# -gt 0 ]; do
	case "$1" in
	-o) out="$2"; shift 2 ;;
	-H)
		case "$2" in @*) cat "${2#@}" >>"$STUB_HEADERS" ;; *) printf '%s\n' "$2" >>"$STUB_HEADERS" ;; esac
		shift 2
		;;
	*) shift ;;
	esac
done
if [ -n "${STUB_BODY:-}" ]; then cp "$STUB_BODY" "$out"; else printf 'not found' >"$out"; fi
printf '%s' "${STUB_STATUS:-200}"
STUB
	chmod +x "$repo/bin/curl"
	echo "$repo"
}

run() { # repo script env... -- args...
	local repo="$1" script="$2"
	shift 2
	local envs=()
	while [ $# -gt 0 ] && [ "$1" != "--" ]; do
		envs+=("$1")
		shift
	done
	shift
	(cd / && env -u TCAB_ACCESS_CLIENT_ID -u TCAB_ACCESS_CLIENT_SECRET \
		PATH="$repo/bin:$PATH" STUB_LOG="$repo/curl.log" STUB_HEADERS="$repo/headers.log" \
		"${envs[@]}" "$repo/scripts/$script" "$@" 2>&1)
}

echo "--- local: a run's archive through ARTIFACTS_URL ---"

repo="$(fresh_repo)"
out="$(run "$repo" extract-assets.sh ARTIFACTS_URL=http://127.0.0.1:8790/ STUB_BODY="$tmp/archive.tar.gz" -- "$RUN")"
status=$?
check_equal "passes" 0 "$status"
check_contains "asks for the whole-run archive" "http://127.0.0.1:8790/runs/${RUN}/archive.tar.gz" "$(cat "$repo/curl.log")"
check_contains "sends the local identity" "Cf-Access-Authenticated-User-Email: dev@local" "$(cat "$repo/headers.log")"
check_equal "unpacks the record under DEST" "{}" "$(cat "$repo/tmp/assets/$RUN/run-record.json" 2>/dev/null)"
check_contains "lists what landed" "implementation/out/sprite.png" "$out"

echo "--- local: an unknown run ---"

repo="$(fresh_repo)"
out="$(run "$repo" extract-assets.sh ARTIFACTS_URL=http://127.0.0.1:8790 STUB_STATUS=404 -- "$RUN")"
status=$?
check_equal "fails" 1 "$status"
check_contains "says the run is not stored" "no such run in the store" "$out"

echo "--- local: a truncated archive leaves the earlier extraction ---"

repo="$(fresh_repo)"
mkdir -p "$repo/tmp/assets/$RUN"
echo earlier >"$repo/tmp/assets/$RUN/run-record.json"
out="$(run "$repo" extract-assets.sh ARTIFACTS_URL=http://127.0.0.1:8790 STUB_BODY="$tmp/truncated.tar.gz" -- "$RUN")"
status=$?
check_equal "fails" 1 "$status"
check_contains "says the archive is broken" "truncated or not a gzip tar" "$out"
check_equal "keeps the earlier tree" "earlier" "$(cat "$repo/tmp/assets/$RUN/run-record.json")"

echo "--- local: a run id that is not one ---"

repo="$(fresh_repo)"
out="$(run "$repo" extract-assets.sh ARTIFACTS_URL=http://127.0.0.1:8790 -- "../etc")"
status=$?
check_equal "refuses it" 2 "$status"
check_equal "sends nothing" "" "$(cat "$repo/curl.log" 2>/dev/null)"

echo "--- remote: staging through the edge with the service token ---"

repo="$(fresh_repo)"
out="$(run "$repo" extract-cluster-assets.sh TCAB_ACCESS_CLIENT_ID=client.access TCAB_ACCESS_CLIENT_SECRET=s3cret \
	STUB_BODY="$tmp/archive.tar.gz" -- --env staging "$RUN")"
status=$?
check_equal "passes" 0 "$status"
check_contains "asks the staging origin's /artifacts/ for the archive" \
	"https://console.staging.testcabinet.ai/artifacts/runs/${RUN}/archive.tar.gz" "$(cat "$repo/curl.log")"
check_contains "presents the client id" "CF-Access-Client-Id: client.access" "$(cat "$repo/headers.log")"
check_contains "presents the secret" "CF-Access-Client-Secret: s3cret" "$(cat "$repo/headers.log")"
check_lacks "keeps the secret off the command line" "s3cret" "$(cat "$repo/curl.log")"
check_equal "unpacks the record under DEST" "{}" "$(cat "$repo/tmp/assets/$RUN/run-record.json" 2>/dev/null)"

echo "--- remote: prod's origin ---"

repo="$(fresh_repo)"
run "$repo" extract-cluster-assets.sh TCAB_ACCESS_CLIENT_ID=id TCAB_ACCESS_CLIENT_SECRET=secret \
	STUB_BODY="$tmp/archive.tar.gz" -- --env prod "$RUN" >/dev/null
check_contains "asks the prod origin" "https://console.testcabinet.ai/artifacts/runs/${RUN}/archive.tar.gz" \
	"$(cat "$repo/curl.log")"

echo "--- remote: no service token ---"

repo="$(fresh_repo)"
out="$(run "$repo" extract-cluster-assets.sh -- --env staging "$RUN")"
status=$?
check_equal "refuses to start" 2 "$status"
check_contains "names the variables" "TCAB_ACCESS_CLIENT_ID and TCAB_ACCESS_CLIENT_SECRET" "$out"
check_equal "sends nothing" "" "$(cat "$repo/curl.log" 2>/dev/null)"

echo "--- remote: the edge refuses the token ---"

repo="$(fresh_repo)"
out="$(run "$repo" extract-cluster-assets.sh TCAB_ACCESS_CLIENT_ID=id TCAB_ACCESS_CLIENT_SECRET=secret \
	STUB_STATUS=403 -- --env staging "$RUN")"
status=$?
check_equal "fails" 1 "$status"
check_contains "says the edge refused it" "the edge refused the service token (403)" "$out"

echo "--- remote: no environment ---"

repo="$(fresh_repo)"
out="$(run "$repo" extract-cluster-assets.sh TCAB_ACCESS_CLIENT_ID=id TCAB_ACCESS_CLIENT_SECRET=secret -- "$RUN")"
status=$?
check_equal "refuses to start" 2 "$status"
check_contains "asks for --env" "--env is required" "$out"

echo
echo "extract-assets.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
