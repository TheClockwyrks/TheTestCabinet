#!/usr/bin/env bash
# Table test for catalog-ingest.sh. Run it directly: ./catalog-ingest.test.sh
#
# No case reaches a network, Azure or a cluster. The preflight cases run the
# script's real git commands against the two local repositories catalog-fixture.sh
# builds. Every case puts a stub az first on PATH that keeps the script it was
# handed and runs it, as the cluster would, with a stub kubectl whose every call is
# recorded: its `exec ... cat` prints the result file the case wrote, its
# `exec ... df` answers the free space the case set, and its `exec ... git` the
# cold-storage commit the case says the volume holds.
#
# The subject is what each check refuses and says, that the preflight reads the
# state volume only once the mirror has answered and fails only on a reading that
# is too low, and that verify waits on a sidecar still working and no longer than
# its bound.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

for tool in jq git; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "$tool is not installed here; skipping the catalog-ingest test."
		exit 0
	fi
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

COMMIT="0123456789abcdef0123456789abcdef01234567"

fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/scripts/lib" "$repo/bin" "$repo/cluster/bin" "$repo/sent"
	cp "$CI_DIR/lib.sh" "$CI_DIR/catalog-ingest.sh" "$repo/scripts/ci/"
	cp "$CI_DIR/../lib/env.sh" "$repo/scripts/lib/"

	# `exec ... cat <path>` prints the case's result file, or fails when the case
	# wrote none. STUB_RESULT_AFTER makes that many reads fail first, which is a
	# sidecar that has recorded nothing yet. `exec ... df` answers STUB_FREE_KB
	# kilobytes free, or fails when the case set none; `exec ... git` answers
	# STUB_COLD_STORAGE. `get deployment` names the backend unless
	# STUB_NO_BACKEND is set.
	cat >"$repo/cluster/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_KUBECTL_LOG"
[ "$1" = "-n" ] && shift 2
case "$1" in
	get)
		[ -n "${STUB_NO_BACKEND:-}" ] || echo "deployment.apps/the-test-cabinet-backend"
		;;
	exec)
		while [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done
		case "${2:-}" in
			df)
				[ -n "${STUB_FREE_KB:-}" ] || exit 1
				echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
				echo "/dev/sdc 10255636 1 ${STUB_FREE_KB} 50% /state"
				;;
			git)
				[ -n "${STUB_COLD_STORAGE:-}" ] || exit 1
				echo "$STUB_COLD_STORAGE"
				;;
			*)
				reads="$(grep -c ' exec ' "$STUB_KUBECTL_LOG")"
				[ "$reads" -gt "${STUB_RESULT_AFTER:-0}" ] || exit 1
				cat "$STUB_RESULT" 2>/dev/null || exit 1
				;;
		esac
		;;
	logs) echo "ingest: a line of the sidecar's log" ;;
	*) echo "kubectl stub: $*" ;;
esac
STUB
	# A sleep that returns at once, so a wait runs its polls out without waiting.
	cat >"$repo/cluster/bin/sleep" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_SLEEP_LOG"
STUB
	chmod +x "$repo/cluster/bin/kubectl" "$repo/cluster/bin/sleep"

	cat >"$repo/bin/az" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
printf '%s\n' "$*" >>"$STUB_AZ_LOG"
[ -z "${STUB_AZ_BROKEN:-}" ] || { echo "ERROR: the stub refuses" >&2; exit 1; }
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
	chmod +x "$repo/bin/az"
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
		env -u THE_TEST_CABINET_RESOURCE_GROUP -u THE_TEST_CABINET_CLUSTER -u THE_TEST_CABINET_NAMESPACE \
			PATH="$repo/bin:$PATH" STUB_AZ_LOG="$repo/az.log" STUB_SENT="$repo/sent" \
			STUB_CLUSTER_BIN="$repo/cluster/bin" STUB_KUBECTL_LOG="$repo/kubectl.log" \
			STUB_SLEEP_LOG="$repo/sleep.log" STUB_RESULT="$repo/result" \
			"${assignments[@]}" "$repo/scripts/ci/catalog-ingest.sh" "$@" 2>&1
	)
}

write_result() { # repo status step [message]
	printf 'status=%s\nstep=%s\nbranch=staging\ncommit=%s\n\n%s\n' "$2" "$3" "$COMMIT" "${4:-}" >"$1/result"
}

echo "--- preflight: a catalog that can be fetched ---"

fixture="$tmp/fixture"
mkdir -p "$fixture"
catalog_fixture "$fixture"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_COLD_STORAGE="$CATALOG_PIN" \
	-- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "passes" 0 "$status"
check_contains "names the branch of the environment" "staging on $CATALOG_REPO" "$out"
check_contains "names the tip and what it pins" "The tip of staging is $CATALOG_TIP; it pins cold-storage at $CATALOG_PIN" "$out"
check_contains "resolves the submodule beside the mirror" "which file://$fixture/cold-storage holds" "$out"
check_lacks "notes nothing when the tip is the commit" "Note:" "$out"
check_contains "reports the room on the state volume" \
	"The state volume of tcab-staging has 4096 MiB free; the sidecar's fetch needs 1024 MiB." "$out"
