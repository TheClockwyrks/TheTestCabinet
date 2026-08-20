#!/usr/bin/env bash
# Creates the two host-specific files the devcontainer needs — `.env` and
# `docker-compose.local.yml` — from the committed variant for your host.
#
# Both files are deliberately uncommitted (see .gitignore beside this script) so
# that a host choice stays local, which means every clone has to make them once.
# Doing it by hand is two `cp`s and is documented in README.md; this script picks
# the right pair for you, and on macOS + Podman it also checks the one thing a
# copy cannot: that the podman machine is big enough to build this workspace in.
#
# Idempotent in the sense that re-running with --force regenerates both files; it
# refuses to overwrite by default, because your copies are the ones you may have
# edited. RE-RUN IT AFTER A PULL that changes these templates — your copies do not
# update themselves, and a stale docker-compose.local.yml silently drops whatever
# the new one adds.
#
#   ./setup-host.sh                  # detect this host, write both files
#   ./setup-host.sh macos-podman     # pick a variant explicitly
#   ./setup-host.sh --force          # overwrite existing copies
#   ./setup-host.sh --print          # say what it would do and stop
set -euo pipefail

# Resolve this script's own path before changing directory: `$0` may be relative,
# and --help reads the comment header back out of it.
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

cd "$(dirname "$SELF")"

FORCE=0
PRINT_ONLY=0
VARIANT=""

for arg in "$@"; do
	case "$arg" in
	--force) FORCE=1 ;;
	--print | --dry-run) PRINT_ONLY=1 ;;
	-h | --help)
		sed -n '2,22p' "$SELF" | sed 's/^# \{0,1\}//'
		exit 0
		;;
	-*)
		echo "error: unknown option '$arg'." >&2
		exit 2
		;;
	*)
		if [ -n "$VARIANT" ]; then
			echo "error: give at most one variant (got '$VARIANT' and '$arg')." >&2
			exit 2
		fi
		VARIANT="$arg"
		;;
	esac
done

# The four supported host variants. The name is the suffix of the committed
# compose file, which is what you see in this directory; the `.env` it pairs with
# is not always the same word, because two variants share one environment.
variant_compose() {
	case "$1" in
	ubuntu) echo "docker-compose.ubuntu.yml" ;;
	nixos) echo "docker-compose.nixos.yml" ;;
	macos-docker) echo "docker-compose.macos-docker.yml" ;;
	macos-podman) echo "docker-compose.macos-podman.yml" ;;
	*) return 1 ;;
	esac
}

variant_env() {
	case "$1" in
	# Docker on Linux and Docker on macOS both run the container as a plain UID
	# 1000 user with no UID remapping, so they share one environment.
	ubuntu | macos-docker) echo ".env.ubuntu" ;;
	nixos) echo ".env.podman" ;;
	macos-podman) echo ".env.macos-podman" ;;
	*) return 1 ;;
	esac
}

variant_label() {
	case "$1" in
	ubuntu) echo "Docker on Linux" ;;
	nixos) echo "rootless Podman on Linux" ;;
	macos-docker) echo "Docker Desktop or OrbStack on macOS" ;;
	macos-podman) echo "rootless Podman on macOS (podman machine)" ;;
	*) return 1 ;;
	esac
}

# Guess the variant from the host. Deliberately conservative: it prefers to say
# nothing and let you name one rather than to pick wrong, because picking wrong
# produces a container that builds and then misbehaves.
detect_variant() {
	if [ "$(uname -s)" = "Darwin" ]; then
		if command -v podman >/dev/null 2>&1 && podman machine list --format '{{.Name}}' 2>/dev/null | grep -q .; then
			echo "macos-podman"
		elif command -v docker >/dev/null 2>&1; then
			echo "macos-docker"
		fi
		return 0
	fi

	# Linux. `docker` may itself be podman (podman-docker, or an alias), so ask
	# what is actually there before trusting the name — the same reasoning
	# deployments/local/Makefile applies when it probes for a container tool.
	if command -v docker >/dev/null 2>&1 && ! docker --version 2>/dev/null | grep -qi podman; then
		echo "ubuntu"
	elif command -v podman >/dev/null 2>&1; then
		echo "nixos"
	fi
}

if [ -z "$VARIANT" ]; then
	VARIANT="$(detect_variant)"

	if [ -z "$VARIANT" ]; then
		echo "error: could not tell what container runtime this host uses." >&2
		echo "       Name a variant: ubuntu | nixos | macos-docker | macos-podman" >&2
		exit 1
	fi

	echo "Detected host: $(variant_label "$VARIANT")  [$VARIANT]"
