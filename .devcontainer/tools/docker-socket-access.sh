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

# A host whose runtime socket could not be bind-mounted to $SOCK directly, and
# arrives somewhere else instead: link it into place first, so everything
# downstream — the `docker` client, `k3d`, deployments/local's Makefile — finds it
# where they all already look. Today that is the macOS + Podman row, where the
# socket comes in on a bind-backed named volume because a Mac cannot name a path
# inside the podman machine VM (see docker-compose.macos-podman.yml).
if [ -n "${TCAB_HOST_RUNTIME_SOCKET:-}" ] && [ ! -e "$SOCK" ]; then
	if [ -S "$TCAB_HOST_RUNTIME_SOCKET" ]; then
		sudo ln -sfn "$TCAB_HOST_RUNTIME_SOCKET" "$SOCK"
	else
		echo "warning: TCAB_HOST_RUNTIME_SOCKET=$TCAB_HOST_RUNTIME_SOCKET is not a socket." >&2
		echo "         The host runtime is unreachable, so 'make -C deployments/local local-up'" >&2
		echo "         will not work. On macOS + Podman, PODMAN_SOCKET_DIR in .devcontainer/.env" >&2
		echo "         must name the VM directory holding the socket of the podman service that" >&2
		echo "         runs this container — the path in the Default row of" >&2
		echo "         'podman system connection list'. '.devcontainer/setup-host.sh --force'" >&2
		echo "         reads it off the machine for you." >&2
	fi
fi

# Nothing mounted and nothing linked. Usually a docker-compose.local.yml copied
# before the runtime socket moved into the host overrides — worth one line rather
# than silence, since what is missing is a whole optional workflow and nothing
# else will mention it until `make local-up` cannot find a daemon.
if [ ! -e "$SOCK" ]; then
	echo "note: no host container-runtime socket at $SOCK, so 'make -C deployments/local local-up' will not work." >&2
	echo "      If your .devcontainer/docker-compose.local.yml predates the move of that mount into" >&2
	echo "      the host overrides, refresh it: .devcontainer/setup-host.sh --force" >&2
	exit 0
fi

# The mount point exists but is not a socket. This is worth a word rather than a
# silent exit, because it has exactly one cause and it is not obvious: compose was
# given a DOCKER_SOCKET that does not exist ON THE HOST, and the runtime created an
# empty directory at the source rather than refusing.
if [ ! -S "$SOCK" ]; then
	echo "warning: $SOCK is not a socket, so the host container runtime is unreachable." >&2
	echo "         Check DOCKER_SOCKET in .devcontainer/.env — the runtime created an empty" >&2
	echo "         directory because the path it names does not exist on the host." >&2
	exit 0
fi

# Already usable by this user: nothing to do.
if [ -r "$SOCK" ] && [ -w "$SOCK" ]; then
	exit 0
fi

SOCK_GID="$(stat -c '%g' "$SOCK")"
USER_NAME="$(id -un)"

# Owned by a UID/GID with no mapping into this container's user namespace, which
# `stat` reports as the overflow id. Under rootless Podman that means the socket
# belongs to a user the container cannot become — in practice, the host's ROOTFUL
# runtime socket bound into a rootless container. Nothing can be granted here;
# chown and chmod would both be refused, so say why rather than dying under `set -e`.
if [ "$SOCK_GID" = "65534" ] || [ "$(stat -c '%u' "$SOCK")" = "65534" ]; then
	echo "warning: $SOCK is owned outside this container's user namespace; access cannot be granted." >&2
	echo "         Under rootless Podman, bind in the ROOTLESS runtime socket — the same one" >&2
	echo "         that created this container — not /run/podman/podman.sock." >&2
	exit 0
fi

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