check_equal "reads the volume in one cluster call" 1 "$(wc -l <"$repo/az.log")"
check_contains "in the staging cluster" "--resource-group testcabinet-staging-westus2-rg --name testcabinet-staging-westus2-aks" "$(cat "$repo/az.log")"
check_contains "through the ingest container of the running backend" \
	"-n tcab-staging exec deployment/the-test-cabinet-backend -c ingest -- df -Pk /state" "$(cat "$repo/kubectl.log")"
check_contains "and reads the cold-storage commit the volume holds" \
	"-- git -C /state/checkout/cold-storage rev-parse --verify --quiet HEAD" "$(cat "$repo/kubectl.log")"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=4194304 STUB_COLD_STORAGE="$CATALOG_PIN" \
	-- preflight prod "$COMMIT")"
status=$?
check_equal "prod passes on its own branch" 0 "$status"
check_contains "which is master" "The tip of master is $CATALOG_TIP" "$out"
check_contains "notes a tip that is not the commit being deployed" \
	"the sidecar ingests the catalog of the branch tip, $CATALOG_TIP, not of $COMMIT" "$out"

echo "--- preflight: a state volume too full to fetch onto ---"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=524288 STUB_COLD_STORAGE="$CATALOG_PIN" \
	-- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "fails" 1 "$status"
check_contains "names the room and the need" \
	"the state volume of tcab-staging has 512 MiB free, and the sidecar's fetch needs 1024 MiB." "$out"
check_contains "says what that stops" "the staging backend's /state is too full for the sidecar to fetch the catalog onto." "$out"
check_contains "says nothing was applied" "Nothing was applied: tcab-staging runs what it ran." "$out"
check_lacks "and blames no cold-storage fetch" "so cold storage is fetched too" "$out"

# Room for the checkout alone is not room for a cold storage that has moved.
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=2097152 \
	STUB_COLD_STORAGE=ffffffffffffffffffffffffffffffffffffffff -- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "a moved cold-storage pin needs room for its fetch" 1 "$status"
check_contains "which is added to the need" "has 2048 MiB free, and the sidecar's fetch needs 3584 MiB." "$out"
check_contains "and explained" \
	"Its cold storage is at ffffffffffffffffffffffffffffffffffffffff and staging pins $CATALOG_PIN, so cold storage is fetched too." "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=2097152 -- preflight staging "$CATALOG_TIP")"
check_equal "as does a volume that holds no cold storage" 1 "$?"
check_contains "which is named" "Its cold storage is at none" "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_FREE_KB=2097152 TCAB_INGEST_MIN_FREE_MB=256 \
	TCAB_INGEST_COLD_STORAGE_MB=512 -- preflight staging "$CATALOG_TIP")"
check_equal "both needs are settings" 0 "$?"
check_contains "that the report names" "has 2048 MiB free; the sidecar's fetch needs 768 MiB." "$out"

echo "--- preflight: a state volume that cannot be read ---"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_NO_BACKEND=1 -- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "an environment with no backend yet passes" 0 "$status"
check_contains "saying there is no volume" "tcab-staging has no the-test-cabinet-backend yet, so there is no state volume to read." "$out"
check_lacks "and execs into nothing" " exec " "$(cat "$repo/kubectl.log")"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" -- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "a backend that cannot be read passes" 0 "$status"
check_contains "with a note" "Note: the state volume of tcab-staging could not be read, so its free space was not checked." "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" STUB_AZ_BROKEN=1 -- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "a cluster that cannot be reached passes" 0 "$status"
check_contains "with the same note" "could not be read, so its free space was not checked." "$out"
check_contains "and what az said" "ERROR: the stub refuses" "$out"

echo "--- preflight: a mirror that cannot be reached ---"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="file://$tmp/no-such-mirror.git" -- preflight staging "$COMMIT")"
status=$?
check_equal "fails" 1 "$status"
check_contains "says the branch could not be read" "has no branch staging, or could not be reached" "$out"
check_contains "says nothing was applied" "Nothing was applied: tcab-staging runs what it ran." "$out"
check_contains "names the command that checks again" "scripts/ci/catalog-ingest.sh preflight staging" "$out"
check_equal "reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo "--- preflight: a pinned cold-storage commit nothing holds ---"

catalog_fixture_unpin "$fixture"
repo="$(fresh_repo)"
out="$(run "$repo" TCAB_CATALOG_REPO="$CATALOG_REPO" -- preflight staging "$CATALOG_TIP")"
status=$?
check_equal "fails" 1 "$status"
check_contains "names the pin and where it was looked for" \
	"pins cold-storage at $CATALOG_PIN, which could not be fetched from file://$fixture/cold-storage" "$out"
check_contains "says nothing was applied" "Nothing was applied" "$out"
check_equal "reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo "--- verify: a sidecar that ingested ---"

