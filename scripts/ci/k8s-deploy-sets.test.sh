#!/usr/bin/env bash
# Table test for k8s-deploy-sets.sh. Run it directly: ./k8s-deploy-sets.test.sh
#
# Each case copies this checkout's deployments/k8s to a temporary directory, breaks
# the copy the way the case names, and runs the check against it through
# TCAB_K8S_ROOT. The pristine copy passes; each broken one fails, naming what broke.
# Nothing reaches a cluster: kubectl only renders. Without kubectl the test skips.
set -uo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S="$(cd "$CI_DIR/../../deployments/k8s" && pwd)"
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

check_failed() { # label status
	if [ "$2" -ne 0 ]; then
		ok "$1"
	else
		bad "$1" "expected a non-zero exit" "got exit 0"
	fi
}

if ! command -v kubectl >/dev/null 2>&1; then
	echo "kubectl is not installed here; skipping the k8s-deploy-sets test."
	exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fresh_tree() {
	local tree
	tree="$(mktemp -d "$tmp/treeXXXXXX")"
	cp -R "$K8S" "$tree/k8s"
	printf '%s' "$tree/k8s"
}

check() { # tree
	(cd / && env TCAB_K8S_ROOT="$1" "$CI_DIR/k8s-deploy-sets.sh" 2>&1)
}

# Adds a resource file to an overlay's resources list, after its base.
add_resource() { # tree overlay file-name content
	printf '%s\n' "$4" >"$1/overlays/$2/$3"
	sed -i "s#^  - \.\./\.\./base\$#  - ../../base\n  - $3#" "$1/overlays/$2/kustomization.yaml"
}

echo "--- the checkout's own tree ---"

tree="$(fresh_tree)"
out="$(check "$tree")"
status=$?
check_equal "passes" 0 "$status"
check_contains "renders the staging overlay" "renders: overlays/staging/" "$out"
check_contains "renders the prod bootstrap" "renders: cluster/azure-prod/" "$out"
check_equal "leaves the tree it checked as it was" "" "$(diff -r "$K8S" "$tree" 2>&1)"

echo "--- an unpinned image survives the pin ---"

tree="$(fresh_tree)"
cat >>"$tree/overlays/staging/kustomization.yaml" <<'YAML'
  - target: { kind: Deployment, name: tcab-arena }
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/image
        value: testcabinet.azurecr.io/tcab-extra:unpinned
YAML
out="$(check "$tree")"
status=$?
check_failed "fails" "$status"
check_contains "names the image" "tcab-extra:unpinned" "$out"
check_contains "names the deploy that does not render" "the staging deploy does not render" "$out"

echo "--- a repository's own image at the superrepo's commit ---"

tree="$(fresh_tree)"
cat >>"$tree/overlays/prod/kustomization.yaml" <<'YAML'
  - target: { kind: Deployment, name: tcab-repos }
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/image
        value: testcabinet.azurecr.io/microservice-repos:0123456789abcdef0123456789abcdef01234567
YAML
out="$(check "$tree")"
status=$?
check_failed "fails" "$status"
check_contains "names the image and what it is pinned to" \
	"the prod deploy names testcabinet.azurecr.io/microservice-repos:0123456789abcdef0123456789abcdef01234567, not testcabinet.azurecr.io/<repository>:<the commit its submodule pointer names>" "$out"

echo "--- the dispatcher's image built here rather than in its repository ---"

tree="$(fresh_tree)"
sed -i 's#^    newName: testcabinet.azurecr.io/microservice-dispatcher$#    newName: testcabinet.azurecr.io/tcab-dispatcher#' \
	"$tree/overlays/staging/kustomization.yaml"
out="$(check "$tree")"
status=$?
check_failed "fails" "$status"
check_contains "names the image it names instead" \
	"the staging deploy names testcabinet.azurecr.io/tcab-dispatcher:456789abcdef0123456789abcdef0123456789ab" "$out"
check_contains "names the image at the pointer it requires" \
	"the staging deploy does not name testcabinet.azurecr.io/microservice-dispatcher:456789abcdef0123456789abcdef0123456789ab" \
	"$out"

