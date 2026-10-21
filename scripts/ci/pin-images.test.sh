#!/usr/bin/env bash
# Table test for pin-images.sh. Run it directly: ./pin-images.test.sh
#
# Each case pins a temporary copy of this checkout's deployments/k8s, named to the
# script by TCAB_K8S_ROOT, so the checkout itself is never touched. The subject is
# the kustomization it writes: the six images this repository builds at the
# commit, the dispatcher's and the repos service's images at the commits their
# submodule pointers name, the dispatcher's patch once however often it runs, and
# its refusals. The pointers are handed to the script with TCAB_PIN_GITLINKS, since
# the commits pinned here are not in any checkout, except in the case that reads
# them from this checkout's HEAD.
#
# The script ends by rendering the pinned overlay with kubectl. Where kubectl is
# absent, a stub that renders nothing stands in for it, and the cases that need a
# real render say they were skipped.
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

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

COMMIT="0123456789abcdef0123456789abcdef01234567"
OTHER="fedcba9876543210fedcba9876543210fedcba98"
REPOS="89abcdef0123456789abcdef0123456789abcdef"
REPOS_OTHER="76543210fedcba9876543210fedcba9876543210"
DISPATCHER="456789abcdef0123456789abcdef0123456789ab"
DISPATCHER_OTHER="3210fedcba9876543210fedcba9876543210fedc"

stub_path=""
real_kubectl=1
if ! command -v kubectl >/dev/null 2>&1; then
	real_kubectl=""
	mkdir -p "$tmp/bin"
	printf '#!/usr/bin/env bash\nexit 0\n' >"$tmp/bin/kubectl"
	chmod +x "$tmp/bin/kubectl"
	stub_path="$tmp/bin:"
	echo "(no kubectl here: a stub renders nothing, and the render checks are skipped)"
fi

fresh_tree() {
	local tree
	tree="$(mktemp -d "$tmp/treeXXXXXX")"
	cp -R "$K8S" "$tree/k8s"
	printf '%s' "$tree/k8s"
}

pin() { # tree overlay commit [repos-pointer] [dispatcher-pointer]
	(cd / && env PATH="${stub_path}$PATH" TCAB_K8S_ROOT="$1" \
		TCAB_PIN_GITLINKS="microservice-dispatcher=${5:-$DISPATCHER} microservice-repos=${4:-$REPOS}" \
		"$CI_DIR/pin-images.sh" "$2" "$3" 2>&1)
}

