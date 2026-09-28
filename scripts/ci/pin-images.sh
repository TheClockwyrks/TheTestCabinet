#!/usr/bin/env bash
# Pins one Azure overlay's Test Cabinet images to one commit, in place.
#
#   scripts/ci/pin-images.sh <staging|prod> <commit>
#
# The staging and prod overlays name every Test Cabinet image at the Test Cabinet
# ACR and the tag `unpinned`, which nothing pushes, so an overlay applied as it
# stands fails to pull. This rewrites deployments/k8s/overlays/<overlay>/kustomization.yaml
# so that it names the commit being deployed instead:
#
#   - each of the eight entries of its `images:` block gets `newTag: "<commit>"`;
#   - a patch of the dispatcher, between two marker comments at the head of its
#     `patches:` list, points TCAB_DRIVER_IMAGE and TCAB_PUBLISHER_IMAGE at the
#     driver and publisher images of that commit, and TCAB_CONTAINER_REGISTRY and
#     TCAB_CONTAINER_TAG at the registry and commit the run-container images are
#     resolved from. These are environment values, which kustomize's image
#     transformer does not reach.
#
# It runs again over its own output: the tags are rewritten and the marked patch is
# replaced, so a second run with another commit leaves the first one nowhere.
#
# The file is changed where it lies, so the caller is either a throwaway checkout
# (the pipeline's deployment job, which the template's deploy.sh then renders) or
# a copy: scripts/ci/deploy-environment.sh and scripts/ci/k8s-deploy-sets.sh pin a
# temporary copy of deployments/k8s, named by TCAB_K8S_ROOT. The script ends by
# rendering the overlay and fails if a Test Cabinet image in it is still unpinned.
#
#   TCAB_K8S_ROOT  The deployments/k8s tree to pin (default: the checkout's own)
set -euo pipefail

caller_dir="$PWD"
# shellcheck source=scripts/ci/tcab-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tcab-lib.sh"

readonly USAGE="usage: scripts/ci/pin-images.sh <staging|prod> <commit>"

# The eight images a Test Cabinet deployment runs or starts, as the base names
# them after its REPLACE_REGISTRY/ placeholder.
readonly TCAB_IMAGES=(tcab-backend tcab-auth-service tcab-dispatcher tcab-driver
	tcab-artifacts tcab-arena tcab-publisher tcab-web)

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
		echo "pin-images.sh: unknown overlay '${OVERLAY}' (expected staging or prod)" >&2
		exit 1
		;;
