#!/usr/bin/env bash
# Installs `helm`, which installs a cluster's prerequisites from charts, such as
# an ingress controller or a certificate manager. An operator runs it against a
# cluster rather than a gate running in a pipeline, so no CI image carries it.
#
# The toolchain image the Dockerfile builds on carries the other cluster tools,
# `kubectl`, `k3d` and `kubelogin`; helm is this project's own addition, and a
# step of ubuntu.dockerfile. It is a single static binary, installed into
# ~/.local/bin, which the toolchain image puts on every process's PATH. This
# runs at container build time and is safe to re-run by hand after a rebuild.
set -euo pipefail

# Pinned deliberately, so a rebuild reproduces today's tool.
readonly HELM_VERSION="4.3.0"

# The release artifacts' name for this architecture, which is the same name
# dpkg uses. Read out of the image rather than passed in as a build arg — see
# "Architecture" in .devcontainer/README.md.
arch="$(dpkg --print-architecture)"
case "$arch" in
	amd64 | arm64) readonly ARCH="$arch" ;;
	*)
		echo "helm.sh: unsupported architecture '$arch'" >&2
		exit 1
		;;
esac

readonly BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"

# Shipped as a per-platform tarball holding the binary under linux-<arch>/. See
# https://github.com/helm/helm/releases.
wget -O - "https://get.helm.sh/helm-v${HELM_VERSION}-linux-${ARCH}.tar.gz" |
	tar -xz -C "$BIN_DIR" --strip-components=1 "linux-${ARCH}/helm"
chmod +x "$BIN_DIR/helm"

# Run it once. It is downloaded rather than packaged, and nothing in the image
# build executes it, so an artifact for the wrong architecture installs quietly
# and first fails against a cluster. See "Architecture" in
# .devcontainer/README.md.
if ! "$BIN_DIR/helm" version >/dev/null 2>&1; then
	echo "helm.sh: helm does not run in this image" >&2
	echo "  dpkg --print-architecture: $ARCH; uname -m: $(uname -m)" >&2
	exit 1
fi
