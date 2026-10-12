#!/bin/sh
# The catalog ingest sidecar's one job, run once per start of the backend pod.
#
# It brings the checkout the backend ingests from ($TCAB_INGEST_STATE/checkout) to
# the tip of the catalog branch, brings the cold-storage submodule to the commit
# that tip pins, and only then asks the backend for one forced whole-catalog ingest
# over localhost. The steps, in order:
#
#   tools         git and curl are installed (apk), when the image lacks them
#   checkout      the checkout is at the branch tip of the mirror
#   cold-storage  the submodule is at its pinned commit and holds its tree
#   backend       the backend answers /healthz
#   ingest        POST /ingest {"force": true} answered 2xx
#
# A step that fails ends the run before the POST. Nothing is ingested, so the
# definition store, every version's baselines and the public snapshot stay exactly
# as they were. A forced ingest from a checkout that is half refreshed, or whose
# cold storage is absent, is what this refuses to do.
#
# The script never exits. An exited container is restarted by the kubelet, which
# re-runs the one-shot and, while it waits out the restart back-off, marks the pod
# not ready and takes the backend out of its Service. So every path, success and
# failure alike, ends parked in `sleep infinity`, and the outcome is written to
# $TCAB_INGEST_RESULT instead, where the deploy reads it
# (scripts/ci/catalog-ingest.sh verify):
#
#   status=<running|ok|failed>
#   step=<the step that is running, or that failed>
#   branch=<the catalog branch>
#   commit=<the checkout's commit, once it is known>
#   <blank line>
#   <on failure: what failed, the free space on the state volume, the command's
#    last lines>
#
# The file sits on the container's own filesystem rather than on the state volume,
# so it describes this start alone, and it can be written when the volume is full.
#
# A container that is killed is the one exit the script cannot prevent, and the
# kubelet restarts it in the same pod. A kill that repeats, which running out of
# memory during a checkout does, would re-run the one-shot at every restart and
# take the backend out of its Service through each back-off. So an attempt in
# progress is marked on the state volume ($TCAB_INGEST_STATE/.ingest-in-progress:
# the pod's name, then the step), and the marker is removed when a result is
# recorded. A start that finds its own pod's marker records the step that was
# killed as failed and parks without trying again. A new pod, whose name differs,
# tries afresh.
#
# Settings, each from the environment:
#
#   TCAB_INGEST_BRANCH        The catalog branch. Required; the overlay sets it.
#   TCAB_INGEST_ENV           The environment's name, for the commands a failure names.
#   TCAB_INGEST_REPO          The mirror to clone onto a volume that holds no checkout.
#   TCAB_INGEST_STATE         The state volume's mount (default /state).
#   TCAB_INGEST_BACKEND_URL   The backend, in the same pod (default http://127.0.0.1:8787).
#   TCAB_INGEST_RESULT        The result file (default /tmp/ingest-result).
#   TCAB_INGEST_POD           The pod's name (default: the hostname, which is it).
#
# POSIX sh: it runs under busybox ash in the sidecar and under any sh in
# scripts/ci/catalog-ingest-sidecar.test.sh.
set -u

BRANCH="${TCAB_INGEST_BRANCH:-}"
ENVIRONMENT="${TCAB_INGEST_ENV:-<env>}"
REPO="${TCAB_INGEST_REPO:-https://github.com/TheClockwyrks/TheTestCabinet.git}"
STATE="${TCAB_INGEST_STATE:-/state}"
BACKEND_URL="${TCAB_INGEST_BACKEND_URL:-http://127.0.0.1:8787}"
RESULT="${TCAB_INGEST_RESULT:-/tmp/ingest-result}"

CHECKOUT="$STATE/checkout"
COLD_STORAGE="$CHECKOUT/cold-storage"
# What the step in progress last wrote, which a failure quotes.
STEP_LOG="$RESULT.step"
# The attempt in progress: this pod's name, then the step it is at.
MARKER="$STATE/.ingest-in-progress"
POD="${TCAB_INGEST_POD:-$(hostname 2>/dev/null)}"
POD="${POD:-unknown}"

