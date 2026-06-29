#!/usr/bin/env bash
# Grants the devcontainer user access to the bind-mounted host Docker socket.
#
# The socket's owning group GID is a property of the HOST and is only knowable
# once the socket is mounted at runtime — it differs across hosts (a native Linux
# daemon exposes it as the host `docker` group; Docker Desktop / OrbStack bind it
# in root-owned). So access is aligned here, at container start, rather than via
# the build-time DOCKER_GID guess. Idempotent, and a no-op when no socket is
# mounted. Run from devcontainer.json's postStartCommand; needs passwordless sudo
# (the devcontainer user has it).
set -euo pipefail

SOCK="${DOCKER_SOCKET_PATH:-/var/run/docker.sock}"

# Nothing mounted (e.g. a host that doesn't run the local stack): nothing to do.
[ -S "$SOCK" ] || exit 0

# Already usable by this user: nothing to do.
if [ -r "$SOCK" ] && [ -w "$SOCK" ]; then
	exit 0
fi

SOCK_GID="$(stat -c '%g' "$SOCK")"
USER_NAME="$(id -un)"

if [ "$SOCK_GID" = "0" ]; then
	# Root-owned socket (common with Docker Desktop / OrbStack bind mounts). There
	# is no meaningful non-root group to join, so widen the socket's mode instead.
	# This touches the host inode, but a docker.sock readable by the dev box's own
	# user is the norm for Docker-outside-of-Docker and is recreated on restart.
	sudo chmod a+rw "$SOCK"
	exit 0
fi

# Non-root group: join a container group with the socket's GID. Reuse an existing
# group at that GID if there is one; otherwise create a `docker-host` group for
# it. New login shells (VS Code terminals, where `make local-up` runs) pick the
# membership up; grant the current invocation immediate access via chmod too.
GROUP_NAME="$(getent group "$SOCK_GID" | cut -d: -f1 || true)"
if [ -z "$GROUP_NAME" ]; then
	GROUP_NAME="docker-host"
	sudo groupadd --gid "$SOCK_GID" "$GROUP_NAME"
fi
if ! id -nG "$USER_NAME" | tr ' ' '\n' | grep -qx "$GROUP_NAME"; then
	sudo usermod --append --groups "$GROUP_NAME" "$USER_NAME"
fi
sudo chmod g+rw "$SOCK"
