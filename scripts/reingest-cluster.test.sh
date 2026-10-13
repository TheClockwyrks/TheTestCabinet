#!/usr/bin/env bash
# Table test for reingest-cluster.sh. Run it directly: ./reingest-cluster.test.sh
#
# No case reaches Azure, a cluster, a mirror or a backend. A stub az first on PATH
# keeps the script it was handed and runs it, as the cluster would, with a stub
# kubectl whose `exec ... -- sh -c <script>` runs the script here, as the ingest
# container would, with a stub git and a stub curl first on PATH. The git stub
# answers the commits the case declares and fails the fetch the case marks; the
# curl stub records the request and answers as the case declares.
#
# The subject is the script's verdict: it exits non-zero unless the ingest
# succeeded, it sends no POST from a checkout that is not at the branch tip with
# its cold storage at the pin, and a whole-catalog ingest that succeeds, and only
# that, records itself as the pod's ingest result.
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

if ! command -v jq >/dev/null 2>&1; then
	echo "jq is not installed here; skipping the reingest-cluster test."
	exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

TIP="0123456789abcdef0123456789abcdef01234567"
PIN="89abcdef0123456789abcdef0123456789abcdef"

fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/scripts/lib" "$repo/bin" "$repo/cluster/bin" \
		"$repo/pod/bin" "$repo/pod/state" "$repo/pod/tmp" "$repo/sent"
	cp "$SCRIPTS_DIR/reingest-cluster.sh" "$repo/scripts/"
	cp "$SCRIPTS_DIR/ci/lib.sh" "$repo/scripts/ci/"
	cp "$SCRIPTS_DIR/lib/env.sh" "$repo/scripts/lib/"

	# STUB_FETCH is the fetch's exit code. The checkout's HEAD is TIP, it pins
	# STUB_PIN, and its cold storage is at STUB_ACTUAL.
	cat >"$repo/pod/bin/git" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_GIT_LOG"
dir=""
[ "$1" = "-C" ] && { dir="$2"; shift 2; }
case "$1" in
	fetch)
		if [ "${STUB_FETCH:-0}" -ne 0 ]; then
			echo "fatal: write error: No space left on device" >&2
			exit "$STUB_FETCH"
		fi
		;;
	rev-parse)
		case "${*: -1}" in
			HEAD:cold-storage) echo "$STUB_PIN" ;;
			HEAD)
				case "$dir" in
					*/cold-storage) echo "$STUB_ACTUAL" ;;
					*) echo "$STUB_TIP" ;;
				esac
				;;
		esac
		;;
esac
STUB
	# STUB_INGEST is the POST's exit code.
	cat >"$repo/pod/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_CURL_LOG"
if [ "${STUB_INGEST:-0}" -ne 0 ]; then
	echo '{"error":"the checkout holds no test-cases folder"}'
	exit "$STUB_INGEST"
fi
echo '{"ingested": 31}'
STUB
	cat >"$repo/cluster/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$1 $2 $3 $4 $5 $6" >>"$STUB_KUBECTL_LOG"
[ "$1" = "-n" ] && shift 2
[ "$1" = "exec" ] || { echo "kubectl stub: $*"; exit 0; }
while [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done
shift
case "$1" in
	df) printf 'Filesystem Size Used Avail Use%% Mounted on\n/dev/sdc 9.8G 9.7G 12.0M 100%% /state\n' ;;
	*) PATH="$STUB_POD_BIN:$PATH" "$@" ;;
esac
STUB
	cat >"$repo/bin/az" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
printf '%s\n' "$*" >>"$STUB_AZ_LOG"
[ -z "${STUB_AZ_BROKEN:-}" ] || { echo "ERROR: the stub refuses" >&2; exit 1; }
if [ -n "${STUB_AZ_RUNNING:-}" ]; then
	if [ "$1 $2 $3" = "aks command result" ]; then
		printf 'command id: stub-command, started at: 2026-10-12T00:00:00Z, status: Running\n'
	else
		printf '{"exitCode": null, "id": "stub-command", "logs": null, "provisioningState": "Running"}\n'
	fi
	exit 0
fi
command=""
while [ $# -gt 0 ]; do
	case "$1" in
		--file) cp "$2" "$STUB_SENT/" ;;
		--command) command="$2" ;;
	esac
	shift
done
logs="$(cd "$STUB_SENT" && PATH="$STUB_CLUSTER_BIN:$PATH" bash -c "$command" 2>&1)"
code=$?
jq -n --arg logs "$logs" --argjson code "$code" \
	'{exitCode: $code, id: "stub", logs: $logs, provisioningState: "Succeeded"}'
STUB
	chmod +x "$repo/pod/bin/git" "$repo/pod/bin/curl" "$repo/cluster/bin/kubectl" "$repo/bin/az"
	printf '%s' "$repo"
}

