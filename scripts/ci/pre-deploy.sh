#!/usr/bin/env bash
# Readies an overlay and its namespace for the workspace template's deploy.sh.
#
#   scripts/ci/pre-deploy.sh [--dry-run] <staging|prod> <commit>
#
# The `before` step of the pipeline's staging deployment job
# (.azure/project/deploy-steps.yml), which runs inside AzureCLI@2 on the job's
# throwaway checkout. The template's scripts/ci/deploy.sh that follows pins the
# backend alone and waits on it alone; this does the rest a Test Cabinet deployment
# needs first, in order:
#
#   1. Pins the overlay (scripts/ci/pin-images.sh, in place): the other seven images
#      and the dispatcher's run-image environment, all at <commit>. deploy.sh lays
#      its own layer over the overlay, so the render it applies carries them.
#   2. Reads, in one command in the cluster, the commit the namespace's backend runs
#      now: the tag of `the-test-cabinet-backend`, else of the legacy
#      `tcab-backend`. It sets the pipeline variables TCAB_PREVIOUS_COMMIT (empty on
#      a first deployment) and TCAB_PREVIOUS_BACKEND (the Deployment it was read
#      from), which the job's after-failure step reads to print the recovery.
#   3. Sets THE_TEST_CABINET_ROLLOUT_TIMEOUT to 600s for the steps after it, the time
#      every rollout has always been given here, rather than the template's 300s.
#   4. Retires the legacy `tcab-backend` Deployment
#      (scripts/ci/retire-legacy-backend.sh), which holds the backend's disk.
#
# `--dry-run` pins a temporary copy instead, prints its render and the commands it
# would run in the cluster, and runs none of them.
#
# Three variables name where, each defaulting to the overlay's environment:
#
#   THE_TEST_CABINET_RESOURCE_GROUP  testcabinet-<overlay>-westus2-rg
#   THE_TEST_CABINET_CLUSTER         testcabinet-<overlay>-westus2-aks
#   THE_TEST_CABINET_NAMESPACE       tcab-<overlay>
set -euo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
# shellcheck source=scripts/ci/lib.sh
source "${CI_DIR}/lib.sh"

readonly USAGE="usage: scripts/ci/pre-deploy.sh [--dry-run] <staging|prod> <commit>"
readonly ROLLOUT_TIMEOUT="600s"

dry_run=""
if [[ "${1:-}" == --dry-run ]]; then
	dry_run=1
	shift
fi
if [[ $# -ne 2 ]]; then
	echo "$USAGE" >&2
	exit 1
fi
readonly OVERLAY="$1"
readonly COMMIT="$2"
case "$OVERLAY" in
	staging | prod) ;;
	*)
		echo "$USAGE" >&2
		echo "pre-deploy.sh: unknown overlay '${OVERLAY}' (expected staging or prod)" >&2
		exit 1
		;;
esac
if ! [[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
	echo "$USAGE" >&2
	echo "pre-deploy.sh: '${COMMIT}' is not a commit" >&2
	exit 1
fi

export THE_TEST_CABINET_RESOURCE_GROUP="${THE_TEST_CABINET_RESOURCE_GROUP:-testcabinet-${OVERLAY}-westus2-rg}"
export THE_TEST_CABINET_CLUSTER="${THE_TEST_CABINET_CLUSTER:-testcabinet-${OVERLAY}-westus2-aks}"
export THE_TEST_CABINET_NAMESPACE="${THE_TEST_CABINET_NAMESPACE:-tcab-${OVERLAY}}"
readonly RESOURCE_GROUP="$THE_TEST_CABINET_RESOURCE_GROUP"
readonly CLUSTER="$THE_TEST_CABINET_CLUSTER"
readonly NAMESPACE="$THE_TEST_CABINET_NAMESPACE"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The commands that read the backend's commit, one per name it may run under.
# --ignore-not-found makes an absent Deployment an empty answer, so only a command
# that could not ask fails.
read_command() { # deployment
	printf '%s' "kubectl -n ${NAMESPACE} get deployment $1 --ignore-not-found -o jsonpath='{.spec.template.spec.containers[?(@.name==\"backend\")].image}'"
}
readonly READ_SCRIPT="${work}/read-backend-commit.sh"
{
	echo "set -eu"
	# shellcheck disable=SC2016 # $image is the sent script's own variable
	for name in the-test-cabinet-backend tcab-backend; do
		printf 'image="$(%s)"\n' "$(read_command "$name")"
		printf 'if [ -n "$image" ]; then echo "BACKEND %s $image"; exit 0; fi\n' "$name"
	done
	echo 'echo "BACKEND none"'
} >"$READ_SCRIPT"

if [[ -n "$dry_run" ]]; then
	cp -R deployments/k8s "${work}/k8s"
	TCAB_K8S_ROOT="${work}/k8s" "${CI_DIR}/pin-images.sh" "$OVERLAY" "$COMMIT" >&2
	echo "--- the pinned ${OVERLAY} overlay, as deploy.sh's layer finds it ---"
	kubectl kustomize "${work}/k8s/overlays/${OVERLAY}"
	echo "--- the commands pre-deploy.sh would run on ${CLUSTER} (${RESOURCE_GROUP}) ---"
	echo "Would read the commit the backend runs, under its name or else its old one:"
	echo "    $(read_command the-test-cabinet-backend)"
	echo "    $(read_command tcab-backend)"
	echo "Would set THE_TEST_CABINET_ROLLOUT_TIMEOUT=${ROLLOUT_TIMEOUT}, TCAB_PREVIOUS_COMMIT and TCAB_PREVIOUS_BACKEND."
	"${CI_DIR}/retire-legacy-backend.sh" --dry-run
	exit 0
fi

for tool in az jq kubectl; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "pre-deploy.sh: no ${tool} on PATH. kubectl renders the overlay, az hands each command to the cluster and jq reads its verdict." >&2
		exit 1
	fi
done

"${CI_DIR}/pin-images.sh" "$OVERLAY" "$COMMIT"

echo "Reading the commit ${NAMESPACE} runs on ${CLUSTER}."
answer="$(aks_invoke "$RESOURCE_GROUP" "$CLUSTER" "$READ_SCRIPT" "sh read-backend-commit.sh")" || {
	echo "$answer"
	echo "pre-deploy.sh: the backend's commit could not be read, above; nothing was applied." >&2
	exit 1
}
echo "$answer"
previous=""
previous_backend=""
read -r _ name image < <(grep '^BACKEND ' <<<"$answer" | tail -n 1) || true
if [[ -n "${name:-}" && "$name" != none ]]; then
	previous_backend="$name"
	tag="${image##*:}"
	if [[ "$tag" =~ ^[0-9a-f]{40}$ ]]; then
		previous="$tag"
	fi
fi
echo "The namespace runs ${previous_backend:-no backend} at ${previous:-no known commit}."
echo "##vso[task.setvariable variable=TCAB_PREVIOUS_COMMIT]${previous}"
echo "##vso[task.setvariable variable=TCAB_PREVIOUS_BACKEND]${previous_backend}"
echo "##vso[task.setvariable variable=THE_TEST_CABINET_ROLLOUT_TIMEOUT]${ROLLOUT_TIMEOUT}"

"${CI_DIR}/retire-legacy-backend.sh"
