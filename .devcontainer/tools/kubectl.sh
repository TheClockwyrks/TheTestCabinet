#!/usr/bin/env bash
# Installs `kubectl`, the one Kubernetes command a check runs.
#
# It is split out of tools/k8s.sh, which installs `k3d` and `kubelogin` beside
# it, because a project that deploys to Kubernetes has its web CI image
# (ci/images/web.Dockerfile) install this one alone: the gate that checks the
# deployment overlays renders them through kubectl's built-in kustomize and
# never reaches a cluster, so nothing in a pipeline stands a cluster up or
# signs in to Entra. The four together are several times the size of this one.
# k8s.sh runs this script rather than repeating it, so the version below is the
# version a developer's container and a pipeline both get.
#
# The binary is a single static download, installed into KUBECTL_BIN_DIR, which
# defaults to ~/.local/bin, the directory the devcontainer's Dockerfile already
# puts on the PATH. A CI image has no container user whose home that would be
# and overrides it to /usr/local/bin.
set -euo pipefail

# Pin deliberately. Keep this on the Kubernetes minor the clusters you actually
# deploy to run, so a manifest that renders here renders there too, and keep any
# local k3d cluster's server image on the same version.
readonly KUBECTL_VERSION="${KUBECTL_VERSION:-1.35.6}"

# The release artifacts' name for this architecture, which is the same name
# dpkg uses. Read out of the image rather than passed in as a build arg — see
# "Architecture" in README.md.
arch="$(dpkg --print-architecture)"
case "$arch" in
	amd64 | arm64) readonly ARCH="$arch" ;;
	*)
		echo "kubectl.sh: unsupported architecture '$arch'" >&2
		exit 1
		;;
esac

readonly BIN_DIR="${KUBECTL_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$BIN_DIR"

# See https://kubernetes.io/releases/ for the version list.
wget -O "$BIN_DIR/kubectl" \
	"https://dl.k8s.io/release/v${KUBECTL_VERSION}/bin/linux/${ARCH}/kubectl"
chmod +x "$BIN_DIR/kubectl"

# Run it once. The binary is downloaded rather than packaged and nothing else in
# an image build executes it, so an artifact for the wrong architecture installs
# quietly and first fails in a gate. `version --client` talks to no cluster, so
# it works with no kubeconfig and no socket bound in. See "Architecture" in
# README.md.
if ! "$BIN_DIR/kubectl" version --client >/dev/null 2>&1; then
	echo "kubectl.sh: the ${ARCH} build does not run in this image" >&2
	echo "  dpkg --print-architecture: $arch; uname -m: $(uname -m)" >&2
	exit 1
fi

echo "Installed kubectl ${KUBECTL_VERSION} to $BIN_DIR"
