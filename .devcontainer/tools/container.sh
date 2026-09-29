#!/usr/bin/env bash
# Installs the container-runtime CLIs (clients only, NO daemon/engine in here).
#
# The devcontainer drives the HOST's container runtime over the socket
# tools/host-runtime.sh publishes at /var/run/docker.sock
# (runtime-outside-of-container). Rootless Podman and Docker both expose a
# Docker-compatible API on that socket, so what gets installed here is:
#
#   - `podman` (the *remote* client), for podman-native workflows against the host
#     socket. Ubuntu ships it as a package; if this release has no `podman-remote`
#     the install is skipped with a note rather than failing the image build,
#     because the `docker` client below covers the same socket.
#   - `docker` (the client binary), which speaks the same Docker API and therefore
#     works against BOTH a Docker daemon and Podman's compatible socket. `k3d`
#     talks to the socket directly and needs neither, but shelling out to a client
#     (build/save/load an image, inspect this container) does.
#   - `docker buildx`, the BuildKit builder plugin. Only meaningful against a real
#     Docker daemon — Podman's API does not implement buildx, so use `podman build`
#     there — but it is small and makes the Docker path work out of the box.
#
# Runs at container build time and is safe to re-run by hand after a rebuild.
set -euo pipefail

# ── podman (remote client) ───────────────────────────────────────────────────
# `podman-remote` is the client-only build: every command is forwarded to the
# socket in CONTAINER_HOST / --url, so it needs no engine, no storage, and no
# privileges inside here. Point it at the bind-mounted host socket; the shell
# config exports CONTAINER_HOST (see system/.bashrc).
sudo apt-get update -y
if DEBIAN_FRONTEND=noninteractive sudo apt-get install -y --no-install-recommends podman-remote; then
	# The package installs the client as `podman-remote` only, so it is linked
	# under the name every podman command line and the devcontainer CLI's
	# `--docker-path podman` use.
	mkdir -p "$HOME/.local/bin"
	ln -sf "$(command -v podman-remote)" "$HOME/.local/bin/podman"
	echo "Installed podman-remote as podman ($("$HOME/.local/bin/podman" --version 2>/dev/null || echo 'version unknown'))"
else
	echo "NOTE: no 'podman-remote' package for this Ubuntu release; skipping." >&2
	echo "      The 'docker' client below speaks the same API as Podman's socket," >&2
	echo "      so the local k3d stack and image builds still work." >&2
fi

# ── docker (client) ──────────────────────────────────────────────────────────
# Pin deliberately; bump in step with the host runtime's major where it matters.
readonly DOCKER_VERSION="27.3.1"

# Docker's name for this architecture in its static-binary downloads. Read out
# of the image rather than passed in as a build arg — see "Architecture" in
# .devcontainer/README.md. $DEB_ARCH keeps the dpkg spelling, which is what buildx uses below.
DEB_ARCH="$(dpkg --print-architecture)"
readonly DEB_ARCH
case "$DEB_ARCH" in
	amd64) readonly ARCH="x86_64" ;;
	arm64) readonly ARCH="aarch64" ;;
	*)
		echo "container.sh: unsupported architecture '$DEB_ARCH'" >&2
		exit 1
		;;
esac

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
# The modern docker CLI only speaks BuildKit through the buildx plugin (it no
# longer falls back to the daemon's integrated builder via DOCKER_BUILDKIT=1), and
# the static client tarball above ships no plugins — so without buildx a
# Dockerfile using `--mount=type=cache` fails with "the --mount option requires
# BuildKit". Install it into the SYSTEM cli-plugins dir rather than
# ~/.docker/cli-plugins so it is still discovered when DOCKER_CONFIG is overridden
# (a common way to sidestep a BuildKit-incompatible credsStore helper). buildx's
# arch naming (amd64/arm64) matches dpkg's directly, so $DEB_ARCH is used as-is.
readonly BUILDX_VERSION="v0.35.0"
readonly BUILDX_PLUGIN_DIR="/usr/local/lib/docker/cli-plugins"
readonly BUILDX_PATH="/tmp/$USERNAME/docker-buildx"

wget -O "$BUILDX_PATH" \
	"https://github.com/docker/buildx/releases/download/${BUILDX_VERSION}/buildx-${BUILDX_VERSION}.linux-${DEB_ARCH}"
sudo mkdir -p "$BUILDX_PLUGIN_DIR"
sudo install -m 0755 "$BUILDX_PATH" "$BUILDX_PLUGIN_DIR/docker-buildx"
rm -f "$BUILDX_PATH"

# Run each one once. Both are downloaded rather than packaged, and nothing in the
# image build executes them, so an artifact for the wrong architecture installs
# quietly and first fails when someone drives the host runtime. Neither command
# talks to a runtime, so they work with no socket bound in yet. See
# "Architecture" in .devcontainer/README.md.
verify_runs() {
	if ! "$@" >/dev/null 2>&1; then
		echo "container.sh: $1 does not run in this image" >&2
		echo "  dpkg --print-architecture: $DEB_ARCH; uname -m: $(uname -m)" >&2
		exit 1
	fi
}

verify_runs "$BIN_DIR/docker" --version
verify_runs "$BUILDX_PLUGIN_DIR/docker-buildx" version

echo "Installed docker ${DOCKER_VERSION} (client) and buildx ${BUILDX_VERSION}"