repo="$(fresh_repo)"
write_result "$repo" ok ingest "The backend ingested staging at $COMMIT."
out="$(run "$repo" -- verify staging)"
status=$?
check_equal "passes" 0 "$status"
check_contains "reports the ingest" "The staging backend ingested the tip of staging." "$out"
check_contains "prints the sidecar's result" "The backend ingested staging at $COMMIT." "$out"
invocation="$(sed -n 1p "$repo/az.log")"
check_contains "in the staging cluster" "--resource-group testcabinet-staging-westus2-rg --name testcabinet-staging-westus2-aks" "$invocation"
check_equal "reads the ingest container's result file, once" \
	"-n tcab-staging exec deployment/the-test-cabinet-backend -c ingest -- cat /tmp/ingest-result" "$(cat "$repo/kubectl.log")"
check_equal "without waiting" "" "$(cat "$repo/sleep.log" 2>/dev/null)"

repo="$(fresh_repo)"
write_result "$repo" ok ingest
out="$(run "$repo" THE_TEST_CABINET_RESOURCE_GROUP=case-rg THE_TEST_CABINET_CLUSTER=case-aks \
	THE_TEST_CABINET_NAMESPACE=case-ns -- verify prod)"
check_contains "the deployment's own cluster wins over the environment's" "--resource-group case-rg --name case-aks" "$(sed -n 1p "$repo/az.log")"
check_contains "and its namespace" "-n case-ns exec" "$(cat "$repo/kubectl.log")"

echo "--- verify: a sidecar that failed ---"

repo="$(fresh_repo)"
write_result "$repo" failed cold-storage "The cold-storage submodule could not be fetched at the commit staging pins.
Free space on /state: 0 free of 9.8G (100% used).
fatal: write error: No space left on device"
out="$(run "$repo" -- verify staging)"
status=$?
check_equal "fails" 1 "$status"
check_contains "names the failing step" "INGEST failed at step 'cold-storage'" "$out"
check_contains "prints the sidecar's message" "The cold-storage submodule could not be fetched" "$out"
check_contains "with the free space it reported" "Free space on /state: 0 free of 9.8G (100% used)." "$out"
check_contains "and the command's own error" "No space left on device" "$out"
check_contains "says nothing was rolled back" "Nothing was ingested and nothing was rolled back" "$out"
check_contains "names the command that ingests once it is fixed" "scripts/reingest-cluster.sh --env staging" "$out"
check_equal "reaches the cluster once" 1 "$(wc -l <"$repo/az.log")"
check_lacks "undoes nothing" "rollout undo" "$(cat "$repo/kubectl.log")"

echo "--- verify: a sidecar still working ---"

repo="$(fresh_repo)"
write_result "$repo" ok ingest
out="$(run "$repo" STUB_RESULT_AFTER=3 -- verify staging)"
status=$?
check_equal "passes once the result lands" 0 "$status"
check_equal "after reading it four times" 4 "$(grep -c ' exec ' "$repo/kubectl.log")"
check_equal "five seconds apart" "5
5
5" "$(cat "$repo/sleep.log")"

repo="$(fresh_repo)"
write_result "$repo" running cold-storage
out="$(run "$repo" TCAB_INGEST_WAIT_SECONDS=20 TCAB_INGEST_POLL_SECONDS=10 -- verify staging)"
status=$?
check_equal "fails when the wait runs out" 1 "$status"
check_contains "names the step it was still at" "INGEST unfinished: still at step 'cold-storage' after 20s" "$out"
check_equal "having waited no longer than the bound" "10
10" "$(cat "$repo/sleep.log")"
check_contains "prints the sidecar's log" "ingest: a line of the sidecar's log" "$out"
check_contains "names the command that reads it again" "scripts/ci/catalog-ingest.sh verify staging" "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_INGEST_WAIT_SECONDS=0 -- verify staging)"
status=$?
check_equal "a container that recorded nothing fails" 1 "$status"
check_contains "saying so" "INGEST unknown: the ingest container of the-test-cabinet-backend recorded no result in 0s" "$out"

echo "--- verify: a cluster that cannot be reached ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_AZ_BROKEN=1 -- verify staging)"
status=$?
check_equal "fails" 1 "$status"
check_contains "says the result could not be read" "the ingest sidecar's result could not be read" "$out"
check_lacks "and does not say the sidecar failed" "did not ingest" "$out"

echo "--- refusals ---"

repo="$(fresh_repo)"
out="$(run "$repo" -- verify local)"
status=$?
check_equal "another environment fails" 1 "$status"
check_contains "naming it" "unknown environment 'local' (expected staging or prod)" "$out"
out="$(run "$repo" -- ingest staging)"
status=$?
check_equal "another mode fails" 1 "$status"
check_contains "with the usage" "usage: scripts/ci/catalog-ingest.sh preflight <staging|prod> [<commit>]" "$out"
out="$(run "$repo" -- verify)"
check_equal "no environment fails" 1 "$?"
check_equal "and no refusal reaches a cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo
echo "catalog-ingest.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
