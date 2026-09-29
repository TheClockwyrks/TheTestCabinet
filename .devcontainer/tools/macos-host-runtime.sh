#!/usr/bin/env bash
# Publishes the podman machine's API on the Mac's loopback, where the
# devcontainer can reach it. RUN THIS ON THE MAC — it is the host half of
# tools/host-runtime.sh, which is what runs inside the container.
#
# Why a bridge is needed at all: Podman on macOS runs containers inside a Linux
# VM, and resolves a bind source on the MAC rather than in the VM. So the VM's
# own socket cannot be named by any path a mount would accept, and the Mac's own
# sockets refuse to mount at all ("statfs ...: operation not supported"), which
# fails the container's creation outright. Nothing can be bind-mounted in as the
# host runtime socket, and without one `k3d` in the container has no
# runtime to create a cluster on.
#
# What works instead is the route the SSH agent already takes (see
# .devcontainer/README.md):
# anything listening on the Mac's loopback is reachable from a container as
# host.containers.internal, because podman machine's gvproxy answers for the Mac
# there. So this forwards a loopback port into the VM's podman socket over the
# machine's own SSH connection — the same transport `podman` itself uses from
# this Mac, with its own key and port, so nothing new is exposed to the network
# and no daemon is reconfigured. Inside the container, tools/host-runtime.sh
# turns that port back into /var/run/docker.sock.
#
#   bash .devcontainer/tools/macos-host-runtime.sh              # start (idempotent)
#   bash .devcontainer/tools/macos-host-runtime.sh --status
#   bash .devcontainer/tools/macos-host-runtime.sh --stop
#   bash .devcontainer/tools/macos-host-runtime.sh --foreground # for launchd
#
# Start it before opening the container: the container-side bridge is built by
# the postStartCommand and reports the endpoint as unreachable if nothing is
# listening yet. See "Host runtime access" in .devcontainer/README.md for
# running it from launchd so it is simply always up.
#
# Deliberately written for the bash macOS ships (3.2) and the tools that come
# with it — no Homebrew, no jq, nothing to install first.
set -euo pipefail

# Keep in step with the port in the Mac's DEVCONTAINER_RUNTIME_TCP; see
# .devcontainer/README.md.
readonly PORT="${DEVCONTAINER_RUNTIME_PORT:-17386}"

usage() {
	cat <<USAGE
usage: macos-host-runtime.sh [--start|--status|--stop|--foreground]

Publishes the podman machine's API on 127.0.0.1:${PORT} for the devcontainer.
Run on the Mac. Override the port with DEVCONTAINER_RUNTIME_PORT, and the
podman connection to forward with PODMAN_CONNECTION.
USAGE
}

mode=start
case "${1:-}" in
	''|--start) ;;
	--status) mode=status ;;
	--stop) mode=stop ;;
	--foreground) mode=foreground ;;
	-h|--help) usage; exit 0 ;;
	*) usage >&2; exit 2 ;;
esac

die() { printf 'macos-host-runtime.sh: %s\n' "$*" >&2; exit 1; }

# Whether something is already answering on the loopback port. Uses bash's own
# /dev/tcp rather than nc so the check cannot disagree with what the container
# will experience.
listening() { (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; }

# The running tunnel, if any. The forward spec is unique enough to identify it,
# and the bracket keeps this pattern from matching the pgrep command itself.
tunnel_pids() { pgrep -f "ssh[ ].*-L 127.0.0.1:${PORT}:" 2>/dev/null || true; }

if [ "$(uname -s)" != Darwin ]; then
	die "this is the Mac half of the bridge and only makes sense there.
    Inside the container, tools/host-runtime.sh is what builds the socket;
    on Linux the compose file binds the real socket and neither is needed."
fi

case "$mode" in
	status)
		pids="$(tunnel_pids)"
		if listening; then
			echo "listening on 127.0.0.1:${PORT}${pids:+ (ssh pid $(echo "$pids" | tr '\n' ' '))}"
		else
			echo "nothing listening on 127.0.0.1:${PORT}"
			[ -z "$pids" ] || echo "but an ssh tunnel is still running (pid $(echo "$pids" | tr '\n' ' ')) — stop it and start again"
			exit 1
		fi
		exit 0
		;;
	stop)
		pids="$(tunnel_pids)"
		if [ -z "$pids" ]; then
			echo "no bridge running on 127.0.0.1:${PORT}"
		else
			echo "$pids" | xargs kill
			echo "stopped the bridge on 127.0.0.1:${PORT}"
		fi
		exit 0
		;;
esac

if [ "$mode" = start ] && listening; then
	echo "already listening on 127.0.0.1:${PORT} — nothing to do"
	exit 0
