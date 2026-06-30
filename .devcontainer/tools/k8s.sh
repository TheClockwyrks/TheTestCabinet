#!/usr/bin/env bash
# Installs the Kubernetes tooling the local service stack needs: `k3d`
# (k3s-in-Docker, the local cluster runtime), `kubectl`, and `kubelogin`. The
# stack is driven by deployments/local/Makefile, which builds the six service
# images, stands up a throwaway k3d cluster, applies the kustomize overlay, and
# ingests the catalog; the binaries must be on PATH for
# `make -C deployments/local local-up` to work.
#
# `kubelogin` is the Azure AD (Entra) credential plugin kubectl invokes when a
# kubeconfig context targets an AAD-enabled AKS cluster (e.g. a `tcab` staging or
# prod environment alongside the local k3d context). Without it on PATH, kubectl
# aborts even local-stack commands that merely validate against the *current*
# context if that context happens to point at AKS. See https://aka.ms/aks/kubelogin.
#
# All three are distributed as single static binaries, installed into
# ~/.local/bin (already on PATH per the Dockerfile). This runs at container
# build time and is safe to re-run by hand after a rebuild.
set -euo pipefail

# Pin versions deliberately; bump in step with the cluster's Kubernetes minor.
readonly K3D_VERSION="5.7.4"
readonly KUBECTL_VERSION="1.30.6"
readonly KUBELOGIN_VERSION="0.1.4"

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

# kubelogin — shipped as a per-platform zip whose binary lives at
# bin/linux_<arch>/kubelogin. See https://github.com/Azure/kubelogin/releases.
readonly KUBELOGIN_TMP="/tmp/$USERNAME/kubelogin.zip"
wget -O "$KUBELOGIN_TMP" \
	"https://github.com/Azure/kubelogin/releases/download/v${KUBELOGIN_VERSION}/kubelogin-linux-${ARCH}.zip"
unzip -p "$KUBELOGIN_TMP" "bin/linux_${ARCH}/kubelogin" > "$BIN_DIR/kubelogin"
chmod +x "$BIN_DIR/kubelogin"
rm -f "$KUBELOGIN_TMP"
