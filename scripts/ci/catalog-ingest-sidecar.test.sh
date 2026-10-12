#!/usr/bin/env bash
# Table test for the catalog ingest sidecar's script,
# deployments/k8s/components/catalog-ingest/ingest.sh. Run it directly:
# ./catalog-ingest-sidecar.test.sh
#
# No case reaches a network or a backend. The script's real git commands run
# against the two local repositories catalog-fixture.sh builds, into a throwaway
# state directory. Stubs first on PATH stand in for the rest: curl records each
# request and answers as the case declares, sleep records its argument and returns
# at once, so no case waits and `sleep infinity` ends the run, and df reports a
# fixed volume.
#
# The subject is the script's contract: it asks for an ingest only once the checkout
# and its cold storage are at the branch tip, a step that fails records its name,
# its cause and the volume's free space and sends no POST, every path ends parked
# rather than exited, and a start that follows a killed one in the same pod records
# that and does not try again.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT="${CI_DIR}/../../deployments/k8s/components/catalog-ingest/ingest.sh"
# shellcheck source=scripts/ci/catalog-fixture.sh
source "${CI_DIR}/catalog-fixture.sh"
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

if ! command -v git >/dev/null 2>&1; then
	echo "git is not installed here; skipping the catalog ingest sidecar test."
	exit 0
fi
REAL_GIT="$(command -v git)"
readonly REAL_GIT

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fixture="$tmp/fixture"
mkdir -p "$fixture"
catalog_fixture "$fixture"
readonly GOOD_TIP="$CATALOG_TIP" GOOD_PIN="$CATALOG_PIN"

# A pod: an empty state volume, a place for the result, and the stubs.
fresh_pod() {
	local pod
	pod="$(mktemp -d "$tmp/podXXXXXX")"
	mkdir -p "$pod/state" "$pod/bin" "$pod/tmp"

	# STUB_HEALTHZ and STUB_INGEST are the exit codes of the two requests. A
	# refused ingest writes the body a backend would answer with to the -o file.
	cat >"$pod/bin/curl" <<'STUB'
#!/usr/bin/env bash
out="" method=GET url=""
while [ $# -gt 0 ]; do
	case "$1" in
		-o) out="$2"; shift ;;
		-X) method="$2"; shift ;;
		http*) url="$1" ;;
	esac
	shift
done
printf '%s %s\n' "$method" "$url" >>"$STUB_CURL_LOG"
case "$url" in
	*/healthz) exit "${STUB_HEALTHZ:-0}" ;;
	*/ingest)
		if [ "${STUB_INGEST:-0}" -ne 0 ]; then
			[ -z "$out" ] || echo '{"error":"the checkout holds no test-cases folder"}' >"$out"
			echo "curl: (22) The requested URL returned error: 500" >&2
			exit 22
		fi
		[ -z "$out" ] || echo '{"ingested": 31}' >"$out"
		;;
esac
STUB
	cat >"$pod/bin/sleep" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_SLEEP_LOG"
STUB
	cat >"$pod/bin/df" <<'STUB'
#!/usr/bin/env bash
printf 'Filesystem Size Used Available Capacity Mounted on\n/dev/sdc 9.8G 9.7G 12.0M 100%% /state\n'
STUB
	chmod +x "$pod/bin/curl" "$pod/bin/sleep" "$pod/bin/df"
	printf '%s' "$pod"
}

# Runs the script as the sidecar does, under sh, and prints what it logged.
run() { # pod [env-assignment...]
	local pod="$1"
	shift
	env PATH="$pod/bin:$PATH" STUB_CURL_LOG="$pod/curl.log" STUB_SLEEP_LOG="$pod/sleep.log" \
		TCAB_INGEST_BRANCH=staging TCAB_INGEST_ENV=staging TCAB_INGEST_REPO="$CATALOG_REPO" \
		TCAB_INGEST_STATE="$pod/state" TCAB_INGEST_RESULT="$pod/tmp/ingest-result" \
		"$@" sh "$SCRIPT" 2>&1
}

result() { cat "$1/tmp/ingest-result" 2>/dev/null; }
field() { sed -n "s/^$2=//p" "$1/tmp/ingest-result" 2>/dev/null | head -n 1; }
posts() { awk '/^POST / { n++ } END { print n + 0 }' "$1/curl.log" 2>/dev/null || echo 0; }
parked() { tail -n 1 "$1/sleep.log" 2>/dev/null; }
marker() { cat "$1/state/.ingest-in-progress" 2>/dev/null; }