echo "--- a manifest that sets a memory limit on a run pod ---"

tree="$(fresh_tree)"
sed -i 's#^            - name: TCAB_K8S_RUN_MEMORY_REQUEST$#            - name: TCAB_K8S_RUN_MEMORY_LIMIT\n              value: "8Gi"\n&#' \
	"$tree/base/dispatcher.yaml"
out="$(check "$tree")"
status=$?
check_failed "fails" "$status"
check_contains "names the manifest and the variable" \
	"base/dispatcher.yaml:" "$(grep 'TCAB_K8S_RUN_MEMORY_LIMIT' <<<"$out")"
check_contains "names the overlay that renders it" "overlays/prod/ renders a memory limit on a run pod" "$out"
check_contains "cites the rule" "Driver pod reservation" "$out"

echo "--- an overlay patch that sets the driver's memory limit ---"

tree="$(fresh_tree)"
sed -i 's#^            - name: TCAB_K8S_NAMESPACE$#            - name: TCAB_DISPATCHER_DRIVER_MEMORY_LIMIT\n              value: "4Gi"\n&#' \
	"$tree/overlays/local/patch-dispatcher.yaml"
out="$(check "$tree")"
status=$?
check_failed "fails" "$status"
check_contains "names the patch" "overlays/local/patch-dispatcher.yaml:" "$out"
check_contains "names the overlay that renders it" "overlays/local/ renders a memory limit on a run pod" "$out"

echo "--- a memory limit named only in a comment ---"

tree="$(fresh_tree)"
sed -i 's#^            - name: TCAB_K8S_RUN_MEMORY_REQUEST$#            \# - name: TCAB_K8S_RUN_MEMORY_LIMIT\n&#' \
	"$tree/base/dispatcher.yaml"
out="$(check "$tree")"
status=$?
check_equal "passes" 0 "$status"

echo "--- a cluster-scoped object in a deploy set ---"

tree="$(fresh_tree)"
add_resource "$tree" prod clusterrole.yaml 'apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: tcab-too-wide
rules: []'
out="$(check "$tree")"
status=$?
check_failed "fails" "$status"
check_contains "names the object" "cluster-scoped: ClusterRole/tcab-too-wide" "$out"
check_contains "names the deploy" "the prod deploy applies objects outside tcab-prod" "$out"

echo "--- a REPLACE_ placeholder in a deploy set ---"

tree="$(fresh_tree)"
add_resource "$tree" staging placeholder.yaml 'apiVersion: v1
kind: ConfigMap
metadata:
  name: tcab-placeholder
data:
  client-id: REPLACE_IDENTITY_CLIENT_ID'
out="$(check "$tree")"
status=$?
check_failed "fails" "$status"
check_contains "names the placeholder" "REPLACE_IDENTITY_CLIENT_ID" "$out"
check_contains "names the deploy" "the staging deploy leaves a REPLACE_ placeholder" "$out"

echo "--- an overlay that pins an image itself ---"

tree="$(fresh_tree)"
sed -i '0,/^    newTag: unpinned$/s//    newTag: latest/' "$tree/overlays/prod/kustomization.yaml"
out="$(check "$tree")"
status=$?
check_failed "fails" "$status"
check_contains "names the overlay's own tag" "overlays/prod names testcabinet.azurecr.io/the-test-cabinet-backend:latest" "$out"

echo "--- a namespaced object in a cluster bootstrap ---"

tree="$(fresh_tree)"
printf 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: tcab-stray\n  namespace: tcab-staging\n' \
	>"$tree/cluster/azure-staging/stray.yaml"
printf 'resources:\n  - stray.yaml\n' >>"$tree/cluster/azure-staging/kustomization.yaml"
out="$(check "$tree")"
status=$?
check_failed "fails" "$status"
check_contains "names the object" "cluster/azure-staging holds the namespaced ConfigMap/tcab-stray" "$out"

echo
echo "k8s-deploy-sets.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
