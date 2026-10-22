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

echo "--- the artifacts service's image built here rather than in its repository ---"

tree="$(fresh_tree)"
sed -i 's#^    newName: testcabinet.azurecr.io/microservice-artifacts$#    newName: testcabinet.azurecr.io/tcab-artifacts#' \
	"$tree/overlays/prod/kustomization.yaml"
out="$(check "$tree")"
status=$?
check_failed "fails" "$status"
check_contains "names the image it names instead" \
	"the prod deploy names testcabinet.azurecr.io/tcab-artifacts:abcdef0123456789abcdef0123456789abcdef01" "$out"
check_contains "names the image at the pointer it requires" \
	"the prod deploy does not name testcabinet.azurecr.io/microservice-artifacts:abcdef0123456789abcdef0123456789abcdef01" \
	"$out"

echo "--- the arena's image built here rather than in its repository ---"

tree="$(fresh_tree)"
sed -i 's#^    newName: testcabinet.azurecr.io/microservice-arena$#    newName: testcabinet.azurecr.io/tcab-arena#' \
	"$tree/overlays/staging/kustomization.yaml"
out="$(check "$tree")"
status=$?
check_failed "fails" "$status"
check_contains "names the image it names instead" \
	"the staging deploy names testcabinet.azurecr.io/tcab-arena:9876543210abcdef9876543210abcdef98765432" "$out"
check_contains "names the image at the pointer it requires" \
	"the staging deploy does not name testcabinet.azurecr.io/microservice-arena:9876543210abcdef9876543210abcdef98765432" \
	"$out"

echo "--- the console's image built here rather than in its repository ---"

tree="$(fresh_tree)"
sed -i 's#^    newName: testcabinet.azurecr.io/console.testcabinet.ai$#    newName: testcabinet.azurecr.io/tcab-web#' \
	"$tree/overlays/prod/kustomization.yaml"
out="$(check "$tree")"
status=$?
check_failed "fails" "$status"
check_contains "names the image it names instead" \
	"the prod deploy names testcabinet.azurecr.io/tcab-web:fedcba9876543210fedcba9876543210fedcba98" "$out"
check_contains "names the image at the pointer it requires" \
	"the prod deploy does not name testcabinet.azurecr.io/console.testcabinet.ai:fedcba9876543210fedcba9876543210fedcba98" \
	"$out"

echo "--- the console's image at the superrepo's commit ---"

tree="$(fresh_tree)"
cat >>"$tree/overlays/staging/kustomization.yaml" <<'YAML'
  - target: { kind: Deployment, name: tcab-web }
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/image
        value: testcabinet.azurecr.io/console.testcabinet.ai:0123456789abcdef0123456789abcdef01234567
YAML
out="$(check "$tree")"
status=$?
check_failed "fails" "$status"
check_contains "names the image and what it is pinned to" \
	"the staging deploy names testcabinet.azurecr.io/console.testcabinet.ai:0123456789abcdef0123456789abcdef01234567, not testcabinet.azurecr.io/<repository>:<the commit its submodule pointer names>" "$out"

echo "--- the driver built here rather than in its repository ---"

# A patch after the pin's, as an overlay could carry, that puts the dispatcher's
# driver image and run-container tag back at the superrepo's commit.
dispatcher_env_patch() { # tree overlay name value
	cat >>"$1/overlays/$2/kustomization.yaml" <<YAML
  - target: { kind: Deployment, name: tcab-dispatcher }
    patch: |-
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: tcab-dispatcher
      spec:
        template:
          spec:
            containers:
              - name: dispatcher
                env:
                  - name: $3
                    value: "$4"
YAML
}

tree="$(fresh_tree)"
dispatcher_env_patch "$tree" staging TCAB_DRIVER_IMAGE \
	testcabinet.azurecr.io/tcab-driver:0123456789abcdef0123456789abcdef01234567
out="$(check "$tree")"
status=$?
check_failed "fails" "$status"
check_contains "names the driver image at the pointer it requires" \
	"the staging deploy does not name testcabinet.azurecr.io/microservice-driver:cdef0123456789abcdef0123456789abcdef0123" \
	"$out"

tree="$(fresh_tree)"
dispatcher_env_patch "$tree" prod TCAB_CONTAINER_TAG 0123456789abcdef0123456789abcdef01234567
out="$(check "$tree")"
status=$?
check_failed "a run-container tag at the superrepo's commit fails" "$status"
check_contains "naming the tag and the driver's pointer" \
	"the prod deploy sets the dispatcher's TCAB_CONTAINER_TAG to '0123456789abcdef0123456789abcdef01234567', not cdef0123456789abcdef0123456789abcdef0123" \
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
