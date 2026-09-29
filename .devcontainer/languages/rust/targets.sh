#!/usr/bin/env bash
# Adds this architecture's musl target, for static builds.
set -euo pipefail

# Read out of the image rather than passed in as a build arg; see
# "Architecture" in README.md.
arch="$(dpkg --print-architecture)"
readonly arch

# rustup lands in CARGO_HOME, which languages/rust/rustup.sh leaves to the
# caller: the default under the container user's home here, /usr/local/cargo
# in the CI images under ci/images/.
readonly RUSTUP="${CARGO_HOME:-$HOME/.cargo}/bin/rustup"

# Whether a switch the environment states is on, `true` when it is unset.
switched_on() {
	local name="$1"
	local value
	value="$(printf '%s' "${!name:-true}" | tr '[:upper:]' '[:lower:]')"
	case "$value" in
	true | 1 | yes) return 0 ;;
	false | 0 | no) return 1 ;;
	*)
		echo "targets.sh: $name must be true or false, got '${!name:-}'" >&2
		exit 1
		;;
	esac
}

# The musl target backs portable, fully static builds: a static binary carries
# no dynamic loader, so it runs on a distribution that ships none of the usual
# FHS layout, NixOS among them, as well as on a mainstream one. The linker such
# a build needs is musl-gcc, and `musl-tools` (system/apt.sh) ships exactly one,
# for the architecture it was installed on, so the other architecture's musl
# target would be a cross build with nothing here to link it. INSTALL_MUSL,
# `true` when unset, turns it off for an image that builds nothing static.
add_musl_target() {
	if ! switched_on INSTALL_MUSL; then
		echo "targets.sh: INSTALL_MUSL=${INSTALL_MUSL:-}: skipping the musl target."
		return 0
	fi
	local target
	case "$arch" in
	amd64) target="x86_64-unknown-linux-musl" ;;
	arm64) target="aarch64-unknown-linux-musl" ;;
	*)
		echo "targets.sh: no musl target is known for Linux '$arch'" >&2
		exit 1
		;;
	esac
	"$RUSTUP" target add "$target"
}

add_musl_target
