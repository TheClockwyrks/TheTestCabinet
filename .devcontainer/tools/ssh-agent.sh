#!/usr/bin/env bash
# Publishes the host's SSH agent inside the container at
# /tmp/devcontainer-ssh-agent.sock, which is the path system/.bashrc points
# SSH_AUTH_SOCK at. Run from devcontainer.json's postStartCommand.
#
# docker-compose.yml binds DEVCONTAINER_SSH_AUTH_SOCK from the host to
# /run/host/ssh-agent.sock, and there are two shapes of host:
#
#   * Linux hosts, and a Mac running OrbStack or Docker Desktop, bind the
#     agent's own socket. It is linked to /tmp/devcontainer-ssh-agent.sock. An
#     agent socket arrives mode 0600 owned by whoever the host user mapped to,
#     so when this container's user cannot open it, it is re-exported through
#     socat at a path the user can open instead.
#
#   * A Mac running Podman cannot bind it at all: Podman runs containers in a
#     Linux VM and refuses the mount ("statfs ...: operation not supported").
#     The bound path stays `/dev/null`, the Mac publishes the agent on its
#     loopback, and this reaches it over TCP at DEVCONTAINER_SSH_AGENT_TCP.
#
# A bound path that is not a socket with no DEVCONTAINER_SSH_AGENT_TCP set is a
# host with no agent to offer, and nothing is published.
#
# Either way the container ends up talking to an agent living on the host, and no
# private key ever enters the container. Idempotent: a restarted container gets a
# fresh link or bridge over whatever its previous life left in /tmp.
set -euo pipefail

readonly AGENT_SOCK=/tmp/devcontainer-ssh-agent.sock
readonly BOUND=/run/host/ssh-agent.sock
readonly LOG=/tmp/ssh-agent-socat.log

log() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG"; }

# Whether this container can open a TCP connection to $1:$2. Used to choose
# between the names Podman may or may not have written into /etc/hosts.
reachable() { timeout 2 bash -c "exec 3<>/dev/tcp/${1}/${2}" 2>/dev/null; }

# A bridge from this container's previous life may still hold the path on a
# plain reopen.
# shellcheck source-path=SCRIPTDIR source=socket-bridge.sh
. "$(dirname "${BASH_SOURCE[0]}")/socket-bridge.sh"
bridge_stop "$AGENT_SOCK"

connect_to=""

if [ -S "$BOUND" ]; then
	if [ -r "$BOUND" ] && [ -w "$BOUND" ]; then
		ln -s "$BOUND" "$AGENT_SOCK"
		log "linked the host agent socket bound in at ${BOUND}"
	else
		connect_to="UNIX-CONNECT:${BOUND}"
		log "re-exporting the host agent socket bound in at ${BOUND}, which this user cannot open"
	fi
elif [ -n "${DEVCONTAINER_SSH_AGENT_TCP:-}" ]; then
	port="${DEVCONTAINER_SSH_AGENT_TCP##*:}"

	# The configured host first, then the other names podman machine answers to
	# for the Mac. Trying them in turn means a Podman release that renames or
	# stops injecting one of them costs a slower start rather than SSH.
	for host in "${DEVCONTAINER_SSH_AGENT_TCP%:*}" \
		host.containers.internal \
		host.docker.internal \
		192.168.127.254; do
		if reachable "$host" "$port"; then
			connect_to="TCP:${host}:${port}"
			log "bridging the host agent at ${host}:${port}"
			break
		fi
	done

	if [ -z "$connect_to" ]; then
		log "cannot reach the host SSH agent at ${DEVCONTAINER_SSH_AGENT_TCP}."
		log "on the Mac, check the bridge is running:"
		log "  nc -z 127.0.0.1 ${port} && echo listening"
		exit 1
	fi
else
	log "no host SSH agent bound in or configured; nothing to publish"
	exit 0
fi

if [ -n "$connect_to" ]; then
	# socket-bridge.sh detaches the bridge from this script and the exec it
	# runs on, and restarts socat whenever it exits.
	if ! bridge_start "$AGENT_SOCK" "$connect_to" "$LOG"; then
		log "socat never created ${AGENT_SOCK}; see ${LOG}"
		exit 1
	fi
fi

# ssh-add exits 1 when it reached an agent that holds no keys and 2 when it could
# not reach an agent at all. Only the second means this script failed, but an
# empty agent is worth saying out loud: it fails at `git push` time looking
# exactly like a broken bridge.
rc=0
SSH_AUTH_SOCK="$AGENT_SOCK" ssh-add -l >/dev/null 2>&1 || rc=$?

case "$rc" in
	0) log "agent ready at ${AGENT_SOCK}" ;;
	1) log "agent ready at ${AGENT_SOCK}, but it is holding no keys; on a Mac run 'ssh-add --apple-load-keychain'" ;;
	*) log "nothing answered as an agent at ${AGENT_SOCK}; see ${LOG}"; exit 1 ;;
esac