fi

command -v podman >/dev/null 2>&1 || die "podman is not installed on this Mac"

# A stopped machine has an SSH port that no longer goes anywhere, and the tunnel
# would come up and then answer nothing — a failure that surfaces inside the
# container as a runtime that pings but never replies. Catch it here instead.
podman info >/dev/null 2>&1 || die "podman cannot reach its machine — start it with 'podman machine start'"

# Everything the tunnel needs is already recorded in the connection podman uses
# itself: the VM's SSH port, the key podman machine generated, and the path of
# the socket inside the VM. Read it back rather than guessing at any of them —
# the port is assigned per machine and the socket path carries the VM user's uid.
conns="$(podman system connection list --format '{{.Name}}|{{.URI}}|{{.Identity}}|{{.Default}}' 2>/dev/null || true)"
[ -n "$conns" ] || die "no podman connections are configured — is there a machine? ('podman machine list')"

if [ -n "${PODMAN_CONNECTION:-}" ]; then
	conn="$(printf '%s\n' "$conns" | awk -F'|' -v n="$PODMAN_CONNECTION" '$1 == n { print; exit }')"
	[ -n "$conn" ] || die "no podman connection named '${PODMAN_CONNECTION}' ('podman system connection list')"
else
	# The default connection is the one plain `podman` commands use, so the
	# containers this Mac already runs — the devcontainer included — live on the
	# runtime it points at. Falling back to the first entry covers a podman whose
	# template has no Default field.
	conn="$(printf '%s\n' "$conns" | awk -F'|' '$4 ~ /true/ { print; exit }')"
	[ -n "$conn" ] || conn="$(printf '%s\n' "$conns" | head -n1)"
fi

uri="$(printf '%s' "$conn" | cut -d'|' -f2)"
identity="$(printf '%s' "$conn" | cut -d'|' -f3)"

case "$uri" in
	ssh://*) ;;
	unix://*) die "the active podman connection is a local socket (${uri}).
    That is a Linux setup, where the compose file binds the socket
    straight into the container and no bridge is wanted." ;;
	*) die "cannot make sense of the podman connection URI '${uri}'" ;;
esac

rest="${uri#ssh://}"
authority="${rest%%/*}"
remote_socket="/${rest#*/}"
case "$authority" in
	*@*) remote_user="${authority%@*}"; hostport="${authority#*@}" ;;
	*)   remote_user=core;              hostport="$authority" ;;
esac
remote_host="${hostport%:*}"
remote_port="${hostport##*:}"

case "$remote_port" in
	''|*[!0-9]*) die "cannot read the machine's SSH port from '${uri}'" ;;
esac
[ "$remote_socket" != "/" ] || die "cannot read the machine's socket path from '${uri}'"

# StrictHostKeyChecking is off and the known-hosts file discarded on purpose: the
# far end is a local VM whose host key is regenerated every time the machine is
# recreated, so pinning it only produces a scary mismatch on a routine reset.
# ExitOnForwardFailure makes a port that is already taken an error rather than a
# tunnel that silently forwards nothing, and the keepalives tear the tunnel down
# when the machine stops instead of leaving it hanging over a dead VM.
ssh_args=(
	-o StrictHostKeyChecking=no
	-o UserKnownHostsFile=/dev/null
	-o LogLevel=ERROR
	-o ExitOnForwardFailure=yes
	-o ServerAliveInterval=30
	-o ServerAliveCountMax=3
	-p "$remote_port"
	-L "127.0.0.1:${PORT}:${remote_socket}"
	-N -T
)
if [ -n "$identity" ] && [ -f "$identity" ]; then
	ssh_args=(-i "$identity" -o IdentitiesOnly=yes "${ssh_args[@]}")
fi

if [ "$mode" = foreground ]; then
	echo "forwarding 127.0.0.1:${PORT} → ${remote_socket} in the podman machine"
	exec ssh "${ssh_args[@]}" "${remote_user}@${remote_host}"
fi

ssh -f "${ssh_args[@]}" "${remote_user}@${remote_host}" ||
	die "could not open the tunnel to the podman machine"

for _ in 1 2 3 4 5 6 7 8 9 10; do
	listening && break
	sleep 0.2
done

listening || die "the tunnel started but nothing is listening on 127.0.0.1:${PORT}"

cat <<DONE
Host runtime published on 127.0.0.1:${PORT} (→ ${remote_socket} in the podman machine).
The devcontainer reaches it as host.containers.internal:${PORT}; inside the
container it becomes /var/run/docker.sock, and 'docker ps' should answer there.
Stop it with: bash .devcontainer/tools/macos-host-runtime.sh --stop
DONE