# What every failure has to hold: no ingest was asked for, the result says which
# step failed and how full the volume is, and the container parked.
check_failure() { # pod status step
	check_equal "the script does not exit non-zero" 0 "$2"
	check_equal "records a failure" failed "$(field "$1" status)"
	check_equal "at the step" "$3" "$(field "$1" step)"
	check_equal "asks for no ingest" 0 "$(posts "$1")"
	check_contains "reports the volume's free space" "Free space on $1/state: 12.0M free of 9.8G (100% used)." "$(result "$1")"
	check_contains "says nothing was ingested" "Nothing was ingested" "$(result "$1")"
	check_contains "names the command that ingests once it is fixed" "scripts/reingest-cluster.sh --env staging" "$(result "$1")"
	check_equal "and parks" infinity "$(parked "$1")"
}

echo "--- a cold volume ---"

pod="$(fresh_pod)"
out="$(run "$pod")"
status=$?
check_equal "the script ends parked, not failed" 0 "$status"
check_equal "the checkout is at the branch tip" "$GOOD_TIP" "$(git -C "$pod/state/checkout" rev-parse HEAD)"
check_equal "cold storage is at the commit it pins" "$GOOD_PIN" "$(git -C "$pod/state/checkout/cold-storage" rev-parse HEAD)"
check_equal "and holds its baselines" "baseline" \
	"$(cat "$pod/state/checkout/cold-storage/test-cases/demo/v1.0.0/validation-baseline/frame.json")"
check_equal "waits on /healthz, then asks for one ingest" \
	"GET http://127.0.0.1:8787/healthz
POST http://127.0.0.1:8787/ingest" "$(cat "$pod/curl.log")"
check_equal "records success" ok "$(field "$pod" status)"
check_equal "of the branch" staging "$(field "$pod" branch)"
check_equal "at the commit it ingested" "$GOOD_TIP" "$(field "$pod" commit)"
check_contains "and logs it" "ingest: ok: the backend ingested staging at $GOOD_TIP" "$out"
check_equal "and parks" infinity "$(parked "$pod")"

echo "--- a warm volume, with the branch moved on ---"

git -C "$fixture/catalog-work" commit --quiet --allow-empty -m "a later catalog"
git -C "$fixture/catalog-work" push --quiet origin HEAD:refs/heads/staging
later="$(git -C "$fixture/catalog-work" rev-parse HEAD)"
: >"$pod/curl.log"
out="$(run "$pod")"
check_equal "the checkout is refreshed to the new tip" "$later" "$(git -C "$pod/state/checkout" rev-parse HEAD)"
check_equal "records success at it" "ok $later" "$(field "$pod" status) $(field "$pod" commit)"
check_equal "after one ingest" 1 "$(posts "$pod")"

echo "--- a warm volume whose mirror cannot be reached ---"

git -C "$pod/state/checkout" remote set-url origin "file://$tmp/no-such-mirror.git"
: >"$pod/curl.log"
out="$(run "$pod")"
status=$?
check_failure "$pod" "$status" checkout
check_contains "quotes git's own error" "no-such-mirror.git" "$(result "$pod")"
check_equal "leaves the checkout where it was" "$later" "$(git -C "$pod/state/checkout" rev-parse HEAD)"
check_equal "after three tries, ten seconds apart" "10
10
infinity" "$(cat "$pod/sleep.log" | tail -n 3)"
check_contains "and logs the failure" "ingest: FAILED at step 'checkout'." "$out"

echo "--- a cold volume whose mirror cannot be reached ---"

pod="$(fresh_pod)"
out="$(run "$pod" TCAB_INGEST_REPO="file://$tmp/no-such-mirror.git")"
status=$?
check_failure "$pod" "$status" checkout
check_equal "records no commit" "" "$(field "$pod" commit)"

echo "--- a pinned cold-storage commit that cannot be fetched ---"

catalog_fixture_unpin "$fixture"
pod="$(fresh_pod)"
out="$(run "$pod")"
status=$?
check_failure "$pod" "$status" cold-storage
check_contains "says the submodule could not be fetched" \
	"The cold-storage submodule could not be fetched at the commit staging pins." "$(result "$pod")"
check_equal "records the commit it stopped at" "$CATALOG_TIP" "$(field "$pod" commit)"

echo "--- a submodule update that succeeds without checking cold storage out ---"

catalog_fixture_publish "$fixture" "$GOOD_PIN"
pod="$(fresh_pod)"
# git, but for `submodule`, which answers success and does nothing.
cat >"$pod/bin/git" <<STUB
#!/usr/bin/env bash
for argument in "\$@"; do
	[ "\$argument" != submodule ] || exit 0
