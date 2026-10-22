#!/usr/bin/env bash
# Table test for pin-images.sh. Run it directly: ./pin-images.test.sh
#
# Each case pins a temporary copy of this checkout's deployments/k8s, named to the
# script by TCAB_K8S_ROOT, so the checkout itself is never touched. The subject is
# the kustomization it writes: the two images this repository builds at the
# commit, the arena's, the artifacts service's, the dispatcher's, the driver's, the
# repos service's and the console's images at the commits their submodule pointers
# name, the
# dispatcher's patch (its driver image
# and run-container tag at the driver's pointer) once however often it runs, and
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
DRIVER="cdef0123456789abcdef0123456789abcdef0123"
DRIVER_OTHER="ba9876543210fedcba9876543210fedcba987654"
ARTIFACTS="abcdef0123456789abcdef0123456789abcdef01"
ARTIFACTS_OTHER="6543210fedcba9876543210fedcba9876543210f"
ARENA="9876543210abcdef9876543210abcdef98765432"
ARENA_OTHER="13579bdf02468ace13579bdf02468ace13579bdf"
CONSOLE="02468ace13579bdf02468ace13579bdf02468ace"
CONSOLE_OTHER="eca86420fdb97531eca86420fdb97531eca86420"

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

pin() { # tree overlay commit [repos-pointer] [dispatcher-pointer] [driver-pointer] [artifacts-pointer] [arena-pointer] [console-pointer]
	(cd / && env PATH="${stub_path}$PATH" TCAB_K8S_ROOT="$1" \
		TCAB_PIN_GITLINKS="microservice-arena=${8:-$ARENA} microservice-artifacts=${7:-$ARTIFACTS} microservice-dispatcher=${5:-$DISPATCHER} microservice-driver=${6:-$DRIVER} microservice-repos=${4:-$REPOS} console.testcabinet.ai=${9:-$CONSOLE}" \
		"$CI_DIR/pin-images.sh" "$2" "$3" 2>&1)
}

