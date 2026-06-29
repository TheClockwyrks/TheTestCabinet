#!/usr/bin/env bash
# Installs the Docker CLI (client only, NO daemon). The local service stack talks
# to the HOST's Docker daemon over the socket bind-mounted by the compose file
# (Docker-outside-of-Docker); this just provides the `docker` client that
# deployments/local/Makefile shells out to — building and saving the service
# images, and inspecting this devcontainer to resolve the HOST path of the repo it
# mounts into the k3d node (so the backend can ingest the catalog from it). k3d
# speaks to the daemon over the socket directly and does not need this, but those
# Makefile calls do.
#
# Distributed as a single static client binary, installed into ~/.local/bin
# (already on PATH per the Dockerfile). Runs at container build time and is safe
# to re-run by hand after a rebuild.
set -euo pipefail

# Pin deliberately; bump in step with the host daemon's major where it matters.
readonly DOCKER_VERSION="27.3.1"

# Map the devcontainer's BUILDARCH to Docker's static-binary arch naming.
if [ "$BUILDARCH" = "amd64" ]; then
	readonly ARCH="x86_64"
else
	readonly ARCH="aarch64"
fi

readonly BIN_DIR="$HOME/.local/bin"
readonly TAR_PATH="/tmp/$USERNAME/docker.tgz"
mkdir -p "$BIN_DIR" "/tmp/$USERNAME"

# See https://download.docker.com/linux/static/stable/ for the available builds.
wget -O "$TAR_PATH" \
	"https://download.docker.com/linux/static/stable/${ARCH}/docker-${DOCKER_VERSION}.tgz"

# The tarball ships the whole engine; extract only the client binary.
tar -xzf "$TAR_PATH" -C "/tmp/$USERNAME" docker/docker
install -m 0755 "/tmp/$USERNAME/docker/docker" "$BIN_DIR/docker"
rm -rf "$TAR_PATH" "/tmp/$USERNAME/docker"

# ── docker buildx (the BuildKit builder) ─────────────────────────────────────
# The service-image Dockerfiles (deployments/images/*.Dockerfile) are BuildKit
# Dockerfiles — a `# syntax=docker/dockerfile:1` frontend plus `--mount=type=cache`
# build caches that keep the Rust rebuilds incremental. The modern docker CLI only
# speaks BuildKit through the buildx plugin (it no longer falls back to the daemon's
# integrated builder via DOCKER_BUILDKIT=1), and the static client tarball above
# ships no plugins — so without buildx, `docker build` silently drops to the legacy
# builder, which errors on the cache mounts (`the --mount option requires BuildKit`).
#
# Install it into the SYSTEM cli-plugins dir rather than ~/.docker/cli-plugins so it
# is still discovered when DOCKER_CONFIG is overridden — which deployments/local/Makefile
# does at build time to sidestep the devcontainer's BuildKit-incompatible credsStore
# helper. buildx's BUILDARCH naming (amd64/arm64) matches $BUILDARCH directly.
readonly BUILDX_VERSION="v0.35.0"
readonly BUILDX_PLUGIN_DIR="/usr/local/lib/docker/cli-plugins"
readonly BUILDX_PATH="/tmp/$USERNAME/docker-buildx"

wget -O "$BUILDX_PATH" \
	"https://github.com/docker/buildx/releases/download/${BUILDX_VERSION}/buildx-${BUILDX_VERSION}.linux-${BUILDARCH}"
sudo mkdir -p "$BUILDX_PLUGIN_DIR"
sudo install -m 0755 "$BUILDX_PATH" "$BUILDX_PLUGIN_DIR/docker-buildx"
rm -f "$BUILDX_PATH"
