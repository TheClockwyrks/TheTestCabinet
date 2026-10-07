#!/usr/bin/env bash
# Installs the Kubernetes tooling this project's clusters are driven with: `k3d`
# (k3s-in-a-container, the local cluster runtime), `kubelogin`, `helm`, and
# `kubectl` through tools/kubectl.sh beside this file.
#
# `k3d` drives the HOST container runtime over the socket tools/host-runtime.sh
# publishes at /var/run/docker.sock, so a local cluster's nodes are siblings of
# this devcontainer on that runtime. This works against rootless Podman and
# Docker alike, because both expose the same Docker-compatible API there.
#
# `kubelogin` is the Azure AD (Entra) credential plugin kubectl invokes when a
# kubeconfig context targets an AAD-enabled AKS cluster (alongside the local k3d
# context). Without it on PATH, kubectl aborts even local commands that merely
# validate against the *current* context if that context happens to point at AKS.
# See https://aka.ms/aks/kubelogin.
#
# `helm` installs a cluster's prerequisites from charts, such as an ingress
# controller or a certificate manager, which an operator runs against a cluster
# rather than a gate running in a pipeline, so no CI image carries it.
#
# All four are distributed as single static binaries, installed into
# ~/.local/bin (already on PATH per the Dockerfile). This runs at container
# build time and is safe to re-run by hand after a rebuild.
set -euo pipefail

# Pin versions deliberately. kubectl's own version is tools/kubectl.sh's,
# because the web CI image installs that one alone; keep any local k3d cluster's
# server image on the Kubernetes minor it names.
readonly K3D_VERSION="5.9.0"
readonly KUBELOGIN_VERSION="0.2.19"
readonly HELM_VERSION="4.3.0"

# The release artifacts' name for this architecture, which for each of these is
# the same name dpkg uses. Read out of the image rather than passed in
# as a build arg — see "Architecture" in .devcontainer/README.md.
arch="$(dpkg --print-architecture)"
case "$arch" in
	amd64 | arm64) readonly ARCH="$arch" ;;
	*)
		echo "k8s.sh: unsupported architecture '$arch'" >&2
		exit 1
		;;
esac

readonly BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR" "/tmp/$USERNAME"

# kubectl, from the script the web CI image runs on its own. It installs into
# the same directory and verifies what it installed.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly HERE
bash "$HERE/kubectl.sh"

# k3d — a single static binary published per platform.
# See https://github.com/k3d-io/k3d/releases for the download URLs.
wget -O "$BIN_DIR/k3d" \
	"https://github.com/k3d-io/k3d/releases/download/v${K3D_VERSION}/k3d-linux-${ARCH}"
chmod +x "$BIN_DIR/k3d"

# kubelogin — shipped as a per-platform zip whose binary lives at
# bin/linux_<arch>/kubelogin. See https://github.com/Azure/kubelogin/releases.
readonly KUBELOGIN_TMP="/tmp/$USERNAME/kubelogin.zip"
wget -O "$KUBELOGIN_TMP" \
	"https://github.com/Azure/kubelogin/releases/download/v${KUBELOGIN_VERSION}/kubelogin-linux-${ARCH}.zip"
unzip -p "$KUBELOGIN_TMP" "bin/linux_${ARCH}/kubelogin" > "$BIN_DIR/kubelogin"
chmod +x "$BIN_DIR/kubelogin"
rm -f "$KUBELOGIN_TMP"

# helm — shipped as a per-platform tarball holding the binary under
# linux-<arch>/. See https://github.com/helm/helm/releases.
wget -O - "https://get.helm.sh/helm-v${HELM_VERSION}-linux-${ARCH}.tar.gz" |
	tar -xz -C "$BIN_DIR" --strip-components=1 "linux-${ARCH}/helm"
chmod +x "$BIN_DIR/helm"

# Run each one once. All three are downloaded rather than packaged, and nothing in
# the image build executes them, so an artifact for the wrong architecture
# installs quietly and first fails against a cluster. No command talks to a
# runtime, so they work with no socket bound in yet. See "Architecture" in
# .devcontainer/README.md.
verify_runs() {
	if ! "$@" >/dev/null 2>&1; then
		echo "k8s.sh: $1 does not run in this image" >&2
		echo "  dpkg --print-architecture: $ARCH; uname -m: $(uname -m)" >&2
		exit 1
	fi
}

verify_runs "$BIN_DIR/k3d" version
verify_runs "$BIN_DIR/kubelogin" --version
verify_runs "$BIN_DIR/helm" version