# How many times a step is tried and how long it waits between tries. A fetch that
# fails is usually the network, so it is tried again before it counts.
TOOLS_TRIES=30
TOOLS_DELAY=5
FETCH_TRIES=3
FETCH_DELAY=10
# Ten minutes of /healthz. The backend's own liveness probe restarts it long
# before that when it is not coming up.
HEALTH_TRIES=200
HEALTH_DELAY=3
INGEST_TRIES=10
INGEST_DELAY=10

commit=""

# git fails rather than waiting on a prompt nobody answers, and gives up on a
# transfer that has moved under 1 kB/s for a minute, so a stalled fetch is a try
# that failed and not a sidecar that never records a result.
export GIT_TERMINAL_PROMPT=0
export GIT_HTTP_LOW_SPEED_LIMIT=1000
export GIT_HTTP_LOW_SPEED_TIME=60

say() { echo "ingest: $*"; }

# Idle for the rest of the pod's life.
park() {
	exec sleep infinity
}

write_result() { # status step [message]
	{
		printf 'status=%s\nstep=%s\nbranch=%s\ncommit=%s\n\n' "$1" "$2" "$BRANCH" "$commit"
		[ -z "${3:-}" ] || printf '%s\n' "$3"
	} >"$RESULT.tmp" 2>/dev/null && mv "$RESULT.tmp" "$RESULT"
	# An outcome ends the attempt. A marker that cannot be removed names an attempt
	# that is over, which costs this pod nothing: it is parked.
	[ "$1" = running ] || rm -f "$MARKER" 2>/dev/null
}

# Marks the attempt as in progress at <step>. A volume too full to hold the marker
# goes unmarked, and the fetch that follows fails on the same volume.
mark() { # step
	printf '%s\n%s\n' "$POD" "$1" >"$MARKER" 2>/dev/null || true
}

begin() { # step description
	write_result running "$1"
	mark "$1"
	say "$2"
}

free_space() {
	df -hP "$STATE" 2>/dev/null |
		awk 'NR == 2 { print $4 " free of " $2 " (" $5 " used)"; found = 1 } END { if (!found) print "unknown" }'
}

# Records a failed step and parks. The message carries the free space on the state
# volume, because a full volume is what a fetch that cannot write looks like.
fail() { # step summary
	message="$2
Free space on $STATE: $(free_space).
Nothing was ingested: the store, its baselines and the public snapshot are as they were.
Once the cause is fixed, ingest with: scripts/reingest-cluster.sh --env $ENVIRONMENT"
	if [ -s "$STEP_LOG" ]; then
		message="$message
The step's last output:
$(tail -n 15 "$STEP_LOG" | cut -c1-400)"
	fi
	write_result failed "$1" "$message"
	say "FAILED at step '$1'."
	printf '%s\n' "$message" | sed 's/^/ingest:   /'
	park
}

# Runs a command up to <tries> times, <delay> seconds apart, keeping what the last
# try wrote in the step log and echoing it to the container's log.
attempt() { # tries delay command...
	tries="$1"
	delay="$2"
	shift 2
	n=1
	while :; do
		if "$@" >"$STEP_LOG" 2>&1; then
			cat "$STEP_LOG"
			return 0
		fi
		cat "$STEP_LOG"
		[ "$n" -lt "$tries" ] || return 1
		say "try $n of $tries failed; trying again in ${delay}s"
		n=$((n + 1))
		sleep "$delay"
	done
}

install_tools() {
	apk add --no-cache git curl
}

# Refresh the checkout a warm volume already holds, the normal case, or clone the
# branch onto a cold one.
refresh_checkout() {
	if [ -d "$CHECKOUT/.git" ]; then
		git -C "$CHECKOUT" fetch --depth 1 origin "$BRANCH" &&
			git -C "$CHECKOUT" reset --hard FETCH_HEAD
	else
		rm -rf "$CHECKOUT" &&
			git clone --depth 1 --branch "$BRANCH" "$REPO" "$CHECKOUT"
	fi
}

# `.gitmodules` names the submodule relative to the superproject, so it resolves to
# the mirror's sibling repository; the sync carries a moved URL into a checkout that
# persists. The pinned commit is fetched shallowly.
update_cold_storage() {
	git -C "$CHECKOUT" submodule sync &&
		git -C "$CHECKOUT" submodule update --init --depth 1
}