run() { # repo [env-assignment...] -- [argument...]
	local repo="$1"
	shift
	local assignments=()
	while [ $# -gt 0 ] && [ "$1" != "--" ]; do
		assignments+=("$1")
		shift
	done
	shift
	(
		cd / || exit 1
		env PATH="$repo/bin:$PATH" STUB_AZ_LOG="$repo/az.log" STUB_SENT="$repo/sent" \
			STUB_CLUSTER_BIN="$repo/cluster/bin" STUB_KUBECTL_LOG="$repo/kubectl.log" \
			STUB_POD_BIN="$repo/pod/bin" STUB_GIT_LOG="$repo/git.log" STUB_CURL_LOG="$repo/curl.log" \
			STUB_TIP="$TIP" STUB_PIN="$PIN" STUB_ACTUAL="$PIN" \
			TCAB_INGEST_STATE="$repo/pod/state" TCAB_INGEST_RESULT="$repo/pod/tmp/ingest-result" \
			TCAB_INGEST_BACKEND_URL="http://backend.invalid" \
			AKS_RESULT_POLLS=2 AKS_RESULT_POLL_SECONDS=0 \
			"${assignments[@]}" "$repo/scripts/reingest-cluster.sh" "$@" 2>&1
	)
}

result() { cat "$1/pod/tmp/ingest-result" 2>/dev/null; }
posts() { awk '/-X POST/ { n++ } END { print n + 0 }' "$1/curl.log" 2>/dev/null || echo 0; }

# The result a sidecar that failed left behind.
failed_result() { # repo
	printf 'status=failed\nstep=cold-storage\nbranch=staging\ncommit=\n\nThe sidecar failed.\n' >"$1/pod/tmp/ingest-result"
}

echo "--- a whole-catalog ingest ---"

repo="$(fresh_repo)"
failed_result "$repo"
out="$(run "$repo" -- --env staging)"
status=$?
check_equal "passes" 0 "$status"
check_contains "in the staging cluster" "--resource-group testcabinet-staging-westus2-rg --name testcabinet-staging-westus2-aks" "$(sed -n 1p "$repo/az.log")"
check_contains "through the ingest container of the backend" \
	"-n tcab-staging exec deploy/the-test-cabinet-backend -c ingest" "$(cat "$repo/kubectl.log")"
check_contains "fetches the branch of the environment" "-C $repo/pod/state/checkout fetch --depth 1 origin staging" "$(cat "$repo/git.log")"
check_contains "updates cold storage" "submodule update --init --depth 1" "$(cat "$repo/git.log")"
check_equal "asks for one ingest" 1 "$(posts "$repo")"
check_contains "of the whole catalog, forced" '--data {"force": true}' "$(cat "$repo/curl.log")"
check_contains "says it is done" "Done." "$out"
check_contains "records the ingest as the pod's result" "status=ok
step=ingest
branch=staging
commit=$TIP" "$(result "$repo")"
check_lacks "over the sidecar's failure" "status=failed" "$(result "$repo")"
check_contains "naming who recorded it" "by scripts/reingest-cluster.sh" "$(result "$repo")"

repo="$(fresh_repo)"
out="$(run "$repo" -- --env prod)"
check_contains "prod fetches master" "fetch --depth 1 origin master" "$(cat "$repo/git.log")"
check_contains "in the prod cluster" "--name testcabinet-prod-westus2-aks" "$(sed -n 1p "$repo/az.log")"

echo "--- an ingest scoped to slugs ---"

repo="$(fresh_repo)"
failed_result "$repo"
out="$(run "$repo" -- --env staging carom coil)"
status=$?
check_equal "passes" 0 "$status"
check_contains "names the slugs in the request" '--data {"testCases": ["carom","coil"], "force": true}' "$(cat "$repo/curl.log")"
check_contains "and leaves the sidecar's result as it was" "status=failed" "$(result "$repo")"

echo "--- a fetch that fails ---"

repo="$(fresh_repo)"
failed_result "$repo"
out="$(run "$repo" STUB_FETCH=128 -- --env staging)"
status=$?
check_equal "fails" 1 "$status"
check_equal "asks for no ingest" 0 "$(posts "$repo")"
check_contains "prints git's error" "No space left on device" "$out"
check_contains "and the free space on the volume" "12.0M" "$out"
check_contains "says the ingest failed" "the re-ingest of every case on testcabinet-staging-westus2-aks/tcab-staging FAILED" "$out"
check_lacks "and not that it is done" "Done." "$out"
check_contains "leaves the sidecar's result as it was" "status=failed" "$(result "$repo")"

echo "--- cold storage that is not at its pin ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_ACTUAL=ffffffffffffffffffffffffffffffffffffffff -- --env staging)"
status=$?
check_equal "fails" 1 "$status"
check_equal "asks for no ingest" 0 "$(posts "$repo")"
check_contains "names both commits" \
	"cold storage is at ffffffffffffffffffffffffffffffffffffffff and the checkout pins $PIN; not ingesting" "$out"
check_equal "records no result" "" "$(result "$repo")"

echo "--- a backend that refuses the ingest ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_INGEST=22 -- --env staging)"
status=$?
check_equal "fails" 1 "$status"
check_contains "prints the backend's answer" "the checkout holds no test-cases folder" "$out"
check_equal "records no result" "" "$(result "$repo")"
check_lacks "and does not say it is done" "Done." "$out"

echo "--- a command the cluster never ran, or never finished ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_AZ_BROKEN=1 -- --env staging)"
status=$?
check_equal "an invocation az refused fails" 1 "$status"
check_contains "saying nothing was ingested" "the command could not be handed to testcabinet-staging-westus2-aks" "$out"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_AZ_RUNNING=1 -- --env staging)"
status=$?
check_equal "a command still running when the wait ran out fails" 1 "$status"
check_contains "saying it runs on" "the re-ingest was still running when the wait ran out" "$out"
check_lacks "and does not say it is done" "Done." "$out"

echo "--- refusals ---"

repo="$(fresh_repo)"
out="$(run "$repo" --)"
status=$?
check_equal "no environment fails" 2 "$status"
check_equal "and reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo
echo "reingest-cluster.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
