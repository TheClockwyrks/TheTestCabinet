#!/usr/bin/env bash
# Tear down LOCAL port-forwarding so `make -C deployments/local local-forward`
# can bind cleanly.
#
# Why this exists: local-forward backgrounds five `kubectl port-forward` children
# from a single recipe shell and then blocks in `wait`. A Ctrl-C that only reaches
# the foreground process — or a terminal that dies outright — can leave those
# children alive and holding :8787/:8789/:8790/:8791/:3000. The next local-forward
# then fails to bind, and because each forward is its own process the surviving
# ones look healthy while the orphaned ports never come back. This stops the whole
# arrangement so the next run starts from zero.
#
# It kills SUPERVISORS FIRST — the `make` process and the recipe shell parked in
# `wait` — then the kubectl children. The other order makes `wait` return non-zero
# and make print a spurious "Error 143" over the top of this script's output.
#
# It is LOCAL-ONLY by design: every match is scoped to the local namespace and this
# repo's own forward targets, so a forward you are deliberately holding open against
# staging or prod is left alone, as are a sibling devcontainer's forwards. A
# non-kubectl process squatting on a port is REPORTED, never killed — that is
# someone else's listener (in a devcontainer, usually the editor auto-forwarding the
# port), not ours to reap.
#
# It also stops the ephemeral forward `make local-ingest` holds, since that one
# takes :8787 too — an ingest in flight is exactly what blocks the next forward.
#
# Usage:
#   scripts/free-local-forward.sh              # stop local forwarding
#   scripts/free-local-forward.sh --dry-run    # show what would be stopped
#
# Flags:
#   -n, --dry-run   List the matching processes and exit without signalling.
#   -h, --help      Show this message.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

DRY_RUN=0

while [[ $# -gt 0 ]]; do
	case "$1" in
		-n|--dry-run) DRY_RUN=1; shift ;;
		-h|--help) sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "Unknown argument: $1 (try --help)" >&2; exit 2 ;;
	esac
done

MAKEFILE="deployments/local/Makefile"

# Read the namespace, the forwarded service names, and the host ports out of the
# Makefile so this stays in sync when they move — the service list in particular has
# grown before (arena) and a stale copy here would silently stop reaping the new one.
# The fallbacks are the current values.

# `NS ?= tcab-local`. Honour an exported NS the same way the Makefile does.
NS="${NS:-$(sed -n 's/^NS[[:space:]]*?\{0,1\}=[[:space:]]*\([A-Za-z0-9._-]\{1,\}\).*/\1/p' "$MAKEFILE" 2>/dev/null | head -1)}"
NS="${NS:-tcab-local}"

# `port-forward svc/<name> <host>:<container>` across every forwarding recipe. The
# host port is matched as literal digits, which is also what excludes local-ingest's
# `$$port:8787` — its port is chosen at run time and is already in the list anyway.
SERVICES="$(sed -n 's|.*port-forward svc/\([A-Za-z0-9._-]\{1,\}\) .*|\1|p' "$MAKEFILE" 2>/dev/null | sort -u | paste -sd'|')"
SERVICES="${SERVICES:-tcab-arena|tcab-artifacts|tcab-auth|tcab-backend|tcab-lgtm}"

PORTS="$(sed -n 's|.*port-forward svc/[A-Za-z0-9._-]\{1,\} \([0-9]\{1,\}\):[0-9]\{1,\}.*|\1|p' "$MAKEFILE" 2>/dev/null | sort -un)"
PORTS="${PORTS:-$(printf '%s\n' 3000 4317 4318 8787 8789 8790 8791)}"

# Two patterns, because the processes to stop do not share a single distinguishing
# string.
#
# The forward pattern matches BOTH the kubectl children and the recipe shell that
# spawned them: make passes the whole recipe — every `kubectl … port-forward svc/…`
# in it — as that shell's command line. Anchoring on the namespace is what keeps this
# off a staging/prod forward for the same service names; the shell carries the
# namespace quoted (`-n 'tcab-local'`) while its children carry it bare, so allow
# either.
FORWARD_PATTERN="kubectl.*-n '?${NS}'?.*port-forward svc/(${SERVICES})"
# The make process itself names neither kubectl nor the namespace — only its target.
MAKE_PATTERN="make([[:space:]]|$).*local-(forward|grafana)"

SELF="$(basename "$0")"