for overlay in staging prod; do
	echo "--- ${overlay}: eight pins ---"
	tree="$(fresh_tree)"
	out="$(pin "$tree" "$overlay" "$COMMIT")"
	status=$?
	check_equal "passes" 0 "$status"
	kustomization="$(cat "$tree/overlays/${overlay}/kustomization.yaml")"
	check_equal "the two images this repository builds are at the commit" 2 \
		"$(grep -c "^    newTag: \"${COMMIT}\"$" <<<"$kustomization")"
	check_contains "the repos image is at its submodule pointer" \
		"$(printf '  - name: REPLACE_REGISTRY/tcab-repos\n    newName: testcabinet.azurecr.io/microservice-repos\n    newTag: "%s"' "$REPOS")" \
		"$kustomization"
	check_contains "the dispatcher image is at its submodule pointer" \
		"$(printf '  - name: REPLACE_REGISTRY/tcab-dispatcher\n    newName: testcabinet.azurecr.io/microservice-dispatcher\n    newTag: "%s"' "$DISPATCHER")" \
		"$kustomization"
	check_contains "the artifacts image is at its submodule pointer" \
		"$(printf '  - name: REPLACE_REGISTRY/tcab-artifacts\n    newName: testcabinet.azurecr.io/microservice-artifacts\n    newTag: "%s"' "$ARTIFACTS")" \
		"$kustomization"
	check_contains "the arena image is at its submodule pointer" \
		"$(printf '  - name: REPLACE_REGISTRY/tcab-arena\n    newName: testcabinet.azurecr.io/microservice-arena\n    newTag: "%s"' "$ARENA")" \
		"$kustomization"
	check_contains "the console image is at its submodule pointer" \
		"$(printf '  - name: REPLACE_REGISTRY/tcab-web\n    newName: testcabinet.azurecr.io/console.testcabinet.ai\n    newTag: "%s"' "$CONSOLE")" \
		"$kustomization"
	check_contains "the driver image is at its submodule pointer" \
		"$(printf '  - name: REPLACE_REGISTRY/tcab-driver\n    newName: testcabinet.azurecr.io/microservice-driver\n    newTag: "%s"' "$DRIVER")" \
		"$kustomization"
	check_equal "none is left unpinned" 0 "$(grep -c 'newTag: unpinned' <<<"$kustomization")"
	check_contains "the dispatcher's driver image is microservice-driver's at its pointer" \
		"value: \"testcabinet.azurecr.io/microservice-driver:${DRIVER}\"" "$kustomization"
	check_contains "the run-container tag is the driver's pointer" \
		"$(printf -- '- name: TCAB_CONTAINER_TAG\n                    value: "%s"' "$DRIVER")" "$kustomization"
	check_equal "no superrepo-built driver image is named" 0 "$(grep -c 'tcab-driver:' <<<"$kustomization")"
	check_contains "the dispatcher's publisher image is at the commit" \
		"value: \"testcabinet.azurecr.io/tcab-publisher:${COMMIT}\"" "$kustomization"
	check_contains "the run-container registry is the ACR" "value: \"testcabinet.azurecr.io\"" "$kustomization"
	if [ -n "$real_kubectl" ]; then
		rendered="$(kubectl kustomize "$tree/overlays/${overlay}")"
		check_contains "the render runs the backend at the commit" \
			"image: testcabinet.azurecr.io/the-test-cabinet-backend:${COMMIT}" "$rendered"
		check_contains "the render sets the run-container tag to the driver's pointer" "value: ${DRIVER}" "$rendered"
		check_contains "the render starts the driver at its pointer" \
			"value: testcabinet.azurecr.io/microservice-driver:${DRIVER}" "$rendered"
		check_contains "the render runs the repos service at its pointer" \
			"image: testcabinet.azurecr.io/microservice-repos:${REPOS}" "$rendered"
		check_contains "the render runs the dispatcher at its pointer" \
			"image: testcabinet.azurecr.io/microservice-dispatcher:${DISPATCHER}" "$rendered"
		check_contains "the render runs the artifacts service at its pointer" \
			"image: testcabinet.azurecr.io/microservice-artifacts:${ARTIFACTS}" "$rendered"
		check_contains "the render runs the arena at its pointer" \
			"image: testcabinet.azurecr.io/microservice-arena:${ARENA}" "$rendered"
		check_contains "the render runs the console at its pointer" \
			"image: testcabinet.azurecr.io/console.testcabinet.ai:${CONSOLE}" "$rendered"
		check_equal "the render names no superrepo-built console image" 0 \
			"$(grep -c 'azurecr.io/tcab-web:' <<<"$rendered")"
		check_equal "the render names no superrepo-built arena image" 0 \
			"$(grep -c 'azurecr.io/tcab-arena:' <<<"$rendered")"
		check_equal "the render names no superrepo-built artifacts image" 0 \
			"$(grep -c 'azurecr.io/tcab-artifacts:' <<<"$rendered")"
		check_equal "the render names no superrepo-built dispatcher image" 0 \
			"$(grep -c 'azurecr.io/tcab-dispatcher:' <<<"$rendered")"
		check_equal "the render names no unpinned image" 0 "$(grep -c ':unpinned' <<<"$rendered")"
	fi

	echo "--- ${overlay}: idempotent ---"
	pin "$tree" "$overlay" "$COMMIT" >/dev/null
	check_equal "a second run with the same commit changes nothing" "$kustomization" \
		"$(cat "$tree/overlays/${overlay}/kustomization.yaml")"
	pin "$tree" "$overlay" "$OTHER" "$REPOS_OTHER" "$DISPATCHER_OTHER" "$DRIVER_OTHER" "$ARTIFACTS_OTHER" "$ARENA_OTHER" \
		"$CONSOLE_OTHER" >/dev/null
	kustomization="$(cat "$tree/overlays/${overlay}/kustomization.yaml")"
	check_equal "a run with another commit moves both" 2 "$(grep -c "^    newTag: \"${OTHER}\"$" <<<"$kustomization")"
	check_equal "and the repos image to the other pointer" 1 "$(grep -c "^    newTag: \"${REPOS_OTHER}\"$" <<<"$kustomization")"
	check_equal "and the dispatcher image to the other pointer" 1 \
		"$(grep -c "^    newTag: \"${DISPATCHER_OTHER}\"$" <<<"$kustomization")"
	check_equal "and the artifacts image to the other pointer" 1 \
		"$(grep -c "^    newTag: \"${ARTIFACTS_OTHER}\"$" <<<"$kustomization")"
	check_equal "and the arena image to the other pointer" 1 \
		"$(grep -c "^    newTag: \"${ARENA_OTHER}\"$" <<<"$kustomization")"
	check_equal "and the console image to the other pointer" 1 \
		"$(grep -c "^    newTag: \"${CONSOLE_OTHER}\"$" <<<"$kustomization")"
	check_equal "and the driver image to the other pointer" 1 \
		"$(grep -c "^    newTag: \"${DRIVER_OTHER}\"$" <<<"$kustomization")"
	check_equal "and the dispatcher's driver image and run-container tag with it" 2 \
		"$(grep -c "value: .*${DRIVER_OTHER}\"$" <<<"$kustomization")"
	check_equal "and leaves the first commit nowhere" 0 "$(grep -c "$COMMIT" <<<"$kustomization")"
	check_equal "and the first pointers nowhere" 0 \
		"$(grep -cE "$REPOS|$DISPATCHER|$DRIVER|$ARTIFACTS|$ARENA|$CONSOLE" <<<"$kustomization")"
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
	"tcab-arena is pinned to the commit the submodule pointer microservice-arena names at ${COMMIT}" "$out"
