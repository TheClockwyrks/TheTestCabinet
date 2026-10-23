#!/usr/bin/env bash
# Table test for pre-deploy.sh. Run it directly: ./pre-deploy.test.sh
#
# No case reaches Azure or a cluster. Each builds a throwaway repository holding the
# scripts pre-deploy.sh runs, a small staging overlay, and stubs of kubectl and az
# first on PATH. The kubectl stub renders one `image:` line per entry of the
# overlay's images block, at the tag it names. The az stub records each invocation
# and the file it uploads, and answers the backend read with the Deployment and
# image the case declares.
#
# The subject is the order and content of what it does: the pin, the one read, the
# pipeline variables it sets from that read, and the retirement of the legacy
# Deployment; and that --dry-run shows all of it and runs none of it.
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
	echo "jq is not installed here; skipping the pre-deploy test."
	exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

COMMIT="0123456789abcdef0123456789abcdef01234567"
PREVIOUS="89abcdef0123456789abcdef0123456789abcdef"
IMAGES="tcab-backend"
# The repos service's image, built in microservice-repos and pinned to the submodule
# pointer, which the throwaway repository holds no commit for: TCAB_PIN_GITLINKS
# names it.
REPOS="76543210fedcba9876543210fedcba9876543210"
# The dispatcher's image, built in microservice-dispatcher and pinned the same way.
DISPATCHER="456789abcdef0123456789abcdef0123456789ab"
# The driver's image and the run images, built in microservice-driver and pinned the
# same way.
DRIVER="cdef0123456789abcdef0123456789abcdef0123"
# The artifacts service's image, built in microservice-artifacts and pinned the same
# way.
ARTIFACTS="abcdef0123456789abcdef0123456789abcdef01"
# The arena's image, built in microservice-arena and pinned the same way.
ARENA="9876543210abcdef9876543210abcdef98765432"
# The console's image, built in console.testcabinet.ai and pinned the same way.
CONSOLE="02468ace13579bdf02468ace13579bdf02468ace"
# The publisher's image, built in microservice-publisher and pinned the same way.
PUBLISHER="2468ace013579bdf2468ace013579bdf2468ace0"

