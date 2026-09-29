#!/usr/bin/env bash
# Publishes the HOST container runtime inside the container at
# /var/run/docker.sock, so `k3d`, `docker` and `podman` in here drive the host's
# runtime instead of an engine of their own (runtime-outside-of-container).
#
# docker-compose.yml binds DEVCONTAINER_RUNTIME_SOCKET from the host to
# /run/host/runtime.sock, and there are two shapes of host, the same split
# tools/ssh-agent.sh deals with:
#
#   * Linux hosts, and a Mac running OrbStack or Docker Desktop, bind the real
#     socket. It is linked to /var/run/docker.sock, and
#     tools/docker-socket-access.sh aligns the permissions.
#
#   * A Mac running Podman cannot bind it at all: containers run inside a Linux
#     VM, and Podman resolves a bind source on the Mac, so the VM's own socket
#     is not addressable by any path and the Mac's own sockets refuse to mount
#     ("statfs ...: operation not supported"). That host sets
#     DEVCONTAINER_RUNTIME_SOCKET=/dev/null, so the bound path is not a socket,
#     and publishes the machine VM's API on its loopback
#     (tools/macos-host-runtime.sh, run on the Mac). This bridges a unix socket
#     here onto that TCP endpoint, named by DEVCONTAINER_RUNTIME_TCP. Everything
#     downstream, k3d above all, then sees the ordinary socket it already
#     expects.
#
#     Every container in the Podman machine reaches that endpoint, so a host
#     that guards it states this container a credential of its own as
#     DEVCONTAINER_RUNTIME_CREDENTIAL. The bridge then opens each connection
#     with an HTTP CONNECT carrying it as the password of Proxy-Authorization
#     (socat's PROXY address), and the host admits only a connection presenting
#     it. A host stating none is reached directly, as before.
#
# A bound path that is not a socket with no DEVCONTAINER_RUNTIME_TCP set is a
# host offering no runtime, and nothing is published.
#
# Run from devcontainer.json's postStartCommand, ahead of
# docker-socket-access.sh. Needs passwordless sudo (the devcontainer user has
# it) because /var/run is root-owned. Idempotent: a restarted container gets a
# fresh link or bridge over whatever its previous life left behind.
set -euo pipefail

readonly SOCK="${DOCKER_SOCKET_PATH:-/var/run/docker.sock}"
readonly BOUND=/run/host/runtime.sock
readonly LOG=/tmp/host-runtime-bridge.log

log() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG"; }

# Whether this container can open a TCP connection to $1:$2. Used to choose
# between the names Podman may or may not have written into /etc/hosts.
reachable() { timeout 2 bash -c "exec 3<>/dev/tcp/${1}/${2}" 2>/dev/null; }

# A bridge from this container's previous life is gone with its process, but
# postStartCommand also runs on a plain reopen, where one may still be holding
# the path. Drop it before publishing so the two do not both answer.
# shellcheck source-path=SCRIPTDIR source=socket-bridge.sh
. "$(dirname "${BASH_SOURCE[0]}")/socket-bridge.sh"
drop_previous() { bridge_stop "$SOCK"; }

if [ -S "$BOUND" ]; then
	drop_previous
	sudo ln -s "$BOUND" "$SOCK"
	log "linked the host runtime socket bound in at ${BOUND} to ${SOCK}"
	exit 0
fi

if [ -z "${DEVCONTAINER_RUNTIME_TCP:-}" ]; then
	log "no host runtime bound in at ${BOUND} and none configured over TCP"
	exit 0
fi

readonly ENDPOINT="$DEVCONTAINER_RUNTIME_TCP"
readonly CREDENTIAL="${DEVCONTAINER_RUNTIME_CREDENTIAL:-}"
port="${ENDPOINT##*:}"

# The socat address reaching the runtime at $1:$2: through the credential where
# the host stated one, and directly where it did not. The CONNECT target is
# ignored by the host, which reaches one runtime only.
runtime_address() {
	if [ -n "$CREDENTIAL" ]; then
		printf 'PROXY:%s:runtime:%s,proxyport=%s,proxyauth=workspace:%s' "$1" "$2" "$2" "$CREDENTIAL"
	else
		printf 'TCP:%s:%s' "$1" "$2"
	fi
}

# The configured host first, then the other names podman machine answers to for
# the Mac. Trying them in turn means a Podman release that renames or stops
# injecting one of them costs a slower start rather than the runtime.
connect_to=""
for host in "${ENDPOINT%:*}" \
	host.containers.internal \
	host.docker.internal \
	192.168.127.254; do
	if reachable "$host" "$port"; then
		connect_to="$(runtime_address "$host" "$port")"
		log "bridging the host runtime at ${host}:${port} to ${SOCK}"
		break
	fi
done

if [ -z "$connect_to" ]; then
	log "cannot reach the host container runtime at ${ENDPOINT}."
	log "on the Mac, start the bridge and check it is listening:"
	log "  bash .devcontainer/tools/macos-host-runtime.sh"
	log "  nc -z 127.0.0.1 ${port} && echo listening"
	exit 1
fi

drop_previous

# Mode 0666 so the devcontainer user can open it without being in a group that
# matches anything on the host: there is no host inode here to take a group
# from. docker-socket-access.sh sees a socket it can already read and write and
# leaves it alone.
#
# socket-bridge.sh detaches the bridge from this script and the exec it runs
# on, and restarts socat whenever it exits.
if ! bridge_start "$SOCK" "$connect_to" "$LOG"; then
	log "socat never created ${SOCK}; see ${LOG}"
	exit 1
fi

# Ask the runtime to identify itself. /_ping is the one endpoint both a Docker
# daemon and Podman's Docker-compatible API answer, so this proves the whole
# path (socat, gvproxy, the Mac's forwarder, the VM's socket) rather than just
# that a socket file exists.
if curl -fsS --max-time 5 --unix-socket "$SOCK" http://localhost/_ping >/dev/null 2>&1; then
	log "host runtime ready at ${SOCK}"
else
	log "the bridge is up but nothing answered as a container runtime on it."
	if [ -n "$CREDENTIAL" ]; then
		log "the host may have refused this container's credential, which a"
		log "container is stated when it is started; starting it again states it anew."
	fi
	log "on the Mac, check the tunnel is still attached to a running machine:"
	log "  podman machine list"
	log "  bash .devcontainer/tools/macos-host-runtime.sh --stop"
	log "  bash .devcontainer/tools/macos-host-runtime.sh"
	exit 1
fi