# Cold storage is checked out when it sits at the commit the checkout pins and
# holds something other than git's own bookkeeping, which is the backend's own test
# (ColdStorage::is_checked_out). In a submodule that was never initialised the
# second rev-parse answers the superproject's commit, which is not the pin.
check_cold_storage() {
	pinned="$(git -C "$CHECKOUT" rev-parse --verify --quiet HEAD:cold-storage)" || {
		echo "the checkout pins no cold-storage commit"
		return 1
	}
	actual="$(git -C "$COLD_STORAGE" rev-parse --verify --quiet HEAD)" || actual="none"
	if [ "$actual" != "$pinned" ]; then
		echo "cold storage is at $actual; the checkout pins $pinned"
		return 1
	fi
	# shellcheck disable=SC2010 # the names are the repository's own top-level folders
	if ! ls -A "$COLD_STORAGE" 2>/dev/null | grep -qv '^\.git$'; then
		echo "cold storage at $pinned holds no files"
		return 1
	fi
	echo "cold storage is checked out at $pinned"
}

backend_healthy() {
	curl -fsS -o /dev/null --max-time 5 "$BACKEND_URL/healthz"
}

# The report of a whole-catalog ingest names every version, so it is kept out of
# the log. --fail-with-body keeps the body of a refusal, which says why.
post_ingest() {
	curl -sS --fail-with-body --connect-timeout 10 -X POST "$BACKEND_URL/ingest" \
		-H 'content-type: application/json' -d '{"force": true}' -o "$RESULT.body"
}

rm -f "$RESULT" "$STEP_LOG" "$RESULT.body"

if [ -z "$BRANCH" ]; then
	fail config "TCAB_INGEST_BRANCH is not set, so there is no catalog branch to ingest."
fi

# An earlier start of this container, in this pod, that never recorded an outcome.
if [ "$(sed -n 1p "$MARKER" 2>/dev/null)" = "$POD" ]; then
	killed="$(sed -n 2p "$MARKER" 2>/dev/null)"
	fail "${killed:-unknown}" "An earlier start of this container was killed at step '${killed:-unknown}' before it recorded a result, so the ingest was not tried again.
Running out of memory is the usual cause: kubectl describe pod names the container's last state, and the limit is in deployments/k8s/components/catalog-ingest/sidecar.yaml."
fi

begin tools "installing git and curl"
if ! { command -v git >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; }; then
	attempt "$TOOLS_TRIES" "$TOOLS_DELAY" install_tools ||
		fail tools "git and curl could not be installed (apk add)."
fi

begin checkout "bringing $CHECKOUT to the tip of $BRANCH"
attempt "$FETCH_TRIES" "$FETCH_DELAY" refresh_checkout ||
	fail checkout "The checkout at $CHECKOUT could not be brought to the tip of $BRANCH from the mirror."
commit="$(git -C "$CHECKOUT" rev-parse --verify --quiet HEAD)" || commit=""

begin cold-storage "bringing the cold-storage submodule to its pinned commit"
attempt "$FETCH_TRIES" "$FETCH_DELAY" update_cold_storage ||
	fail cold-storage "The cold-storage submodule could not be fetched at the commit $BRANCH pins."
attempt 1 0 check_cold_storage ||
	fail cold-storage "The cold-storage submodule is not checked out at the commit $BRANCH pins."

# /healthz, the liveness signal, and never /readyz: readiness is 503 until the store
# is populated, which is what the POST below does on a cold volume.
begin backend "waiting for the backend's /healthz"
attempt "$HEALTH_TRIES" "$HEALTH_DELAY" backend_healthy >/dev/null ||
	fail backend "The backend did not answer $BACKEND_URL/healthz."

# Forced, so the backend serves exactly the catalog at the branch tip: edited
# versions are overwritten and removed ones pruned, each swapped in atomically.
begin ingest "asking the backend for a forced ingest of ${commit:-the checkout}"
if ! attempt "$INGEST_TRIES" "$INGEST_DELAY" post_ingest; then
	head -c 2000 "$RESULT.body" >>"$STEP_LOG" 2>/dev/null
	fail ingest "POST /ingest failed $INGEST_TRIES times."
fi

write_result ok ingest "The backend ingested $BRANCH at ${commit:-an unknown commit}."
say "ok: the backend ingested $BRANCH at ${commit:-an unknown commit}"
park