fresh_repo() {
	local repo image
	repo="$(mktemp -d "$tmp/repoXXXXXX")"
	mkdir -p "$repo/scripts/ci" "$repo/bin" "$repo/sent" "$repo/deployments/k8s/overlays/staging"
	cp "$CI_DIR/lib.sh" "$CI_DIR/tcab-lib.sh" "$CI_DIR/pin-images.sh" "$CI_DIR/pre-deploy.sh" \
		"$CI_DIR/retire-legacy-backend.sh" "$repo/scripts/ci/"
	{
		printf 'apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: tcab-staging\n'
		printf 'images:\n'
		for image in $IMAGES; do
			printf '  - name: REPLACE_REGISTRY/%s\n    newName: testcabinet.azurecr.io/%s\n    newTag: unpinned\n' \
				"$image" "${image/tcab-backend/the-test-cabinet-backend}"
		done
		printf '  - name: REPLACE_REGISTRY/tcab-arena\n    newName: testcabinet.azurecr.io/microservice-arena\n    newTag: unpinned\n'
		printf '  - name: REPLACE_REGISTRY/tcab-artifacts\n    newName: testcabinet.azurecr.io/microservice-artifacts\n    newTag: unpinned\n'
		printf '  - name: REPLACE_REGISTRY/tcab-dispatcher\n    newName: testcabinet.azurecr.io/microservice-dispatcher\n    newTag: unpinned\n'
		printf '  - name: REPLACE_REGISTRY/tcab-driver\n    newName: testcabinet.azurecr.io/microservice-driver\n    newTag: unpinned\n'
		printf '  - name: REPLACE_REGISTRY/tcab-publisher\n    newName: testcabinet.azurecr.io/microservice-publisher\n    newTag: unpinned\n'
		printf '  - name: REPLACE_REGISTRY/tcab-repos\n    newName: testcabinet.azurecr.io/microservice-repos\n    newTag: unpinned\n'
		printf '  - name: REPLACE_REGISTRY/tcab-web\n    newName: testcabinet.azurecr.io/console.testcabinet.ai\n    newTag: unpinned\n'
		printf 'patches:\n  - path: patch-env.yaml\n'
	} >"$repo/deployments/k8s/overlays/staging/kustomization.yaml"
	cp "$repo/deployments/k8s/overlays/staging/kustomization.yaml" "$repo/unpinned.yaml"

	# Stands in for the catalog check: records its arguments and exits with the
	# status the case declares.
	cat >"$repo/scripts/ci/catalog-ingest.sh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$(dirname "$0")/../../catalog.log"
exit "${STUB_CATALOG_EXIT:-0}"
STUB
	chmod +x "$repo/scripts/ci/catalog-ingest.sh"

	cat >"$repo/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = "kustomize" ] || { echo "kubectl stub: $*" >&2; exit 1; }
awk '
	/^  - name: / { name = $3 }
	/^    newName: / { name = $2 }
	/^    newTag: / { tag = $2; gsub(/"/, "", tag); print "        image: " name ":" tag }
	/name: TCAB_/ { print }
	/value: "testcabinet/ { print }
' "$2/kustomization.yaml"
# A case that binds a workload to an identity drops its rendered objects beside it.
if [ -f "$2/identity.yaml" ]; then echo "---"; cat "$2/identity.yaml"; fi
STUB
	chmod +x "$repo/bin/kubectl"

	cat >"$repo/bin/az" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$STUB_AZ_LOG"
command=""
while [ $# -gt 0 ]; do
	case "$1" in
		--file) cp "$2" "$STUB_SENT/" ;;
		--command) command="$2" ;;
	esac
	shift
done
logs="done"
[ "$command" = "sh read-backend-commit.sh" ] && logs="${STUB_BACKEND_LINE:-BACKEND none}"
jq -n --arg logs "$logs" --argjson code "${STUB_AZ_EXIT_CODE:-0}" \
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
			TCAB_PIN_GITLINKS="microservice-arena=${ARENA} microservice-artifacts=${ARTIFACTS} microservice-dispatcher=${DISPATCHER} microservice-driver=${DRIVER} microservice-repos=${REPOS} console.testcabinet.ai=${CONSOLE} microservice-publisher=${PUBLISHER}" \
			"${assignments[@]}" "$repo/scripts/ci/pre-deploy.sh" "$@" 2>&1
	)
}

echo "--- --dry-run ---"

repo="$(fresh_repo)"
out="$(run "$repo" -- --dry-run staging "$COMMIT")"
status=$?
check_equal "passes" 0 "$status"
for image in $IMAGES; do
	check_contains "shows ${image} pinned" "${image/tcab-backend/the-test-cabinet-backend}:${COMMIT}" "$out"
done
check_contains "shows the repos image pinned to its pointer" "microservice-repos:${REPOS}" "$out"
check_contains "shows the dispatcher image pinned to its pointer" "microservice-dispatcher:${DISPATCHER}" "$out"
check_contains "shows the artifacts image pinned to its pointer" "microservice-artifacts:${ARTIFACTS}" "$out"
check_contains "shows the arena image pinned to its pointer" "microservice-arena:${ARENA}" "$out"
check_contains "shows the console image pinned to its pointer" "console.testcabinet.ai:${CONSOLE}" "$out"
check_contains "shows the dispatcher's driver image pinned to its pointer" \
	"value: \"testcabinet.azurecr.io/microservice-driver:${DRIVER}\"" "$out"
check_contains "shows the publisher image pinned to its pointer" "microservice-publisher:${PUBLISHER}" "$out"
check_contains "shows the dispatcher's publisher image pinned to its pointer" \
	"value: \"testcabinet.azurecr.io/microservice-publisher:${PUBLISHER}\"" "$out"
