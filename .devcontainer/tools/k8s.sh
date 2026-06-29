#!/usr/bin/env bash
# Installs the Kubernetes tooling the local service stack needs: `k3d`
# (k3s-in-Docker, the local cluster runtime) and `kubectl`. The stack is driven by
# deployments/local/Makefile, which builds the six service images, stands up a
# throwaway k3d cluster, applies the kustomize overlay, and ingests the catalog;
# both binaries must be on PATH for `make -C deployments/local local-up` to work.
#
# Both are distributed as single static binaries, installed into
# ~/.local/bin (already on PATH per the Dockerfile). This runs at container
# build time and is safe to re-run by hand after a rebuild.
set -euo pipefail

# Pin versions deliberately; bump in step with the cluster's Kubernetes minor.
readonly K3D_VERSION="5.7.4"
readonly KUBECTL_VERSION="1.30.6"

# Map the devcontainer's BUILDARCH to the release artifacts' arch naming.
if [ "$BUILDARCH" = "amd64" ]; then
	readonly ARCH="amd64"
else
	readonly ARCH="arm64"
fi

readonly BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR" "/tmp/$USERNAME"

# k3d — a single static binary published per platform.
# See https://github.com/k3d-io/k3d/releases for the download URLs.
wget -O "$BIN_DIR/k3d" \
	"https://github.com/k3d-io/k3d/releases/download/v${K3D_VERSION}/k3d-linux-${ARCH}"
chmod +x "$BIN_DIR/k3d"

# kubectl — likewise a single static binary.
# See https://kubernetes.io/releases/ for the version list.
wget -O "$BIN_DIR/kubectl" \
	"https://dl.k8s.io/release/v${KUBECTL_VERSION}/bin/linux/${ARCH}/kubectl"
chmod +x "$BIN_DIR/kubectl"