esac
# Every image is tagged with the commit it was built from, so anything else names
# no image the registry holds.
if ! [[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
	echo "$USAGE" >&2
	echo "pin-images.sh: '${COMMIT}' is not a commit (forty lowercase hex characters)" >&2
	exit 1
fi

k8s_root="${TCAB_K8S_ROOT:-deployments/k8s}"
if [[ -n "${TCAB_K8S_ROOT:-}" && "$k8s_root" != /* ]]; then
	k8s_root="${caller_dir}/${k8s_root}"
fi
readonly KUSTOMIZATION="${k8s_root}/overlays/${OVERLAY}/kustomization.yaml"
if [[ ! -f "$KUSTOMIZATION" ]]; then
	echo "pin-images.sh: there is no ${KUSTOMIZATION}" >&2
	exit 1
fi

readonly BEGIN_MARK="# BEGIN scripts/ci/pin-images.sh: the dispatcher's run images"
readonly END_MARK="# END scripts/ci/pin-images.sh"

patch_file="$(mktemp)"
out_file="$(mktemp)"
pinned_file="$(mktemp)"
trap 'rm -f "$patch_file" "$out_file" "$pinned_file"' EXIT

cat >"$patch_file" <<YAML
  ${BEGIN_MARK}
  # Pinned to ${COMMIT}; a second run replaces this patch.
  - target:
      kind: Deployment
      name: tcab-dispatcher
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
                  - name: TCAB_DRIVER_IMAGE
                    value: "${CI_REGISTRY}/tcab-driver:${COMMIT}"
                  - name: TCAB_PUBLISHER_IMAGE
                    value: "${CI_REGISTRY}/tcab-publisher:${COMMIT}"
                  - name: TCAB_CONTAINER_REGISTRY
                    value: "${CI_REGISTRY}"
                  - name: TCAB_CONTAINER_TAG
                    value: "${COMMIT}"
  ${END_MARK}
YAML

# One pass over the kustomization, which kustomize wrote by hand and nothing
# reformats: top-level keys start in column zero, and each entry of `images:` is a
# `  - name:` line followed by its `    newName:` and `    newTag:` lines.
#   - The marked patch of an earlier run is dropped wherever it is.
#   - Inside `images:`, the newTag of each entry whose name is one of the eight
#     becomes the commit; the pinned names are printed to stderr for the count.
#   - The marked patch is inserted after the `patches:` line.
awk -v commit="$COMMIT" -v begin="  ${BEGIN_MARK}" -v end="  ${END_MARK}" \
	-v patch_file="$patch_file" -v images="${TCAB_IMAGES[*]}" '
	BEGIN {
		n = split(images, list, " ")
		for (i = 1; i <= n; i++) wanted["REPLACE_REGISTRY/" list[i]] = 1
	}
	$0 == begin { skipping = 1; next }
	skipping { if ($0 == end) skipping = 0; next }
	/^[^ #]/ { top = $0; sub(/:.*/, "", top); entry = "" }
	top == "images" && /^  - name: / { entry = $3 }
	top == "images" && /^    newTag: / && (entry in wanted) {
		print "    newTag: \"" commit "\""
		print entry > "/dev/stderr"
		next
	}
	{ print }
	/^patches:[[:space:]]*$/ {
		while ((getline line < patch_file) > 0) print line
		close(patch_file)
		patched = 1
	}
	END {
		if (!patched) print "no-patches-key" > "/dev/stderr"
	}
' "$KUSTOMIZATION" >"$out_file" 2>"$pinned_file"

if grep -qx no-patches-key "$pinned_file"; then
	echo "pin-images.sh: ${KUSTOMIZATION} has no top-level patches: list to add the dispatcher's patch to" >&2
	exit 1
fi
pinned="$(sort -u "$pinned_file" | grep -c . || true)"
if [[ "$pinned" -ne ${#TCAB_IMAGES[@]} ]]; then
	echo "pin-images.sh: ${KUSTOMIZATION} names ${pinned} of the ${#TCAB_IMAGES[@]} Test Cabinet images in its images: block" >&2
	echo "Each of ${TCAB_IMAGES[*]} needs an entry named REPLACE_REGISTRY/<image> with a newTag line." >&2
	exit 1
fi
cat "$out_file" >"$KUSTOMIZATION"

# The render is the proof: an image the block missed, or a newTag the awk above did
# not reach, is still at `unpinned`, or still a placeholder.
if ! command -v kubectl >/dev/null 2>&1; then
	echo "pin-images.sh: no kubectl on PATH, so the pinned overlay cannot be rendered to check it." >&2
	exit 1
fi
if ! rendered="$(kubectl kustomize "${k8s_root}/overlays/${OVERLAY}")"; then
	echo "pin-images.sh: the pinned ${OVERLAY} overlay does not render; reproduce it with:" >&2
	echo "    kubectl kustomize ${k8s_root}/overlays/${OVERLAY}" >&2
	exit 1
fi
if unpinned="$(grep -nE ':unpinned"?$|REPLACE_REGISTRY' <<<"$rendered")"; then
	echo "pin-images.sh: the pinned ${OVERLAY} overlay still names an unpinned image:" >&2
	echo "$unpinned" >&2
	exit 1
fi
echo "pin-images.sh: overlays/${OVERLAY} names every Test Cabinet image at ${COMMIT}"
