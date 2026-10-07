#!/usr/bin/env bash
# Installs ~/.local/bin/cargo, a wrapper that runs cargo's heavy subcommands
# under a permit from the fleet's agent, so the workspaces on one machine take
# turns rather than all building at once.
#
# The Dockerfile puts ~/.local/bin on the PATH ahead of the toolchain's bin
# directory, so every program in the image that runs `cargo` by name reaches
# the wrapper first. The wrapper runs the toolchain's cargo, at
# $CARGO_HOME/bin/cargo or ~/.cargo/bin/cargo, with the arguments it was given.
#
# It runs `build`, `check`, `clippy`, `doc`, `test` and `nextest` through the
# agent's executable, which waits for a free permit, runs the command with the
# permit's share of the cores in its environment and releases the permit when
# the command exits. It does so only where the executable is in the container
# for this architecture and the session's environment names its workspace,
# which a session the agent started does. Every other subcommand, a terminal
# opened by hand and a container with no executable of the agent's run cargo
# as it is. A command already running under a permit, such as a build script
# calling cargo, runs it as it is too, so a permit never waits on itself. The
# permit is advisory: the executable runs the command without one when the
# agent grants none within its wait.
#
# The CI images run languages/rust/install.sh and not this script. A pipeline
# job runs no agent, and a job that caches the crate registry repoints
# CARGO_HOME, where a wrapper resolving the toolchain through it would find no
# cargo.
set -euo pipefail

readonly WRAPPER="$HOME/.local/bin/cargo"

mkdir -p "$(dirname "$WRAPPER")"

# The wrapper is POSIX sh and names the toolchain's cargo by its absolute path
# alone, so it never reaches itself through the PATH.
cat >"$WRAPPER" <<'WRAPPER'
#!/bin/sh
# Runs cargo's heavy subcommands under a permit from the fleet's agent. See
# languages/rust/permit-wrapper.sh in the checkout's .devcontainer.
cargo="${CARGO_HOME:-$HOME/.cargo}/bin/cargo"

# The subcommand is the first argument that is not an option. A leading
# +toolchain is skipped, and so is the value of a global option that takes one
# as a separate argument.
subcommand_of() {
	case "${1-}" in
		+*) shift ;;
	esac
	while [ "$#" -gt 0 ]; do
		case "$1" in
			--) return ;;
			--color | --config | -C | -Z) [ "$#" -gt 1 ] && shift ;;
			-*) ;;
			*)
				printf '%s\n' "$1"
				return
				;;
		esac
		shift
	done
}

subcommand="$(subcommand_of "$@")"

case "$subcommand" in
	build | check | clippy | doc | test | nextest) ;;
	*) exec "$cargo" "$@" ;;
esac

# A command the agent's executable already runs under a permit carries the
# permit's share of the cores in its environment.
if [ -n "${NYXSIS_PERMIT_CORES:-}" ] || [ -z "${NYXSIS_WORKSPACE:-}" ]; then
	exec "$cargo" "$@"
fi

case "$(dpkg --print-architecture 2>/dev/null)" in
	amd64) platform=linux-amd64 ;;
	arm64) platform=linux-arm64 ;;
	*) exec "$cargo" "$@" ;;
esac

agent="/nyxsis/harness/bin/$platform/nyxsis-agent"
if [ -f "$agent" ] && [ -x "$agent" ]; then
	exec "$agent" permit --operation cargo -- "$cargo" "$@"
fi
exec "$cargo" "$@"
WRAPPER
chmod 0755 "$WRAPPER"

# Run it once, by name. A PATH that reaches the toolchain's cargo first would
# leave the wrapper installed and never run, and a wrapper that finds no cargo
# would first fail in a gate.
if [[ "$(command -v cargo)" != "$WRAPPER" ]]; then
	echo "permit-wrapper.sh: cargo resolves to $(command -v cargo), not $WRAPPER" >&2
	echo "  PATH: $PATH" >&2
	exit 1
fi
if ! cargo --version >/dev/null 2>&1; then
	echo "permit-wrapper.sh: the wrapper runs no cargo at ${CARGO_HOME:-$HOME/.cargo}/bin/cargo" >&2
	exit 1
fi