check_contains "shows the dispatcher's run-container tag" "name: TCAB_CONTAINER_TAG" "$out"
check_contains "shows the read of the backend" "kubectl -n tcab-staging get deployment the-test-cabinet-backend --ignore-not-found" "$out"
check_contains "shows the read of the legacy backend" "kubectl -n tcab-staging get deployment tcab-backend --ignore-not-found" "$out"
check_contains "shows the retirement" "kubectl -n tcab-staging delete deployment/tcab-backend statefulset/tcab-artifacts ingress/tcab-api" "$out"
check_contains "and the edge's predecessors" "deployment/tcab-auth service/tcab-auth serviceaccount/tcab-auth secret/tcab-auth-secrets --ignore-not-found" "$out"
check_contains "shows the catalog check" "scripts/ci/catalog-ingest.sh preflight staging $COMMIT" "$out"
check_equal "checks no catalog" "" "$(cat "$repo/catalog.log" 2>/dev/null)"
check_equal "reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"
check_equal "leaves the overlay as it was" "$(cat "$repo/unpinned.yaml")" \
	"$(cat "$repo/deployments/k8s/overlays/staging/kustomization.yaml")"
check_lacks "sets no pipeline variable" "##vso" "$out"

echo "--- a namespace whose backend runs under its new name ---"

repo="$(fresh_repo)"
out="$(run "$repo" THE_TEST_CABINET_RESOURCE_GROUP=case-rg THE_TEST_CABINET_CLUSTER=case-aks \
	STUB_BACKEND_LINE="BACKEND the-test-cabinet-backend testcabinet.azurecr.io/the-test-cabinet-backend:${PREVIOUS}" \
	-- staging "$COMMIT")"
status=$?
check_equal "passes" 0 "$status"
overlay="$(cat "$repo/deployments/k8s/overlays/staging/kustomization.yaml")"
check_equal "pins the backend in place" 1 "$(grep -c "newTag: \"${COMMIT}\"" <<<"$overlay")"
check_contains "pins the repos image to its pointer in place" "newTag: \"${REPOS}\"" "$overlay"
check_contains "pins the dispatcher image to its pointer in place" "newTag: \"${DISPATCHER}\"" "$overlay"
check_contains "pins the driver image to its pointer in place" "newTag: \"${DRIVER}\"" "$overlay"
check_contains "pins the artifacts image to its pointer in place" "newTag: \"${ARTIFACTS}\"" "$overlay"
check_contains "pins the arena image to its pointer in place" "newTag: \"${ARENA}\"" "$overlay"
check_contains "pins the console image to its pointer in place" "newTag: \"${CONSOLE}\"" "$overlay"
check_contains "pins the publisher image to its pointer in place" "newTag: \"${PUBLISHER}\"" "$overlay"
check_contains "and the dispatcher's run-container tag with it" \
	"$(printf -- '- name: TCAB_CONTAINER_TAG\n                    value: "%s"' "$DRIVER")" "$overlay"
check_contains "adds the dispatcher's patch in place" "TCAB_PUBLISHER_IMAGE" "$overlay"
check_equal "checks the catalog of the overlay's branch" "preflight staging $COMMIT" "$(cat "$repo/catalog.log" 2>/dev/null)"
check_equal "hands the cluster two commands" 2 "$(wc -l <"$repo/az.log")"
check_contains "reads first" "--command sh read-backend-commit.sh" "$(sed -n 1p "$repo/az.log")"
check_contains "retires second" "--command sh retire-legacy-backend.sh" "$(sed -n 2p "$repo/az.log")"
check_contains "names the resource group it was given" "--resource-group case-rg" "$(sed -n 2p "$repo/az.log")"
check_contains "the read asks the new name first" "get deployment the-test-cabinet-backend" \
	"$(sed -n 2p "$repo/sent/read-backend-commit.sh")"
check_contains "sets the previous commit" "##vso[task.setvariable variable=TCAB_PREVIOUS_COMMIT]${PREVIOUS}" "$out"
check_contains "sets the Deployment it came from" \
	"##vso[task.setvariable variable=TCAB_PREVIOUS_BACKEND]the-test-cabinet-backend" "$out"