done
exec "$REAL_GIT" "\$@"
STUB
chmod +x "$pod/bin/git"
out="$(run "$pod")"
status=$?
check_failure "$pod" "$status" cold-storage
check_contains "says cold storage is not checked out" \
	"The cold-storage submodule is not checked out at the commit staging pins." "$(result "$pod")"
check_contains "names the commit it should be at" "the checkout pins $GOOD_PIN" "$(result "$pod")"

echo "--- a backend that never answers /healthz ---"

pod="$(fresh_pod)"
out="$(run "$pod" STUB_HEALTHZ=7)"
status=$?
check_failure "$pod" "$status" backend
check_equal "after two hundred tries" 200 "$(grep -c '/healthz$' "$pod/curl.log")"

echo "--- a backend that refuses the ingest ---"

pod="$(fresh_pod)"
out="$(run "$pod" STUB_INGEST=22)"
status=$?
check_equal "the script does not exit non-zero" 0 "$status"
check_equal "records a failure" failed "$(field "$pod" status)"
check_equal "at the ingest" ingest "$(field "$pod" step)"
check_equal "after ten tries" 10 "$(posts "$pod")"
check_contains "quotes curl's error" "The requested URL returned error: 500" "$(result "$pod")"
check_contains "and the backend's answer" "the checkout holds no test-cases folder" "$(result "$pod")"
check_contains "reports the volume's free space" "12.0M free of 9.8G (100% used)" "$(result "$pod")"
check_equal "and parks" infinity "$(parked "$pod")"

echo "--- an attempt that was killed ---"

# A killed container records nothing: what it leaves is the marker of the step it
# was at, which the next start in the same pod finds.
pod="$(fresh_pod)"
printf 'backend-7d9f-abcde\ncold-storage\n' >"$pod/state/.ingest-in-progress"
out="$(run "$pod" TCAB_INGEST_POD=backend-7d9f-abcde)"
status=$?
check_failure "$pod" "$status" cold-storage
check_contains "says the earlier start was killed" \
	"An earlier start of this container was killed at step 'cold-storage' before it recorded a result" "$(result "$pod")"
check_contains "names the usual cause" "Running out of memory is the usual cause" "$(result "$pod")"
check_equal "fetches nothing" "" "$(ls -A "$pod/state")"
check_contains "logs the failure" "ingest: FAILED at step 'cold-storage'." "$out"

# Another pod's marker is a new pod's first start, which tries afresh.
pod="$(fresh_pod)"
printf 'backend-7d9f-abcde\ncold-storage\n' >"$pod/state/.ingest-in-progress"
out="$(run "$pod" TCAB_INGEST_POD=backend-5c44-vwxyz)"
check_equal "a new pod ingests over an earlier pod's marker" ok "$(field "$pod" status)"
check_equal "asking once" 1 "$(posts "$pod")"
check_equal "and leaves no marker behind" "" "$(marker "$pod")"

# The marker is there while a step runs: the curl stub reads it during the POST.
pod="$(fresh_pod)"
mv "$pod/bin/curl" "$pod/bin/curl-inner"
cat >"$pod/bin/curl" <<'STUB'
#!/usr/bin/env bash
case "$*" in
	*/ingest*) cp "$TCAB_INGEST_STATE/.ingest-in-progress" "$STUB_MARKER_COPY" 2>/dev/null ;;
esac
exec "$(dirname "$0")/curl-inner" "$@"
STUB
chmod +x "$pod/bin/curl"
out="$(run "$pod" TCAB_INGEST_POD=backend-7d9f-abcde STUB_MARKER_COPY="$pod/marker-copy")"
check_equal "an attempt is marked with its pod and step while it runs" "backend-7d9f-abcde
ingest" "$(cat "$pod/marker-copy" 2>/dev/null)"
check_equal "and unmarked once it recorded its result" "" "$(marker "$pod")"

pod="$(fresh_pod)"
out="$(run "$pod" TCAB_INGEST_POD=backend-7d9f-abcde STUB_INGEST=22)"
check_equal "a failure it recorded leaves no marker either" "" "$(marker "$pod")"

echo "--- no branch ---"

pod="$(fresh_pod)"
out="$(run "$pod" TCAB_INGEST_BRANCH=)"
status=$?
check_failure "$pod" "$status" config
check_equal "touches no checkout" "" "$(ls -A "$pod/state")"

echo
echo "catalog-ingest-sidecar.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
