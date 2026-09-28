#!/usr/bin/env bash
# Table test for pin-images.sh. Run it directly: ./pin-images.test.sh
#
# Each case pins a temporary copy of this checkout's deployments/k8s, named to the
# script by TCAB_K8S_ROOT, so the checkout itself is never touched. The subject is
# the kustomization it writes: all eight images at the commit, the dispatcher's
# patch once however often it runs, and its refusals.
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

pin() { # tree overlay commit
	(cd / && env PATH="${stub_path}$PATH" TCAB_K8S_ROOT="$1" "$CI_DIR/pin-images.sh" "$2" "$3" 2>&1)
}

for overlay in staging prod; do
	echo "--- ${overlay}: eight pins ---"
	tree="$(fresh_tree)"
	out="$(pin "$tree" "$overlay" "$COMMIT")"
	status=$?
	check_equal "passes" 0 "$status"
	kustomization="$(cat "$tree/overlays/${overlay}/kustomization.yaml")"
	check_equal "all eight images are at the commit" 8 "$(grep -c "^    newTag: \"${COMMIT}\"$" <<<"$kustomization")"
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
		check_equal "the render names no unpinned image" 0 "$(grep -c ':unpinned' <<<"$rendered")"
	fi

	echo "--- ${overlay}: idempotent ---"
	pin "$tree" "$overlay" "$COMMIT" >/dev/null
	check_equal "a second run with the same commit changes nothing" "$kustomization" \
		"$(cat "$tree/overlays/${overlay}/kustomization.yaml")"
	pin "$tree" "$overlay" "$OTHER" >/dev/null
	kustomization="$(cat "$tree/overlays/${overlay}/kustomization.yaml")"
	check_equal "a run with another commit moves all eight" 8 "$(grep -c "^    newTag: \"${OTHER}\"$" <<<"$kustomization")"
	check_equal "and leaves the first commit nowhere" 0 "$(grep -c "$COMMIT" <<<"$kustomization")"
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
