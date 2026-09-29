#!/usr/bin/env bash
# Waits on every workload of a deployment but the backend, and undoes each that
# does not become ready.
#
#   scripts/ci/settle-workloads.sh [--after-failure | --include-backend] <commit>
#
# The workspace template's scripts/ci/deploy.sh applies the whole overlay but waits
# on the backend Deployment, `the-test-cabinet-backend`, alone, and undoes only that
# one. The same apply rolls every other Test Cabinet workload (the auth service, the
# dispatcher, the artifact and arena services, the console, the telemetry stack).
# This settles them: in ONE `az aks command invoke`, it waits concurrently on every
# Deployment and StatefulSet in the namespace except the backend, each for the
# rollout timeout, then, for each that did not become ready, describes its pods,
# prints its logs and undoes it. When anything failed it also describes every
# `app.kubernetes.io/part-of=test-cabinet` pod and prints the namespace's recent
# events, and it exits non-zero. A workload that became ready is never undone.
#
# The template's deployment job has thirty minutes, and the backend's rollout
# (THE_TEST_CABINET_ROLLOUT_TIMEOUT, 600s once scripts/ci/pre-deploy.sh set it) has
# already spent up to ten of them, so all of this fits in SETTLE_BUDGET_SECONDS
# (840): the waits take the rollout timeout, and the undo waits what remains.
#
# The modes:
#
#   (none)             scripts/ci/post-deploy.sh, once the backend is ready.
#   --after-failure    The deployment job's step after a failed deploy. The
#                      workloads have had the backend's whole rollout to settle,
#                      so each is given two minutes (SETTLE_AFTER_FAILURE_TIMEOUT)
#                      and an undo two more. It then prints how to put the
#                      environment back: scripts/ci/deploy-environment.sh on the
#                      commit the namespace ran before (TCAB_PREVIOUS_COMMIT, which
#                      pre-deploy.sh recorded), or "fix forward" when there is no
#                      earlier revision of the renamed backend to go back to.
#   --include-backend  scripts/ci/deploy-environment.sh, which waits on the
#                      backend with the rest.
#
# Four variables name where, each defaulting to the staging deployment, as the
# template's deploy.sh hands them to post-deploy.sh:
#
#   THE_TEST_CABINET_RESOURCE_GROUP   The resource group the cluster sits in
#   THE_TEST_CABINET_CLUSTER          The cluster's name
#   THE_TEST_CABINET_NAMESPACE        The namespace to settle
#   THE_TEST_CABINET_ROLLOUT_TIMEOUT  How long each rollout is given (seconds or minutes)
set -euo pipefail

# shellcheck source=scripts/ci/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

readonly USAGE="usage: scripts/ci/settle-workloads.sh [--after-failure | --include-backend] <commit>"
readonly BACKEND="the-test-cabinet-backend"
readonly LEGACY_BACKEND="tcab-backend"

mode=settle
case "${1:-}" in
	--after-failure)
		mode=after-failure
		shift
		;;
	--include-backend)
		mode=include-backend
		shift
		;;
