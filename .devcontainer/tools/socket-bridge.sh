#!/usr/bin/env bash
# Keeps a unix socket inside the container bridged onto an endpoint, for
# tools/host-runtime.sh and tools/ssh-agent.sh. Sourced, not run.
#
# A bridge has to outlive the exec that started it. postStartCommand runs on
# the devcontainer CLI's exec session, which is a terminal, and `nohup sudo
# socat ... &` does not survive that terminal closing: sudo gives the command a
# terminal of its own and takes it down when the one it was started from hangs
# up. So the bridge is started through `setsid -f` under sudo instead, which
# forks it into a session of its own with no terminal before sudo returns, and
# sudo has nothing left to take down.
#
# What runs there is a loop that restarts socat whenever it exits, a second
# after, so a bridge killed or crashed comes back without the container being
# restarted. The loop is named after the socket it keeps, which is how
# bridge_stop finds it again, and it stops before its socat does so that nothing
# restarts what is being stopped.

# Stops whatever keeps $1 bridged, the loop first and then its socat, and
# removes the socket. The brackets keep each pattern from matching the pkill
# command line itself.
bridge_stop() {
	local sock="$1"
	sudo pkill -f "socket-bridge[ ]${sock} " 2>/dev/null || true
	sudo pkill -f "socat[ ]UNIX-LISTEN:${sock}," 2>/dev/null || true
	sudo rm -f "$sock"
}

# Bridges the unix socket $1, mode 0666, onto the socat address $2, appending
# what socat and the loop say to the log $3, and waits up to two seconds for the
# socket to appear. Returns 1 when it does not.
bridge_start() {
	local sock="$1" connect_to="$2" log="$3"
	# The loop runs as root, but its log is this user's, so the redirect is
	# meant to be made here rather than under sudo.
	# shellcheck disable=SC2016,SC2024 # $1 and $2 are the loop's own arguments
	sudo setsid -f bash -c '
		while :; do
			socat "UNIX-LISTEN:$1,fork,mode=0666,unlink-early" "$2"
			status=$?
			printf "%s socat bridging %s exited with status %s; restarting it\n" \
				"$(date "+%H:%M:%S")" "$1" "$status"
			sleep 1
		done' socket-bridge "$sock" "$connect_to" </dev/null >>"$log" 2>&1

	for _ in $(seq 20); do
		[ -S "$sock" ] && return 0
		sleep 0.1
	done
	return 1
}
