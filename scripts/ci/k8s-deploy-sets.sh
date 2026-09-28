#!/usr/bin/env bash
# Renders every Kubernetes kustomization and checks what the pipeline would deploy.
#
# The template's k8s-manifests gate renders each overlay and checks what every
# deployment needs (namespaces, resources, tags). This checks what The Test Cabinet's
# Azure deployments add, and is the script behind the k8s-deploy-sets gate. Every
# overlay under deployments/k8s/overlays/ and every bootstrap under
# deployments/k8s/cluster/ has to render. Then, for staging and prod:
#
#   - the set scripts/ci/deploy-environment.sh --render prints, which is the overlay
#     after scripts/ci/pin-images.sh, holds namespaced objects only, all in
#     `tcab-<env>`, because the deploy identity's role is scoped to that namespace;
#   - that set names every Test Cabinet image, and the dispatcher's driver and
#     publisher images, at `testcabinet.azurecr.io/<image>:<commit>`, and leaves no
#     REPLACE_ placeholder anywhere;
#   - the overlay on its own names every Test Cabinet image at the tag `unpinned`
#     and at no other, so the pin is the only thing that chooses a deployment's
#     images;
#   - deployments/k8s/cluster/azure-<env> holds cluster-scoped objects only, so what
#     an administrator applies by hand and what the pipeline applies do not overlap.
#
# And for staging, the overlay the template's scripts/ci/deploy.sh rolls: rendered
# through a layer like the one deploy.sh writes over the pinned overlay, it carries
# exactly one `image: testcabinet.azurecr.io/the-test-cabinet-backend:<commit>` line,
# the check deploy.sh makes before it applies anything.
#
# TCAB_K8S_ROOT names another deployments/k8s tree to check (default: the checkout's
# own), which is how k8s-deploy-sets.test.sh proves it fails on broken ones.
#
# Needs kubectl (for its built-in kustomize) and no cluster.
set -euo pipefail

caller_dir="$PWD"
CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
# shellcheck source=scripts/ci/tcab-lib.sh
source "${CI_DIR}/tcab-lib.sh"

readonly SHA="0123456789abcdef0123456789abcdef01234567"
readonly BACKEND_IMAGE="${CI_REGISTRY}/the-test-cabinet-backend"