for overlay in staging prod; do
	echo "--- ${overlay}: eight pins ---"
	tree="$(fresh_tree)"
	out="$(pin "$tree" "$overlay" "$COMMIT")"
	status=$?
	check_equal "passes" 0 "$status"
	kustomization="$(cat "$tree/overlays/${overlay}/kustomization.yaml")"
	check_equal "the six images this repository builds are at the commit" 6 \
		"$(grep -c "^    newTag: \"${COMMIT}\"$" <<<"$kustomization")"
	check_contains "the repos image is at its submodule pointer" \
		"$(printf '  - name: REPLACE_REGISTRY/tcab-repos\n    newName: testcabinet.azurecr.io/microservice-repos\n    newTag: "%s"' "$REPOS")" \
		"$kustomization"
	check_contains "the dispatcher image is at its submodule pointer" \
		"$(printf '  - name: REPLACE_REGISTRY/tcab-dispatcher\n    newName: testcabinet.azurecr.io/microservice-dispatcher\n    newTag: "%s"' "$DISPATCHER")" \
		"$kustomization"
	check_equal "none is left unpinned" 0 "$(grep -c 'newTag: unpinned' <<<"$kustomization")"
	check_contains "the dispatcher's driver image is at the commit" \
		"value: \"testcabinet.azurecr.io/tcab-driver:${COMMIT}\"" "$kustomization"
	check_contains "the dispatcher's publisher image is at the commit" \
		"value: \"testcabinet.azurecr.io/tcab-publisher:${COMMIT}\"" "$kustomization"
	check_contains "the run-container registry is the ACR" "value: \"testcabinet.azurecr.io\"" "$kustomization"
	if [ -n "$real_kubectl" ]; then
		rendered="$(kubectl kustomize "$tree/overlays/${overlay}")"
		check_contains "the render runs the backend at the commit" \
			"image: testcabinet.azurecr.io/the-test-cabinet-backend:${COMMIT}" "$rendered"
		check_contains "the render sets the run-container tag" "value: ${COMMIT}" "$rendered"
		check_contains "the render runs the repos service at its pointer" \
			"image: testcabinet.azurecr.io/microservice-repos:${REPOS}" "$rendered"
		check_contains "the render runs the dispatcher at its pointer" \
			"image: testcabinet.azurecr.io/microservice-dispatcher:${DISPATCHER}" "$rendered"
		check_equal "the render names no superrepo-built dispatcher image" 0 \
			"$(grep -c 'azurecr.io/tcab-dispatcher:' <<<"$rendered")"
		check_equal "the render names no unpinned image" 0 "$(grep -c ':unpinned' <<<"$rendered")"
	fi

	echo "--- ${overlay}: idempotent ---"
	pin "$tree" "$overlay" "$COMMIT" >/dev/null
	check_equal "a second run with the same commit changes nothing" "$kustomization" \
		"$(cat "$tree/overlays/${overlay}/kustomization.yaml")"
	pin "$tree" "$overlay" "$OTHER" "$REPOS_OTHER" "$DISPATCHER_OTHER" >/dev/null
	kustomization="$(cat "$tree/overlays/${overlay}/kustomization.yaml")"
	check_equal "a run with another commit moves all six" 6 "$(grep -c "^    newTag: \"${OTHER}\"$" <<<"$kustomization")"
	check_equal "and the repos image to the other pointer" 1 "$(grep -c "^    newTag: \"${REPOS_OTHER}\"$" <<<"$kustomization")"
	check_equal "and the dispatcher image to the other pointer" 1 \
		"$(grep -c "^    newTag: \"${DISPATCHER_OTHER}\"$" <<<"$kustomization")"
	check_equal "and leaves the first commit nowhere" 0 "$(grep -c "$COMMIT" <<<"$kustomization")"
	check_equal "and the first pointers nowhere" 0 "$(grep -cE "$REPOS|$DISPATCHER" <<<"$kustomization")"
	check_equal "the dispatcher's patch is there once" 1 \
		"$(grep -c '^  # BEGIN scripts/ci/pin-images.sh' <<<"$kustomization")"
done

echo "--- a value that is not a commit ---"

tree="$(fresh_tree)"
before="$(cat "$tree/overlays/staging/kustomization.yaml")"
for value in abc123 "${COMMIT^^}" "${COMMIT}0" "latest"; do
	out="$(pin "$tree" staging "$value")"
	status=$?
	check_failed "refuses '${value}'" "$status"
done
check_contains "names the value" "is not a commit" "$out"
check_equal "leaves the overlay as it was" "$before" "$(cat "$tree/overlays/staging/kustomization.yaml")"

echo "--- an overlay other than staging or prod ---"

out="$(pin "$tree" local "$COMMIT")"
status=$?
check_failed "fails" "$status"
check_contains "names the overlays it pins" "expected staging or prod" "$out"

echo "--- an images block missing one of the eight ---"

tree="$(fresh_tree)"
sed -i '/REPLACE_REGISTRY\/tcab-arena$/,+2d' "$tree/overlays/prod/kustomization.yaml"
before="$(cat "$tree/overlays/prod/kustomization.yaml")"
out="$(pin "$tree" prod "$COMMIT")"
status=$?
check_failed "fails" "$status"
check_contains "counts the images it found" "names 7 of the 8 Test Cabinet images" "$out"
check_equal "leaves the overlay as it was" "$before" "$(cat "$tree/overlays/prod/kustomization.yaml")"

echo "--- a submodule pointer that cannot be read ---"

