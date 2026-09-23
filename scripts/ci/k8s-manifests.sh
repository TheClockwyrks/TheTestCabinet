#!/usr/bin/env bash
# Renders every Kubernetes kustomization and checks what the pipeline would deploy.
#
# Every overlay under deployments/k8s/overlays/ and every bootstrap under
# deployments/k8s/cluster/ has to render. Then, for staging and prod:
#
#   - the set scripts/ci/deploy.sh applies holds namespaced objects only, all in the
#     environment's namespace, because the deploy identity's role is scoped to that
#     namespace;
#   - that set names every Test Cabinet image at the Test Cabinet ACR and the commit
#     being deployed, and leaves no REPLACE_REGISTRY placeholder behind;
#   - the azure-<env> overlay on its own names no registry, so the pipeline is the
#     only thing that chooses a deployment's images;
#   - deployments/k8s/cluster/azure-<env> holds cluster-scoped objects only, so what
#     an administrator applies by hand and what the pipeline applies do not overlap.
#
# Needs kubectl (for its built-in kustomize) and no cluster.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

readonly SHA="0123456789abcdef0123456789abcdef01234567"
failed=0
fail() {
	echo "k8s-manifests: $*" >&2
	failed=1
}

# Prints every image reference a rendered stream names: each container's `image:`
# and the dispatcher's TCAB_DRIVER_IMAGE and TCAB_PUBLISHER_IMAGE values.
image_refs() {
	awk '
		/^ *(- )?image: / { v = $NF; gsub(/"/, "", v); print v }
		want && /^ *value: / { v = $NF; gsub(/"/, "", v); print v }
		{ want = ($0 ~ /name: TCAB_(DRIVER|PUBLISHER)_IMAGE$/) }
	'
}

for dir in deployments/k8s/overlays/*/ deployments/k8s/cluster/*/; do
	[[ -f "${dir}kustomization.yaml" ]] || continue
	if kubectl kustomize "$dir" >/dev/null; then
		echo "renders: ${dir}"
	else
		fail "${dir} does not render"
	fi
done

for env in staging prod; do
	namespace="tcab-${env}"
	log "azure-${env}"

	deployed="$(./scripts/ci/deploy.sh --render "$env" "$SHA")"
	if ! ci_assert_namespaced "$namespace" <<<"$deployed"; then
		fail "the ${env} deploy applies objects outside ${namespace}; move them under deployments/k8s/cluster/"
	fi
	if grep -q REPLACE_REGISTRY <<<"$deployed"; then
		fail "the ${env} deploy leaves a REPLACE_REGISTRY placeholder:"
		grep -n REPLACE_REGISTRY <<<"$deployed" >&2
	fi
	while IFS= read -r ref; do
		[[ "$ref" == "${CI_REGISTRY}/"*":${SHA}" ]] || fail "the ${env} deploy names ${ref}, not ${CI_REGISTRY}/<image>:<sha>"
	done < <(image_refs <<<"$deployed" | grep -E '/(tcab|test-cabinet)-' | sort -u)

	overlay="$(kubectl kustomize "deployments/k8s/overlays/azure-${env}")"
	while IFS= read -r ref; do
		fail "overlays/azure-${env} names ${ref}; the pipeline's deploy sets every Test Cabinet image"
	done < <(image_refs <<<"$overlay" | grep -E '(tcab|test-cabinet)-' | grep -v '^REPLACE_REGISTRY/.*:latest$' | sort -u)

	while read -r kind _ name; do
		scoped=""
		for k in "${CI_CLUSTER_SCOPED_KINDS[@]}"; do
			[[ "$kind" == "$k" ]] && scoped=1
		done
		[[ -n "$scoped" ]] || fail "cluster/azure-${env} holds the namespaced ${kind}/${name}; it belongs in the overlay"
	done < <(kubectl kustomize "deployments/k8s/cluster/azure-${env}" | ci_manifest_index)
done

if ((failed)); then
	exit 1
fi
echo "k8s-manifests: every kustomization renders and each deploy is namespaced and pinned to the ACR"
