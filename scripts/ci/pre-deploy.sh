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
#   0. Checks that the catalog the new backend's ingest sidecar will fetch can be
#      fetched (scripts/ci/catalog-ingest.sh preflight): the overlay's catalog branch
#      tip on the GitHub mirror and the cold-storage commit it pins, and that the
#      backend's state volume has room for the fetch and is not resized in a way
#      the cluster would refuse. It fails here, before anything in the cluster is
#      changed, when it cannot.
#   1. Pins the overlay (scripts/ci/pin-images.sh, in place): the arena's, the
#      artifacts service's, the dispatcher's, the repos service's, the console's
#      and the publisher's images at the commits <commit>'s microservice-arena,
#      microservice-artifacts, microservice-dispatcher, microservice-repos,
#      console.testcabinet.ai and microservice-publisher submodule pointers name
#      (the dispatcher's publisher image with the last), and the dispatcher's
#      driver image and run-container tag at the commit its microservice-driver
#      pointer names, which the run images are built at.
#      deploy.sh lays its own layer over the overlay, so the render it applies
#      carries them.
#   2. Refuses an overlay that binds a workload to a workload identity annotated
#      `unprovisioned` (tcab-lib.sh's ci_assert_identities_provisioned), before
#      anything reaches the cluster.
#   3. Reads, in one command in the cluster, the commit the namespace's backend runs
#      now: the tag of `the-test-cabinet-backend`, else of the legacy
#      `tcab-backend`. It sets the pipeline variables TCAB_PREVIOUS_COMMIT (empty on
#      a first deployment) and TCAB_PREVIOUS_BACKEND (the Deployment it was read
#      from), which the job's after-failure step reads to print the recovery.
#   4. Sets THE_TEST_CABINET_ROLLOUT_TIMEOUT to 600s for the steps after it, the time
#      every rollout has always been given here, rather than the template's 300s.
#   5. Retires the objects of an earlier shape (scripts/ci/retire-legacy-backend.sh):
#      the `tcab-backend` Deployment, which holds the backend's disk, the artifacts
#      service's `tcab-artifacts` StatefulSet, which the Deployment replaces, and the
#      internal ingress's Ingresses, its network policies and the `tcab-auth`
#      workload, which the edge replaced.
#   6. Brings the Secrets the Key Vault CSI driver syncs to the keys the pinned
#      render declares (scripts/ci/sync-secrets.sh): it applies the render's
#      SecretProviderClass, deletes each synced Secret whose keys differ, and
#      restarts tcab-keyvault-sync until every declared Secret holds its keys, so a
#      workload the apply rolls finds the Secrets it reads (tcab-artifacts-secrets
#      before the artifacts service) and none keeps a key the class dropped.
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
# shellcheck source=scripts/ci/tcab-lib.sh
source "${CI_DIR}/tcab-lib.sh"

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
	kubectl kustomize "${work}/k8s/overlays/${OVERLAY}" >"${work}/render.yaml"
	cat "${work}/render.yaml"
	echo "--- the commands pre-deploy.sh would run on ${CLUSTER} (${RESOURCE_GROUP}) ---"
	echo "Would read the commit the backend runs, under its name or else its old one:"
	echo "    $(read_command the-test-cabinet-backend)"
	echo "    $(read_command tcab-backend)"
	echo "Would check that the ${OVERLAY} catalog branch and its cold storage can be fetched:"
	echo "    scripts/ci/catalog-ingest.sh preflight ${OVERLAY} ${COMMIT}"
	echo "Would set THE_TEST_CABINET_ROLLOUT_TIMEOUT=${ROLLOUT_TIMEOUT}, TCAB_PREVIOUS_COMMIT and TCAB_PREVIOUS_BACKEND."
	"${CI_DIR}/retire-legacy-backend.sh" --dry-run
	"${CI_DIR}/sync-secrets.sh" --dry-run "${work}/render.yaml"
	exit 0
fi

for tool in az jq kubectl; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "pre-deploy.sh: no ${tool} on PATH. kubectl renders the overlay, az hands each command to the cluster and jq reads its verdict." >&2
		exit 1
	fi
done

if ! "${CI_DIR}/catalog-ingest.sh" preflight "$OVERLAY" "$COMMIT"; then
	echo "pre-deploy.sh: the ${OVERLAY} deploy preflight failed, above; nothing was applied." >&2
	exit 1
fi

"${CI_DIR}/pin-images.sh" "$OVERLAY" "$COMMIT"
readonly RENDER="${work}/render.yaml"
kubectl kustomize "deployments/k8s/overlays/${OVERLAY}" >"$RENDER"

# A workload bound to an identity that does not exist yet would never become ready,
# and step 5 would already have retired what it replaces. Refuse before the cluster.
if ! ci_assert_identities_provisioned <"$RENDER"; then
	echo "pre-deploy.sh: overlays/${OVERLAY} binds a workload to an unprovisioned identity, above; nothing was retired or applied." >&2
	remediation "Provision it, put its clientId in deployments/k8s/overlays/${OVERLAY}/patch-artifacts-identity.yaml or patch-repos-identity.yaml" \
		"and copy the trees on the claim artifacts-tcab-artifacts-0 in ${NAMESPACE} into the container" \
		"(scripts/ci/copy-artifact-trees.sh ${OVERLAY}), then deploy again."
	exit 1
fi

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

# The template's deploy.sh applies the render next, so the synced Secrets must hold
# the keys it declares before any workload reading them rolls.
"${CI_DIR}/sync-secrets.sh" "$RENDER"