k8s_root="${TCAB_K8S_ROOT:-deployments/k8s}"
if [[ -n "${TCAB_K8S_ROOT:-}" && "$k8s_root" != /* ]]; then
	k8s_root="${caller_dir}/${k8s_root}"
fi
k8s_root="$(cd "$k8s_root" && pwd)"
export TCAB_K8S_ROOT="$k8s_root"

failed=0
fail() {
	echo "k8s-deploy-sets: $*" >&2
	failed=1
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Prints every Test Cabinet image reference a rendered stream names: each container's
# `image:` and the dispatcher's TCAB_DRIVER_IMAGE and TCAB_PUBLISHER_IMAGE values.
image_refs() {
	awk '
		/^ *(- )?image: / { v = $NF; gsub(/"/, "", v); print v }
		want && /^ *value: / { v = $NF; gsub(/"/, "", v); print v }
		{ want = ($0 ~ /name: TCAB_(DRIVER|PUBLISHER)_IMAGE$/) }
	' | { grep -E '(^|/)(tcab|the-test-cabinet)-' || true; } | sort -u
}

for dir in "$k8s_root"/overlays/*/ "$k8s_root"/cluster/*/; do
	[[ -f "${dir}kustomization.yaml" ]] || continue
	if kubectl kustomize "$dir" >/dev/null; then
		echo "renders: ${dir#"$k8s_root"/}"
	else
		fail "${dir#"$k8s_root"/} does not render"
	fi
done

for env in staging prod; do
	namespace="tcab-${env}"
	log "overlays/${env}"

	overlay="$(kubectl kustomize "${k8s_root}/overlays/${env}")" || {
		fail "overlays/${env} does not render"
		continue
	}
	while IFS= read -r ref; do
		[[ "$ref" == "${CI_REGISTRY}/"*":unpinned" ]] ||
			fail "overlays/${env} names ${ref}; it names every Test Cabinet image at ${CI_REGISTRY}/<image>:unpinned, and scripts/ci/pin-images.sh pins it"
	done < <(grep -v '^REPLACE_REGISTRY/tcab-\(driver\|publisher\):latest$' < <(image_refs <<<"$overlay") || true)

	if ! deployed="$("${CI_DIR}/deploy-environment.sh" --render "$env" "$SHA")"; then
		fail "the ${env} deploy does not render: scripts/ci/deploy-environment.sh --render ${env} ${SHA}"
		continue
	fi
	if ! ci_assert_namespaced "$namespace" <<<"$deployed"; then
		fail "the ${env} deploy applies objects outside ${namespace}; move them under deployments/k8s/cluster/"
	fi
	if grep -q 'REPLACE_' <<<"$deployed"; then
		fail "the ${env} deploy leaves a REPLACE_ placeholder:"
		grep -n 'REPLACE_' <<<"$deployed" >&2
	fi
	refs="$(image_refs <<<"$deployed")"
	[[ -n "$refs" ]] || fail "the ${env} deploy names no Test Cabinet image"
	while IFS= read -r ref; do
		[[ -z "$ref" || "$ref" == "${CI_REGISTRY}/"*":${SHA}" ]] ||
			fail "the ${env} deploy names ${ref}, not ${CI_REGISTRY}/<image>:<commit>"
	done <<<"$refs"
	for want in "${CI_REGISTRY}/tcab-driver:${SHA}" "${CI_REGISTRY}/tcab-publisher:${SHA}" "${BACKEND_IMAGE}:${SHA}"; do
		grep -qxF "$want" <<<"$refs" || fail "the ${env} deploy does not name ${want}"
	done
	grep -qE "^ *value: \"?${SHA}\"?$" <<<"$deployed" ||
		fail "the ${env} deploy does not set the dispatcher's TCAB_CONTAINER_TAG to the commit"

	cluster="${k8s_root}/cluster/azure-${env}"
	if [[ -d "$cluster" ]]; then
		while read -r kind _ name; do
			scoped=""
			for k in "${CI_CLUSTER_SCOPED_KINDS[@]}"; do
				[[ "$kind" == "$k" ]] && scoped=1
			done
			[[ -n "$scoped" ]] || fail "cluster/azure-${env} holds the namespaced ${kind}/${name}; it belongs in the overlay"
		done < <(kubectl kustomize "$cluster" | ci_manifest_index)
	else
		fail "there is no cluster/azure-${env}, the bootstrap an administrator applies before the first ${env} deploy"
	fi
done

# The staging deploy exactly as the template's deploy.sh builds it: the overlay pinned
# in place, then a layer beside it that sets the backend's tag.
log "overlays/staging under the template deploy.sh's layer"
cp -R "$k8s_root" "${work}/k8s"
if TCAB_K8S_ROOT="${work}/k8s" "${CI_DIR}/pin-images.sh" staging "$SHA" >/dev/null; then
	mkdir "${work}/k8s/overlays/.deploy-check"
	cat >"${work}/k8s/overlays/.deploy-check/kustomization.yaml" <<KUSTOMIZATION
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../staging
images:
  - name: ${BACKEND_IMAGE}
    newTag: "${SHA}"
KUSTOMIZATION
	if layered="$(kubectl kustomize "${work}/k8s/overlays/.deploy-check")"; then
		count="$(grep -cE "image: ${BACKEND_IMAGE}:${SHA}$" <<<"$layered" || true)"
		[[ "$count" -eq 1 ]] ||
			fail "the template deploy.sh's render of staging carries ${count} of the one image: ${BACKEND_IMAGE}:${SHA} line it requires"
	else
		fail "the template deploy.sh's layer over staging does not render"
	fi
else
	fail "overlays/staging does not pin: scripts/ci/pin-images.sh staging ${SHA}"
fi

if ((failed)); then
	exit 1
fi
echo "k8s-deploy-sets: every kustomization renders, and each deploy is namespaced and pinned to the ACR"
