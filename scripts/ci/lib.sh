#!/usr/bin/env bash
# Shared helpers for the pipeline scripts in this directory.
#
# Sourced, not executed. Every caller has already `set -euo pipefail`.
#
# Sourcing this file puts the caller in the repository root. The root is
# resolved from this file's own path rather than from git, so a script answers
# the same from a crate directory, from a pipeline checkout whose working
# directory is set elsewhere, and from a rendered workspace that is not a
# repository yet.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT" || exit 1

# The file every tool version the devcontainer image installs is pinned in, as
# the build arguments its dev service is built with.
DEVCONTAINER_COMPOSE=".devcontainer/docker-compose.yml"

# Prints a blank line and its arguments to stderr.
#
# Every script ends a failure with this, naming the command that fixes it, so
# the remediation is the last thing on the terminal rather than the first thing
# scrolled away by the tool's own output.
remediation() {
	echo >&2
	printf '%s\n' "$@" >&2
}

# Prints the value the devcontainer image is built with for one build argument.
#
# The `x-devcontainer-build-args` anchor of the compose file is the one place a
# tool's version is decided, and a script that asserts a version reads it from
# there, so the image and the script never drift apart. Fails naming the
# argument when the anchor decides none, so a rename there stops the caller
# rather than handing it a default.
#
# The anchor is read with awk rather than with `docker compose config`, for the
# same three reasons ci/images/build-args.sh reads it that way: it needs no
# compose on the machine, it behaves identically under Docker and Podman, and
# there is no YAML parser in this workspace by design. The block runs from the
# anchor's own line to the next line that starts in column zero, which is the
# next top-level key.
#
# Only a literal value is returned. The anchor's interpolated entries —
# USER_UID and USER_GID — are properties of the host a devcontainer is being
# built on rather than versions, and no caller asserts one.
build_arg() {
	local name="$1" value
	value="$(awk -v name="$name" '
		/^x-devcontainer-build-args:/ { in_anchor = 1; next }
		in_anchor && /^[^[:space:]]/ { in_anchor = 0 }
		in_anchor && $0 ~ "^  " name ": " {
			found = substr($0, length(name) + 5)
			sub(/[[:space:]]+$/, "", found)
			if (found !~ /\$/ && found != "") {
				print found
				exit
			}
		}
	' "$PROJECT_ROOT/$DEVCONTAINER_COMPOSE")"
	if [ -z "$value" ]; then
		echo >&2 "${DEVCONTAINER_COMPOSE} decides no ${name}."
		remediation \
			"The build arguments of ${DEVCONTAINER_COMPOSE} decide every tool version." \
			"Add a ${name} argument to them, or name the argument it was renamed to."
		return 1
	fi
	printf '%s\n' "$value"
}

# Require a binary the npm workspace installs, naming the install command.
require_npm_install() {
	local tool="${1}"
	if [ ! -x "node_modules/.bin/${tool}" ]; then
		echo >&2 "${tool} is not installed; the npm workspace is not installed here."
		remediation "Install it with:" "    npm ci"
		exit 1
	fi
}

# How often, and how many times, a command az stopped waiting on is read back.
# Overridable, so a test runs the polls out in seconds.
AKS_RESULT_POLL_SECONDS="${AKS_RESULT_POLL_SECONDS:-5}"
AKS_RESULT_POLLS="${AKS_RESULT_POLLS:-180}"

# Runs one shell command inside a private cluster, with one file beside it,
# and prints what it wrote.
#
#   aks_invoke <resource-group> <cluster> <file> <command>
#
# The command runs through `az aks command invoke`, which runs it in the
# cluster under the caller's identity. The exit code is the command's own, read
# out of the result rather than taken from az, which reports the invocation and
# not always the command. An invocation that produced no result answers 2,
# which is an invocation that never reached the cluster rather than a command
# that failed, and one whose command was still running when the polls ran out
# answers 3, naming the command that reads it back: the command runs on in
# the cluster, and nothing the caller did has been undone.
#
# az waits five minutes on a command and then answers with the invocation
# still running, which an apply followed by a rollout outlasts, so a result
# that is still running is read back until the command ends. The invocation
# answers that state as JSON carrying the command's id; a read of a result
# that is still running answers it as two lines of text naming the id and
# `status: Running` whatever output format was asked for, so both forms are
# read as the command still running.
aks_invoke() { # resource-group cluster file command
	local group="$1" cluster="$2" file="$3" command="$4"
	local result errors status id polls verdict
	result="$(mktemp)"
	errors="$(mktemp)"
	az aks command invoke \
		--resource-group "$group" --name "$cluster" \
		--file "$file" --command "$command" -o json >"$result" 2>"$errors" || true
	id="$(jq -r '.id // empty' "$result" 2>/dev/null || true)"
	polls=0
	while [ -n "$id" ] && aks_result_running "$result"; do
		if [ "$polls" -ge "$AKS_RESULT_POLLS" ]; then
			echo >&2 "The command was still running after $((AKS_RESULT_POLLS * AKS_RESULT_POLL_SECONDS)) seconds. It runs on; read it back with:"
			echo >&2 "    az aks command result --resource-group $group --name $cluster --command-id $id"
			rm -f "$result" "$errors"
			return 3
		fi
		polls=$((polls + 1))
		sleep "$AKS_RESULT_POLL_SECONDS"
		az aks command result \
			--resource-group "$group" --name "$cluster" \
			--command-id "$id" -o json >"$result" 2>"$errors" || true
	done
	status="$(jq -r '.exitCode // empty' "$result" 2>/dev/null || true)"
	if [ -z "$status" ]; then
		cat >&2 "$result" "$errors"
		echo >&2 "The invocation reported no exit code, so the command never ran."
		rm -f "$result" "$errors"
		return 2
	fi
	jq -r '.logs // empty' "$result"
	verdict=0
	[ "$status" -eq 0 ] || verdict=1
	rm -f "$result" "$errors"
	return "$verdict"
}

# True while the result file `az aks command invoke` or `az aks command result`
# wrote reports the command still running, in either of the two forms above.
aks_result_running() { # file
	local state
	if state="$(jq -r '.provisioningState // empty' "$1" 2>/dev/null)"; then
		[ "$state" = "Running" ]
	else
		grep -q 'status: Running' "$1"
	fi
}