check_equal "leaves the overlay as it was" "$before" "$(cat "$tree/overlays/staging/kustomization.yaml")"
# Only the repos pointer named: the arena's is read from the commit's tree.
out="$(cd / && env PATH="${stub_path}$PATH" TCAB_K8S_ROOT="$tree" TCAB_PIN_GITLINKS="microservice-repos=${REPOS}" \
	"$CI_DIR/pin-images.sh" staging "$COMMIT" 2>&1)"
status=$?
check_failed "fails without the arena's pointer" "$status"
check_contains "names the arena's pointer" "submodule pointer microservice-arena names" "$out"
# The arena's and the repos service's pointers named: the artifacts service's is
# read from the commit's tree.
out="$(cd / && env PATH="${stub_path}$PATH" TCAB_K8S_ROOT="$tree" \
	TCAB_PIN_GITLINKS="microservice-arena=${ARENA} microservice-repos=${REPOS}" \
	"$CI_DIR/pin-images.sh" staging "$COMMIT" 2>&1)"
status=$?
check_failed "fails without the artifacts service's pointer" "$status"
check_contains "names the artifacts service's pointer" "submodule pointer microservice-artifacts names" "$out"
# The arena's, the artifacts service's and the repos service's pointers named: the
# dispatcher's is read from the commit's tree.
out="$(cd / && env PATH="${stub_path}$PATH" TCAB_K8S_ROOT="$tree" \
	TCAB_PIN_GITLINKS="microservice-arena=${ARENA} microservice-artifacts=${ARTIFACTS} microservice-repos=${REPOS}" \
	"$CI_DIR/pin-images.sh" staging "$COMMIT" 2>&1)"
status=$?
check_failed "fails without the dispatcher's pointer" "$status"
check_contains "names the dispatcher's pointer" "submodule pointer microservice-dispatcher names" "$out"
# The arena's, the artifacts service's, the dispatcher's and the repos service's
# pointers named: the driver's is read from the commit's tree.
out="$(cd / && env PATH="${stub_path}$PATH" TCAB_K8S_ROOT="$tree" \
	TCAB_PIN_GITLINKS="microservice-arena=${ARENA} microservice-artifacts=${ARTIFACTS} microservice-dispatcher=${DISPATCHER} microservice-repos=${REPOS}" \
	"$CI_DIR/pin-images.sh" staging "$COMMIT" 2>&1)"
status=$?
check_failed "fails without the driver's pointer" "$status"
check_contains "names the driver's pointer" \
	"tcab-driver is pinned to the commit the submodule pointer microservice-driver names" "$out"
# Every microservice pointer named: the console's is read from the commit's tree.
out="$(cd / && env PATH="${stub_path}$PATH" TCAB_K8S_ROOT="$tree" \
	TCAB_PIN_GITLINKS="microservice-arena=${ARENA} microservice-artifacts=${ARTIFACTS} microservice-dispatcher=${DISPATCHER} microservice-driver=${DRIVER} microservice-repos=${REPOS}" \
	"$CI_DIR/pin-images.sh" staging "$COMMIT" 2>&1)"
status=$?
check_failed "fails without the console's pointer" "$status"
check_contains "names the console's pointer" \
	"tcab-web is pinned to the commit the submodule pointer console.testcabinet.ai names" "$out"
