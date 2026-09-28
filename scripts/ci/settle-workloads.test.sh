#!/usr/bin/env bash
# Table test for settle-workloads.sh. Run it directly: ./settle-workloads.test.sh
#
# No case reaches Azure or a cluster. A stub az first on PATH keeps the script it
# was handed and runs it, as the cluster would, with a stub kubectl first on PATH.
# The kubectl stub lists the workloads the case names, fails the rollout of those
# the case marks as failing, and records every call. The az stub answers with the
# script's own exit code and output, which is what aks_invoke reads.
#
# The subject is the script sent (its settings), which workloads are waited on and
# which are undone, and the recovery each --after-failure case prints.
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

check_lacks() { # label needle haystack
	if grep -qF -- "$2" <<<"$3"; then
		bad "$1" "expected no output containing: $2" "got: ${3:-<empty>}"
	else
		ok "$1"
	fi
}

check_failed() { # label status
	if [ "$2" -ne 0 ]; then
		ok "$1"
	else
		bad "$1" "expected a non-zero exit" "got exit 0"
	fi
}

if ! command -v jq >/dev/null 2>&1; then
	echo "jq is not installed here; skipping the settle-workloads test."
	exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

COMMIT="0123456789abcdef0123456789abcdef01234567"
PREVIOUS="89abcdef0123456789abcdef0123456789abcdef"
WORKLOADS="deployment.apps/the-test-cabinet-backend
deployment.apps/tcab-auth
deployment.apps/tcab-dispatcher
statefulset.apps/tcab-artifacts"

fresh_repo() {
	local repo
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/bin" "$repo/cluster/bin" "$repo/sent"
	cp "$CI_DIR/lib.sh" "$CI_DIR/settle-workloads.sh" "$repo/scripts/ci/"

	cat >"$repo/cluster/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_KUBECTL_LOG"
[ "$1" = "-n" ] && shift 2
case "$1 $2" in
	"get deployments,statefulsets") printf '%s\n' "$STUB_WORKLOADS" ;;
	"rollout status")
		for failing in ${STUB_FAILING:-}; do
			if [ "$3" = "$failing" ]; then
				echo "error: timed out waiting for the condition"
				exit 1
			fi
		done
		echo "$3 successfully rolled out"
		;;
	"rollout undo") echo "$3 rolled back" ;;
	"get deployment/"* | "get statefulset/"*) printf 'app.kubernetes.io/name=%s,' "${2#*/}" ;;
	*) echo "kubectl stub: $*" ;;
esac
STUB
	chmod +x "$repo/cluster/bin/kubectl"

	# Keeps the uploaded file, runs the command beside it with the kubectl stub,
	# and answers with what it wrote and its exit code.
	cat >"$repo/bin/az" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
printf '%s\n' "$*" >>"$STUB_AZ_LOG"
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
		env PATH="$repo/bin:$PATH" STUB_AZ_LOG="$repo/az.log" STUB_SENT="$repo/sent" \
			STUB_CLUSTER_BIN="$repo/cluster/bin" STUB_KUBECTL_LOG="$repo/kubectl.log" \
			STUB_WORKLOADS="$WORKLOADS" "${assignments[@]}" \
			"$repo/scripts/ci/settle-workloads.sh" "$@" 2>&1
	)
}

echo "--- every sibling becomes ready ---"

repo="$(fresh_repo)"
out="$(run "$repo" THE_TEST_CABINET_ROLLOUT_TIMEOUT=600s -- "$COMMIT")"
status=$?
check_equal "passes" 0 "$status"
check_equal "hands the cluster one command" 1 "$(wc -l <"$repo/az.log")"
check_contains "runs the script it sends" "--command bash settle-workloads.sh" "$(cat "$repo/az.log")"
check_contains "names the staging cluster" "--name testcabinet-staging-westus2-aks" "$(cat "$repo/az.log")"
sent="$(cat "$repo/sent/settle-workloads.sh")"
check_contains "the script settles tcab-staging" "NAMESPACE=tcab-staging" "$sent"
check_contains "each wait takes the rollout timeout" "WAIT=600s" "$sent"
check_contains "the undo waits what remains of the budget" "UNDO_WAIT=240s" "$sent"
check_contains "the script leaves the backend to deploy.sh" "EXCLUDE=the-test-cabinet-backend" "$sent"
kubectl_log="$(cat "$repo/kubectl.log")"
check_contains "waits on a Deployment" "rollout status deployment/tcab-auth --timeout=600s" "$kubectl_log"
check_contains "waits on a StatefulSet" "rollout status statefulset/tcab-artifacts --timeout=600s" "$kubectl_log"
check_lacks "does not wait on the backend" "rollout status deployment/the-test-cabinet-backend" "$kubectl_log"
check_lacks "undoes nothing" "rollout undo" "$kubectl_log"

