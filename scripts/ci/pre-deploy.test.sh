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
IMAGES="tcab-backend tcab-auth-service tcab-dispatcher tcab-driver tcab-artifacts tcab-arena tcab-publisher tcab-web"

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
		printf 'patches:\n  - path: patch-env.yaml\n'
	} >"$repo/deployments/k8s/overlays/staging/kustomization.yaml"
	cp "$repo/deployments/k8s/overlays/staging/kustomization.yaml" "$repo/unpinned.yaml"

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
			"${assignments[@]}" "$repo/scripts/ci/pre-deploy.sh" "$@" 2>&1
	)
}

echo "--- --dry-run ---"

repo="$(fresh_repo)"
out="$(run "$repo" -- --dry-run staging "$COMMIT")"
status=$?
check_equal "passes" 0 "$status"
for image in $IMAGES; do
	case "$image" in tcab-driver | tcab-publisher) continue ;; esac
	check_contains "shows ${image} pinned" "${image/tcab-backend/the-test-cabinet-backend}:${COMMIT}" "$out"
done
check_contains "shows the dispatcher's driver image" "value: \"testcabinet.azurecr.io/tcab-driver:${COMMIT}\"" "$out"
check_contains "shows the dispatcher's publisher image" "value: \"testcabinet.azurecr.io/tcab-publisher:${COMMIT}\"" "$out"
check_contains "shows the dispatcher's run-container tag" "name: TCAB_CONTAINER_TAG" "$out"
check_contains "shows the read of the backend" "kubectl -n tcab-staging get deployment the-test-cabinet-backend --ignore-not-found" "$out"
check_contains "shows the read of the legacy backend" "kubectl -n tcab-staging get deployment tcab-backend --ignore-not-found" "$out"
check_contains "shows the retirement" "kubectl -n tcab-staging delete deployment tcab-backend --ignore-not-found" "$out"
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
check_equal "pins all eight images in place" 8 "$(grep -c "newTag: \"${COMMIT}\"" <<<"$overlay")"
check_contains "adds the dispatcher's patch in place" "TCAB_PUBLISHER_IMAGE" "$overlay"
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
check_contains "retires tcab-backend in tcab-staging" "kubectl -n tcab-staging delete deployment tcab-backend" \
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

echo "--- the read fails ---"

repo="$(fresh_repo)"
out="$(run "$repo" STUB_AZ_EXIT_CODE=1 -- staging "$COMMIT")"
status=$?
check_failed "fails" "$status"
check_equal "retires nothing" 1 "$(wc -l <"$repo/az.log")"
check_lacks "sets no rollout timeout" "THE_TEST_CABINET_ROLLOUT_TIMEOUT" "$out"

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