esac
if [[ $# -ne 1 ]]; then
	echo "$USAGE" >&2
	exit 1
fi
readonly COMMIT="$1"
if ! [[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
	echo "$USAGE" >&2
	echo "settle-workloads.sh: '${COMMIT}' is not a commit" >&2
	exit 1
fi

readonly RESOURCE_GROUP="${THE_TEST_CABINET_RESOURCE_GROUP:-testcabinet-staging-westus2-rg}"
readonly CLUSTER="${THE_TEST_CABINET_CLUSTER:-testcabinet-staging-westus2-aks}"
readonly NAMESPACE="${THE_TEST_CABINET_NAMESPACE:-tcab-staging}"
readonly ENVIRONMENT="${NAMESPACE#tcab-}"

# A kubectl duration in seconds: `600s`, `10m` or a bare number.
seconds_of() { # duration fallback
	if [[ "$1" =~ ^([0-9]+)s?$ ]]; then
		echo "${BASH_REMATCH[1]}"
	elif [[ "$1" =~ ^([0-9]+)m$ ]]; then
		echo $((BASH_REMATCH[1] * 60))
	else
		echo "$2"
	fi
}

rollout="$(seconds_of "${THE_TEST_CABINET_ROLLOUT_TIMEOUT:-300s}" 300)"
budget="$(seconds_of "${SETTLE_BUDGET_SECONDS:-840}" 840)"
if [[ "$mode" == after-failure ]]; then
	wait_seconds="$(seconds_of "${SETTLE_AFTER_FAILURE_TIMEOUT:-120}" 120)"
	((wait_seconds <= rollout)) || wait_seconds="$rollout"
	undo_seconds="$wait_seconds"
else
	wait_seconds="$rollout"
	((wait_seconds <= budget - 60)) || wait_seconds=$((budget - 60))
	undo_seconds=$((budget - wait_seconds))
	((undo_seconds <= rollout)) || undo_seconds="$rollout"
fi
((wait_seconds >= 30)) || wait_seconds=30
((undo_seconds >= 30)) || undo_seconds=30

exclude="$BACKEND"
[[ "$mode" != include-backend ]] || exclude=""

for tool in az jq; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "settle-workloads.sh: no ${tool} on PATH. az hands the command to the cluster and jq reads its verdict." >&2
		exit 1
	fi
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
readonly SCRIPT="${work}/settle-workloads.sh"

# The script that runs in the cluster. Its settings are written at its head; the
# rest is quoted, so it reaches the cluster as written here.
{
	printf 'NAMESPACE=%q\nWAIT=%q\nUNDO_WAIT=%q\nEXCLUDE=%q\n' \
		"$NAMESPACE" "${wait_seconds}s" "${undo_seconds}s" "$exclude"
	cat <<'SCRIPT'
set -u
k() { kubectl -n "$NAMESPACE" "$@"; }
state="$(mktemp -d)"

if ! listed="$(k get deployments,statefulsets -o name)"; then
	echo "FAILED: the workloads of ${NAMESPACE} could not be listed"
	exit 1
fi
workloads=()
while IFS= read -r ref; do
	ref="${ref/.apps\//\/}"
	[ -n "$ref" ] || continue
	[ "$ref" = "deployment/${EXCLUDE}" ] && continue
	workloads+=("$ref")
done <<<"$listed"

echo "Waiting ${WAIT} on ${#workloads[@]} workload(s) in ${NAMESPACE}: ${workloads[*]}"
for ref in "${workloads[@]}"; do
	slug="${ref//\//_}"
	(
		k rollout status "$ref" --timeout="$WAIT" >"$state/$slug.log" 2>&1
		echo $? >"$state/$slug.rc"
	) &
done
wait

failed=()
for ref in "${workloads[@]}"; do
	slug="${ref//\//_}"
	if [ "$(cat "$state/$slug.rc" 2>/dev/null)" = 0 ]; then
		echo "ready: ${ref}"
	else
		cat "$state/$slug.log"
		echo "NOT READY: ${ref}"
		failed+=("$ref")
	fi
done

if [ "${#failed[@]}" -eq 0 ]; then
	echo "Every workload in ${NAMESPACE} is ready."
	exit 0
fi

for ref in "${failed[@]}"; do
	echo "=== ${ref}: its pods and logs ==="
	# shellcheck disable=SC2016 # a go-template, which kubectl expands
	selector="$(k get "$ref" -o go-template='{{range $k, $v := .spec.selector.matchLabels}}{{$k}}={{$v}},{{end}}')"
	k describe pods -l "${selector%,}" || true
	k logs "$ref" --all-containers --tail=100 || true
done
for ref in "${failed[@]}"; do
	slug="${ref//\//_}"
	(
		if k rollout undo "$ref" && k rollout status "$ref" --timeout="$UNDO_WAIT"; then
			echo "undone: ${ref}"
		else
			echo "NOT UNDONE: ${ref}"
		fi
	) >"$state/$slug.undo" 2>&1 &
done
wait
for ref in "${failed[@]}"; do
	cat "$state/${ref//\//_}.undo"
done

echo "=== every Test Cabinet pod in ${NAMESPACE} ==="
k describe pods -l app.kubernetes.io/part-of=test-cabinet || true
echo "=== recent events in ${NAMESPACE} ==="
k get events --sort-by=.lastTimestamp | tail -n 60 || true
echo "FAILED: ${failed[*]}"
exit 1
SCRIPT
} >"$SCRIPT"

echo "Settling ${NAMESPACE} on ${CLUSTER} at ${COMMIT}."
verdict=0
aks_invoke "$RESOURCE_GROUP" "$CLUSTER" "$SCRIPT" "bash settle-workloads.sh" || verdict=$?
case "$verdict" in
	0) echo "Every workload in ${NAMESPACE} is ready at ${COMMIT}." ;;
	1) echo >&2 "settle-workloads.sh: a workload in ${NAMESPACE} did not become ready at ${COMMIT}, above; it was undone." ;;
	*) echo >&2 "settle-workloads.sh: the workloads of ${NAMESPACE} could not be read, above." ;;
esac

if [[ "$mode" == after-failure ]]; then
	previous="${TCAB_PREVIOUS_COMMIT:-}"
	previous_backend="${TCAB_PREVIOUS_BACKEND:-$BACKEND}"
	if [[ "$previous" =~ ^[0-9a-f]{40}$ && "$previous_backend" != "$LEGACY_BACKEND" ]]; then
		remediation "${COMMIT} is not deployed. The backend was rolled back by deploy.sh. To put" \
			"all of ${NAMESPACE} back on ${previous}, the commit it ran before:" \
			"    scripts/ci/deploy-environment.sh ${ENVIRONMENT} ${previous}"
	else
		remediation "${COMMIT} is not deployed, and ${NAMESPACE} holds no earlier ${BACKEND}" \
			"revision to go back to: its backend was the retired ${LEGACY_BACKEND}, or none." \
			"Fix forward: push the fix, or roll by hand onto a commit whose images the registry holds:" \
			"    scripts/ci/deploy-environment.sh ${ENVIRONMENT} <commit>"
	fi
fi

[[ "$verdict" -eq 0 ]]