check_contains "sets the rollout timeout" "##vso[task.setvariable variable=THE_TEST_CABINET_ROLLOUT_TIMEOUT]600s" "$out"
check_contains "retires tcab-backend in tcab-staging" "kubectl -n tcab-staging delete deployment/tcab-backend" \
	"$(cat "$repo/sent/retire-legacy-backend.sh")"

echo "--- the first deployment after the rename ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_BACKEND_LINE="BACKEND tcab-backend testcabinet.azurecr.io/tcab-backend:${PREVIOUS}" \
	-- staging "$COMMIT")"
check_contains "records the legacy commit" "##vso[task.setvariable variable=TCAB_PREVIOUS_COMMIT]${PREVIOUS}" "$out"
check_contains "records that it was the legacy Deployment" \
	"##vso[task.setvariable variable=TCAB_PREVIOUS_BACKEND]tcab-backend" "$out"

echo "--- a namespace with no backend ---"

repo="$(fresh_repo)"
out="$(run "$repo" -- staging "$COMMIT")"
status=$?
check_equal "passes" 0 "$status"
check_contains "sets an empty previous commit" "##vso[task.setvariable variable=TCAB_PREVIOUS_COMMIT]"$'\n' "$out"$'\n'

echo "--- a catalog that cannot be fetched ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_CATALOG_EXIT=1 -- staging "$COMMIT")"
status=$?
check_failed "fails" "$status"
check_contains "says nothing was applied" "the staging deploy preflight failed, above; nothing was applied" "$out"
check_equal "reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"
check_equal "pins nothing" "$(cat "$repo/unpinned.yaml")" \
	"$(cat "$repo/deployments/k8s/overlays/staging/kustomization.yaml")"
check_lacks "sets no pipeline variable" "##vso" "$out"

echo "--- the read fails ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_AZ_EXIT_CODE=1 -- staging "$COMMIT")"
status=$?
check_failed "fails" "$status"
check_equal "retires nothing" 1 "$(wc -l <"$repo/az.log")"
check_lacks "sets no rollout timeout" "THE_TEST_CABINET_ROLLOUT_TIMEOUT" "$out"

echo "--- an overlay bound to an unprovisioned identity ---"

repo="$(fresh_repo)"
cat >"$repo/deployments/k8s/overlays/staging/identity.yaml" <<'YAML'
apiVersion: v1
kind: ServiceAccount
metadata:
  annotations:
    azure.workload.identity/client-id: unprovisioned
  name: tcab-artifacts
  namespace: tcab-staging
YAML
out="$(run "$repo" -- staging "$COMMIT")"
status=$?
check_failed "fails" "$status"
check_contains "naming the identity" "unprovisioned workload identity: ServiceAccount/tcab-artifacts" "$out"
check_contains "and the trees to move" "artifacts-tcab-artifacts-0 in tcab-staging" "$out"
check_contains "with the script that moves them" "scripts/ci/copy-artifact-trees.sh staging" "$out"
check_equal "reads and retires nothing" "" "$(cat "$repo/az.log" 2>/dev/null)"

repo="$(fresh_repo)"
cat >"$repo/deployments/k8s/overlays/staging/identity.yaml" <<'YAML'
apiVersion: v1
kind: ServiceAccount
metadata:
  annotations:
    azure.workload.identity/client-id: 3874c619-95e8-4392-a819-284978fb6d12
  name: tcab-artifacts
  namespace: tcab-staging
YAML
out="$(run "$repo" -- staging "$COMMIT")"
status=$?
check_equal "a provisioned identity passes" 0 "$status"

echo "--- refusals ---"

repo="$(fresh_repo)"
out="$(run "$repo" -- staging abc123)"
status=$?
check_failed "a value that is not a commit fails" "$status"
check_contains "names the value" "'abc123' is not a commit" "$out"
out="$(run "$repo" -- local "$COMMIT")"
status=$?
check_failed "an overlay other than staging or prod fails" "$status"
check_equal "reaches no cluster" "" "$(cat "$repo/az.log" 2>/dev/null)"

echo
echo "pre-deploy.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