for value in abc123 "${REPOS^^}"; do
	out="$(pin "$tree" staging "$COMMIT" "$value")"
	status=$?
	check_failed "refuses the repos pointer '${value}'" "$status"
	out="$(pin "$tree" staging "$COMMIT" "$REPOS" "$value")"
	status=$?
	check_failed "refuses the dispatcher pointer '${value}'" "$status"
	out="$(pin "$tree" staging "$COMMIT" "$REPOS" "$DISPATCHER" "$value")"
	status=$?
	check_failed "refuses the driver pointer '${value}'" "$status"
	out="$(pin "$tree" staging "$COMMIT" "$REPOS" "$DISPATCHER" "$DRIVER" "$value")"
	status=$?
	check_failed "refuses the artifacts pointer '${value}'" "$status"
	out="$(pin "$tree" staging "$COMMIT" "$REPOS" "$DISPATCHER" "$DRIVER" "$ARTIFACTS" "$value")"
	status=$?
	check_failed "refuses the arena pointer '${value}'" "$status"
	out="$(pin "$tree" staging "$COMMIT" "$REPOS" "$DISPATCHER" "$DRIVER" "$ARTIFACTS" "$ARENA" "$value")"
	status=$?
	check_failed "refuses the console pointer '${value}'" "$status"
done
check_equal "leaves the overlay as it was after the refusals" "$before" \
	"$(cat "$tree/overlays/staging/kustomization.yaml")"

echo "--- the submodule pointer of a commit this checkout holds ---"

head="$(git -C "$CI_DIR" rev-parse --verify --quiet HEAD 2>/dev/null || true)"
gitlink="$(git -C "$CI_DIR" ls-tree "${head:-HEAD}" -- ../../microservice-repos 2>/dev/null | awk '$1 == "160000" { print $3 }')"
dispatcher_gitlink="$(git -C "$CI_DIR" ls-tree "${head:-HEAD}" -- ../../microservice-dispatcher 2>/dev/null |
	awk '$1 == "160000" { print $3 }')"
driver_gitlink="$(git -C "$CI_DIR" ls-tree "${head:-HEAD}" -- ../../microservice-driver 2>/dev/null |
	awk '$1 == "160000" { print $3 }')"
artifacts_gitlink="$(git -C "$CI_DIR" ls-tree "${head:-HEAD}" -- ../../microservice-artifacts 2>/dev/null |
	awk '$1 == "160000" { print $3 }')"
arena_gitlink="$(git -C "$CI_DIR" ls-tree "${head:-HEAD}" -- ../../microservice-arena 2>/dev/null |
	awk '$1 == "160000" { print $3 }')"
console_gitlink="$(git -C "$CI_DIR" ls-tree "${head:-HEAD}" -- ../../console.testcabinet.ai 2>/dev/null |
	awk '$1 == "160000" { print $3 }')"
if [ -n "$head" ] && [ -n "$gitlink" ] && [ -n "$dispatcher_gitlink" ] && [ -n "$driver_gitlink" ] &&
	[ -n "$artifacts_gitlink" ] && [ -n "$arena_gitlink" ] && [ -n "$console_gitlink" ]; then
	tree="$(fresh_tree)"
	out="$(cd / && env PATH="${stub_path}$PATH" TCAB_K8S_ROOT="$tree" "$CI_DIR/pin-images.sh" prod "$head" 2>&1)"
	status=$?
	check_equal "passes" 0 "$status"
	check_contains "pins the repos image to the pointer in that commit's tree" \
		"newTag: \"${gitlink}\"" "$(cat "$tree/overlays/prod/kustomization.yaml")"
	check_contains "pins the dispatcher image to the pointer in that commit's tree" \
		"newTag: \"${dispatcher_gitlink}\"" "$(cat "$tree/overlays/prod/kustomization.yaml")"
	check_contains "pins the artifacts image to the pointer in that commit's tree" \
		"newTag: \"${artifacts_gitlink}\"" "$(cat "$tree/overlays/prod/kustomization.yaml")"
	check_contains "pins the arena image to the pointer in that commit's tree" \
		"newTag: \"${arena_gitlink}\"" "$(cat "$tree/overlays/prod/kustomization.yaml")"
	check_contains "pins the console image to the pointer in that commit's tree" \
		"newTag: \"${console_gitlink}\"" "$(cat "$tree/overlays/prod/kustomization.yaml")"
	check_contains "pins the driver image to the pointer in that commit's tree" \
		"newTag: \"${driver_gitlink}\"" "$(cat "$tree/overlays/prod/kustomization.yaml")"
	check_contains "and the dispatcher's driver image" \
		"value: \"testcabinet.azurecr.io/microservice-driver:${driver_gitlink}\"" "$(cat "$tree/overlays/prod/kustomization.yaml")"
else
	ok "(skipped: this checkout has no commit holding the microservice-arena, microservice-artifacts, microservice-repos, microservice-dispatcher, microservice-driver and console.testcabinet.ai pointers)"
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