# pgrep exits 1 when nothing matches, which is the normal case here — don't let
# `set -e` treat "already clean" as a failure. Dropping any pid whose command line
# names this script guards the self-match hazard: MAKE_PATTERN would match a wrapper
# that invoked this script from a Makefile, and this script's own command-substitution
# subshells share its command line, so a loose match reaps the reaper.
find_pids() {
	local pid cmd
	while read -r pid; do
		[[ -n "$pid" ]] || continue
		cmd="$(ps -o args= -p "$pid" 2>/dev/null || true)"
		[[ -n "$cmd" && "$cmd" != *"$SELF"* ]] && echo "$pid"
	done < <(pgrep -f "$1" 2>/dev/null || true)
	return 0
}

# A pid can match both patterns, so dedupe before signalling or the second pass
# reports a phantom "still alive".
collect() {
	{ find_pids "$FORWARD_PATTERN"; find_pids "$MAKE_PATTERN"; } | sort -un
}

# Split the matches into the kubectl children and everything else (the make process
# and the recipe shell) by what the process actually IS, rather than by which pattern
# found it — the recipe shell matches the kubectl pattern too, since it carries the
# whole recipe as its command line.
supervisors_of() {
	local pid cmd
	for pid in $1; do
		cmd="$(ps -o args= -p "$pid" 2>/dev/null || true)"
		[[ -n "$cmd" ]] || continue
		case "${cmd%% *}" in
			kubectl|*/kubectl) ;;
			*) echo "$pid" ;;
		esac
	done
}

children_of() {
	local pid cmd
	for pid in $1; do
		cmd="$(ps -o args= -p "$pid" 2>/dev/null || true)"
		case "${cmd%% *}" in
			kubectl|*/kubectl) echo "$pid" ;;
		esac
	done
}

pids="$(collect)"

if [[ -z "$pids" ]]; then
	echo "No local forwarding processes found (namespace $NS)."
else
	echo "Local forwarding processes (namespace $NS):"
	# The recipe shell carries the ENTIRE local-forward recipe as its command line —
	# five kubectl invocations on one line. Clip it: the pid, start time, and opening
	# words are all anyone needs to recognise what is being stopped.
	# shellcheck disable=SC2086 # word-splitting is how we pass the pid list to ps
	ps -o pid=,lstart=,args= -p $pids | cut -c1-120 | sed 's/^/  /'

	if (( DRY_RUN )); then
		echo
		echo "Dry run — nothing signalled. Re-run without --dry-run to stop them."
	else
		echo
		# Supervisors first: killing a child out from under the recipe shell makes its
		# `wait` fail and make print "Error 143" across this script's output.
		# shellcheck disable=SC2086
		for pid in $(supervisors_of "$pids") $(children_of "$pids"); do
			kill "$pid" 2>/dev/null || true
		done

		# Give them a beat to unwind, then escalate on whatever ignored SIGTERM.
		sleep 1
		remaining="$(collect)"
		if [[ -n "$remaining" ]]; then
			# shellcheck disable=SC2086
			kill -9 $remaining 2>/dev/null || true
			sleep 1
		fi

		survivors="$(collect)"
		if [[ -n "$survivors" ]]; then
			echo "Warning: some processes survived SIGKILL:" >&2
			# shellcheck disable=SC2086
			ps -o pid=,args= -p $survivors | cut -c1-120 | sed 's/^/  /' >&2
		else
			echo "Stopped."
		fi
	fi
fi

# Whatever we did or didn't kill, the question that actually matters is whether the
# ports are free — a port can be held by something we deliberately won't touch.
echo
status=0
for port in $PORTS; do
	holder="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -F pc 2>/dev/null || true)"
	if [[ -z "$holder" ]]; then
		echo "port $port: free"
	else
		# -F pc emits `p<pid>` / `c<command>` lines; flatten to "cmd (pid)" pairs.
		who="$(echo "$holder" | awk '/^p/{pid=substr($0,2)} /^c/{print substr($0,2)" ("pid")"}' | sort -u | paste -sd', ')"
		echo "port $port: STILL IN USE by $who" >&2
		status=1
	fi
done

if (( status )) && (( ! DRY_RUN )); then
	echo >&2
	echo "A listener above is not one of ours (or is owned by another user) — this" >&2
	echo "script won't kill it. In a devcontainer this is usually the editor auto-forwarding" >&2
	echo "the port; stop it in the PORTS panel. Inspect it before deciding:" >&2
	echo "  lsof -nP -iTCP:<port> -sTCP:LISTEN" >&2
fi

exit "$status"