tree="$(fresh_tree)"
before="$(cat "$tree/overlays/staging/kustomization.yaml")"
# No TCAB_PIN_GITLINKS: the pointer is read from the commit's tree, and this checkout
# holds no such commit.
out="$(cd / && env PATH="${stub_path}$PATH" TCAB_K8S_ROOT="$tree" "$CI_DIR/pin-images.sh" staging "$COMMIT" 2>&1)"
status=$?
check_failed "fails" "$status"
check_contains "names the pointer and the commit" \
	"tcab-dispatcher is pinned to the commit the submodule pointer microservice-dispatcher names at ${COMMIT}" "$out"
check_equal "leaves the overlay as it was" "$before" "$(cat "$tree/overlays/staging/kustomization.yaml")"
# Only the repos pointer named: the dispatcher's is read from the commit's tree.
out="$(cd / && env PATH="${stub_path}$PATH" TCAB_K8S_ROOT="$tree" TCAB_PIN_GITLINKS="microservice-repos=${REPOS}" \
	"$CI_DIR/pin-images.sh" staging "$COMMIT" 2>&1)"
status=$?
check_failed "fails without the dispatcher's pointer" "$status"
check_contains "names the dispatcher's pointer" "submodule pointer microservice-dispatcher names" "$out"
for value in abc123 "${REPOS^^}"; do
	out="$(pin "$tree" staging "$COMMIT" "$value")"
	status=$?
	check_failed "refuses the repos pointer '${value}'" "$status"
	out="$(pin "$tree" staging "$COMMIT" "$REPOS" "$value")"
	status=$?
	check_failed "refuses the dispatcher pointer '${value}'" "$status"
done
check_equal "leaves the overlay as it was after the refusals" "$before" \
	"$(cat "$tree/overlays/staging/kustomization.yaml")"

echo "--- the submodule pointer of a commit this checkout holds ---"

head="$(git -C "$CI_DIR" rev-parse --verify --quiet HEAD 2>/dev/null || true)"
gitlink="$(git -C "$CI_DIR" ls-tree "${head:-HEAD}" -- ../../microservice-repos 2>/dev/null | awk '$1 == "160000" { print $3 }')"
dispatcher_gitlink="$(git -C "$CI_DIR" ls-tree "${head:-HEAD}" -- ../../microservice-dispatcher 2>/dev/null |
	awk '$1 == "160000" { print $3 }')"
if [ -n "$head" ] && [ -n "$gitlink" ] && [ -n "$dispatcher_gitlink" ]; then
	tree="$(fresh_tree)"
	out="$(cd / && env PATH="${stub_path}$PATH" TCAB_K8S_ROOT="$tree" "$CI_DIR/pin-images.sh" prod "$head" 2>&1)"
	status=$?
	check_equal "passes" 0 "$status"
	check_contains "pins the repos image to the pointer in that commit's tree" \
		"newTag: \"${gitlink}\"" "$(cat "$tree/overlays/prod/kustomization.yaml")"
	check_contains "pins the dispatcher image to the pointer in that commit's tree" \
		"newTag: \"${dispatcher_gitlink}\"" "$(cat "$tree/overlays/prod/kustomization.yaml")"
else
	ok "(skipped: this checkout has no commit holding the microservice-repos and microservice-dispatcher pointers)"
fi

echo "--- an image the pin does not reach ---"

if [ -n "$real_kubectl" ]; then
	tree="$(fresh_tree)"
	# A ninth image the overlay names at `unpinned`, which the eight do not include.
	cat >>"$tree/overlays/staging/kustomization.yaml" <<'YAML'
  - target: { kind: Deployment, name: tcab-arena }
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/image
        value: testcabinet.azurecr.io/tcab-extra:unpinned
YAML
	out="$(pin "$tree" staging "$COMMIT")"
	status=$?
	check_failed "fails" "$status"
	check_contains "names the unpinned image" "tcab-extra:unpinned" "$out"
else
	ok "(skipped: needs a real kubectl render)"
fi

echo
echo "pin-images.test.sh: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
