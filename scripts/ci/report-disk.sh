#!/usr/bin/env bash
# Prints how much room is left on every filesystem a build on this agent can fill.
#
#   scripts/ci/report-disk.sh [label]
#
# A diagnostic and nothing else: it always exits 0, so a pipeline step can call it before and
# after a build — including on the way out of a failed one — without being able to turn a
# build failure into a different one.
#
# `/` IS NOT ENOUGH, which is the mistake this replaces. What fills on the run-image job is the
# container store — ~60 GB of `-gg` variants — and only the daemon knows where it keeps that;
# the arm64 agents additionally put the agent's work tree on `/mnt/vss/_work`, which is a
# different mount from `/` on an Azure Linux VM. A reading against `/` on a layout like that
# reports a filesystem that stayed flat while the build ran another one out, which is exactly
# how the last `no space left on device` arrived with no usable figure.
#
# THE RUN-IMAGE JOB IS WHAT THIS EXISTS FOR. That job builds fifty-five images on one agent and
# ran out of disk on both architectures with nothing in its log saying how much it had.
# `containers/build.sh` reports after every `-gg` variant under RECLAIM; this covers the two
# edges outside it, and `scripts/ci/free-disk-linux.sh` uses it either side of its removals.
#
# It is a script of its own rather than a helper in scripts/ci/tcab-lib.sh because the
# run-image job's steps (.azure/project/jobs.yml) call it directly, and it needs nothing from
# that helper: it defines its own `log` and sets no `-e`, so nothing in it can fail a step.
set -uo pipefail

log() {
	printf '\n\033[1;34m==> %s\033[0m\n' "$*"
}

# `df` prints one row per OPERAND and does not merge operands that share a filesystem, so the
# list is deduplicated by mount target first, with `/` always in it as the floor.
report() {
	local root="" path target
	local -a paths=()
	local -A seen=()
	if command -v docker >/dev/null 2>&1; then
		root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null)" || root=""
	fi
	for path in / "${root}" "${AGENT_WORKFOLDER:-}"; do
		[[ -n "${path}" && -d "${path}" ]] || continue
		target="$(df --output=target "${path}" 2>/dev/null | tail -n 1)" || continue
		[[ -n "${target}" && -z "${seen[${target}]:-}" ]] || continue
		seen["${target}"]=1
		paths+=("${path}")
	done
	df -h "${paths[@]:-/}" 2>/dev/null || df -h / || true
}

log "disk${1:+: $1}"
report
docker system df 2>/dev/null | sed 's/^/    /' || true
exit 0