fi

COMPOSE_SRC="$(variant_compose "$VARIANT")" || {
	echo "error: unknown variant '$VARIANT'." >&2
	echo "       Expected one of: ubuntu | nixos | macos-docker | macos-podman" >&2
	exit 2
}
ENV_SRC="$(variant_env "$VARIANT")"

for src in "$COMPOSE_SRC" "$ENV_SRC"; do
	if [ ! -f "$src" ]; then
		echo "error: '$src' is missing from $(pwd)." >&2
		exit 1
	fi
done

echo "  docker-compose.local.yml  <-  $COMPOSE_SRC"
echo "  .env                      <-  $ENV_SRC"

if [ "$PRINT_ONLY" = "1" ]; then
	exit 0
fi

if [ "$FORCE" != "1" ]; then
	for dst in docker-compose.local.yml .env; do
		if [ -e "$dst" ]; then
			echo "error: '$dst' already exists; re-run with --force to replace it." >&2
			exit 1
		fi
	done
fi

cp "$COMPOSE_SRC" docker-compose.local.yml
cp "$ENV_SRC" .env

# The machine-size check (see the header). Nothing else here is macOS-specific:
# there is no socket path to resolve, because this row has no host runtime socket
# to bind — see .env.macos-podman.
if [ "$VARIANT" = "macos-podman" ]; then
	if ! command -v podman >/dev/null 2>&1; then
		echo "warning: podman is not on PATH, so the machine's size was not checked." >&2
	elif [ "$(podman machine inspect --format '{{.State}}' 2>/dev/null || true)" != "running" ]; then
		echo "warning: no running podman machine, so its size was not checked." >&2
		echo "         Start one and re-run with --force:  podman machine start" >&2
	else
		# The image alone is ~1.9 GB of gg toolchains on top of a Rust/Node
		# toolchain, and what runs in it is `cargo build --workspace`. A stock
		# machine is 2 CPUs / 2 GB, which does not fail with a message about
		# resources — it OOM-kills rustc partway through a link.
		cpus="$(podman machine inspect --format '{{.Resources.CPUs}}' 2>/dev/null || echo "")"
		memory="$(podman machine inspect --format '{{.Resources.Memory}}' 2>/dev/null || echo "")"
		disk="$(podman machine inspect --format '{{.Resources.DiskSize}}' 2>/dev/null || echo "")"

		# One flag per dimension rather than one chained condition: `&&` and `||`
		# have equal precedence and associate left-to-right in shell, so the
		# chained form answers a different question than it reads as.
		undersized=0

		if [ -n "$cpus" ] && [ "$cpus" -lt 6 ] 2>/dev/null; then undersized=1; fi
		if [ -n "$memory" ] && [ "$memory" -lt 12288 ] 2>/dev/null; then undersized=1; fi
		if [ -n "$disk" ] && [ "$disk" -lt 120 ] 2>/dev/null; then undersized=1; fi

		if [ "$undersized" = "1" ]; then
			echo
			echo "warning: this podman machine has ${cpus:-?} CPUs, ${memory:-?} MB RAM, ${disk:-?} GB disk."
			echo "         Building this workspace wants more. Resize it (the machine must be"
			echo "         stopped, and the disk can only grow):"
			echo
			echo "           podman machine stop"
			echo "           podman machine set --cpus 8 --memory 16384 --disk-size 200"
			echo "           podman machine start"
		fi

		# The workspace must be somewhere the machine shares into the VM, because
		# a bind mount's source is resolved on the Mac. `podman machine` shares
		# $HOME by default; a clone outside it needs `podman machine init -v`.
		repo_root="$(cd .. && pwd)"

		case "$repo_root" in
		"$HOME"/*) ;;
		*)
			echo
			echo "warning: this checkout ($repo_root) is not under \$HOME, which is what"
			echo "         'podman machine' shares into the VM by default. A bind mount whose"
			echo "         source the machine cannot see fails the whole 'up'. Recreate the"
			echo "         machine with the path, or move the checkout under \$HOME:"
			echo
			echo "           podman machine init -v $repo_root:$repo_root"
			;;
		esac
	fi
fi

echo
echo "Done. Now run 'Dev Containers: Reopen in Container' in VS Code."

if [ "$VARIANT" = "macos-podman" ]; then
	echo "If you have not already, point the extension at Podman in VS Code settings:"
	echo '  "dev.containers.dockerPath": "podman",'
	echo '  "dev.containers.dockerComposePath": "podman-compose"'
fi