echo "--- a sibling does not become ready ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_FAILING=deployment/tcab-dispatcher -- "$COMMIT")"
status=$?
check_failed "fails" "$status"
kubectl_log="$(cat "$repo/kubectl.log")"
check_contains "undoes the one that failed" "rollout undo deployment/tcab-dispatcher" "$kubectl_log"
check_lacks "leaves the ready ones alone" "rollout undo deployment/tcab-auth" "$kubectl_log"
check_lacks "leaves the ready StatefulSet alone" "rollout undo statefulset/tcab-artifacts" "$kubectl_log"
check_contains "describes the failed workload's pods" \
	"describe pods -l app.kubernetes.io/name=tcab-dispatcher" "$kubectl_log"
check_contains "describes every Test Cabinet pod" "describe pods -l app.kubernetes.io/part-of=test-cabinet" "$kubectl_log"
check_contains "prints the namespace's events" "get events" "$kubectl_log"
check_contains "names the failure" "FAILED: deployment/tcab-dispatcher" "$out"
check_lacks "prints no recovery outside --after-failure" "deploy-environment.sh" "$out"

echo "--- --include-backend waits on the backend too ---"

repo="$(fresh_repo)"
out="$(run "$repo" -- --include-backend "$COMMIT")"
status=$?
check_equal "passes" 0 "$status"
check_contains "waits on the backend" "rollout status deployment/the-test-cabinet-backend" "$(cat "$repo/kubectl.log")"

echo "--- --after-failure with a previous commit ---"

repo="$(fresh_repo)"
out="$(run "$repo" THE_TEST_CABINET_ROLLOUT_TIMEOUT=600s TCAB_PREVIOUS_COMMIT="$PREVIOUS" \
	TCAB_PREVIOUS_BACKEND=the-test-cabinet-backend STUB_FAILING=statefulset/tcab-artifacts -- --after-failure "$COMMIT")"
status=$?
check_failed "fails" "$status"
check_contains "waits a short while after a failure" "WAIT=120s" "$(cat "$repo/sent/settle-workloads.sh")"
check_contains "undoes the sibling the apply left unready" "rollout undo statefulset/tcab-artifacts" "$(cat "$repo/kubectl.log")"
check_contains "prints the recovery onto the previous commit" \
	"scripts/ci/deploy-environment.sh staging ${PREVIOUS}" "$out"
check_lacks "does not say fix forward" "Fix forward" "$out"

echo "--- --after-failure with no earlier revision of the renamed backend ---"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_PREVIOUS_COMMIT="$PREVIOUS" TCAB_PREVIOUS_BACKEND=tcab-backend -- --after-failure "$COMMIT")"
status=$?
check_equal "passes when every sibling is ready" 0 "$status"
check_contains "says fix forward" "Fix forward" "$out"
check_lacks "does not name the legacy commit as a recovery" "deploy-environment.sh staging ${PREVIOUS}" "$out"

repo="$(fresh_repo)"
out="$(run "$repo" TCAB_PREVIOUS_COMMIT= -- --after-failure "$COMMIT")"
check_contains "says fix forward on a first deploy" "Fix forward" "$out"

echo "--- the namespace names the environment ---"

repo="$(fresh_repo)"
out="$(run "$repo" THE_TEST_CABINET_NAMESPACE=tcab-prod TCAB_PREVIOUS_COMMIT="$PREVIOUS" -- --after-failure "$COMMIT")"
check_contains "settles tcab-prod" "NAMESPACE=tcab-prod" "$(cat "$repo/sent/settle-workloads.sh")"
check_contains "recovers prod" "scripts/ci/deploy-environment.sh prod ${PREVIOUS}" "$out"

echo "--- a value that is not a commit ---"

repo="$(fresh_repo)"
out="$(run "$repo" -- abc123)"
status=$?
check_failed "fails" "$status"
check_contains "names the value" "'abc123' is not a commit" "$out"
check_equal "reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo "--- the sent script is shellcheck-clean ---"

if command -v shellcheck >/dev/null 2>&1; then
	repo="$(fresh_repo)"
	run "$repo" -- "$COMMIT" >/dev/null
	if shellcheck -s bash "$repo/sent/settle-workloads.sh" >"$repo/shellcheck.out" 2>&1; then
		ok "shellcheck passes"
	else
		bad "shellcheck passes" "$(cat "$repo/shellcheck.out")"
	fi
else
	ok "(no shellcheck here; the sent script is not linted)"
fi

echo
echo "settle-workloads.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
