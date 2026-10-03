#!/usr/bin/env bash
# Places cargo's target directory for this checkout, and links
# /cargo-target/the-test-cabinet to wherever that is. post-create.sh runs it
# once, when the container is created; it is idempotent and safe to run again
# by hand.
#
# On a checkout mounted over virtiofs or FUSE (Podman on macOS, Docker
# Desktop), parallel rustc processes writing crate metadata into the checkout's
# `target/` fail intermittently with E0463 ("can't find crate"): the host
# filesystem does not make one process's writes visible to the next in time.
# There, cargo is pointed at ~/.cache/cargo-target/the-test-cabinet, in the
# container's own layer, through a marked block in ~/.cargo/config.toml and an
# exported CARGO_TARGET_DIR in ~/.bashrc. On every other filesystem cargo keeps
# `target/` in the checkout, where `make clean` reaches it.
# TCAB_CARGO_TARGET_RELOCATE=1 forces the move and =0 forbids it. When
# CARGO_TARGET_DIR is already set the choice has been made, and nothing is
# touched.
#
# Either way /cargo-target/the-test-cabinet is linked to the directory cargo
# builds into: the path the test cases' reference implementations default to
# and one of the local gg candidates crates/core looks for, so a path such as
# /cargo-target/the-test-cabinet/debug/gg works on every host. The image
# creates /cargo-target owned by the container user, so the link needs no
# privilege.
#
# It never exits non-zero: a container whose creation fails over the placement
# of a build directory is worse than one that says what it could not do. What
# it relocates is lost with the container's layer, so a rebuilt container
# builds from scratch.
#
# Two variables exist for scripts/devcontainer-cargo-target.test.sh alone:
#   TCAB_DEVCONTAINER_TEST_FSTYPE=<type>  stands in for the checkout's filesystem
#   TCAB_CARGO_TARGET_LINK_ROOT=<dir>     stands in for /cargo-target
set -uo pipefail

readonly BLOCK_BEGIN='# >>> tcab cargo-target >>>'
readonly BLOCK_END='# <<< tcab cargo-target <<<'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly ROOT

say() { printf 'cargo-target: %s\n' "$*"; }

checkout_fstype() {
	if [ -n "${TCAB_DEVCONTAINER_TEST_FSTYPE:-}" ]; then
		printf '%s\n' "$TCAB_DEVCONTAINER_TEST_FSTYPE"
		return
	fi
	local fstype
	fstype="$(findmnt -no FSTYPE --target "$ROOT" 2>/dev/null | head -n 1)"
	if [ -z "$fstype" ]; then
		fstype="$(stat -f -c %T "$ROOT" 2>/dev/null)"
	fi
	printf '%s\n' "${fstype:-unknown}"
}

# Whether cargo's metadata writes are unreliable on this filesystem.
relocating_fstype() {
	case "$1" in
	virtiofs | fuse | fuse.* | fuseblk | 9p | grpcfuse | fakeowner) return 0 ;;
	*) return 1 ;;
	esac
}

# Replace the marked block in a file with the given body, in place, or append
# it when the file has none, so a second run never writes it twice.
write_block() { # file body
	local file="$1" body="$2" tmp
	mkdir -p "$(dirname "$file")" || return 1
	touch "$file" || return 1
	tmp="$(mktemp "$file.XXXXXX")" || return 1
	if grep -qxF "$BLOCK_BEGIN" "$file"; then
		awk -v begin="$BLOCK_BEGIN" -v end="$BLOCK_END" -v body="$body" '
			$0 == begin { print; print body; inside = 1; next }
			$0 == end { inside = 0 }
			!inside { print }
		' "$file" >"$tmp"
	else
		{
			cat "$file"
			if [ -s "$file" ] && [ -n "$(tail -c 1 "$file")" ]; then
				printf '\n'
			fi
			printf '%s\n%s\n%s\n' "$BLOCK_BEGIN" "$body" "$BLOCK_END"
		} >"$tmp"
	fi
	mv "$tmp" "$file"
}

# Whether the file has a [build] table outside this script's block, which is
# a developer's own and is not written over.
has_foreign_build_table() { # file
	[ -f "$1" ] || return 1
	awk -v begin="$BLOCK_BEGIN" -v end="$BLOCK_END" '
		$0 == begin { inside = 1; next }
		$0 == end { inside = 0; next }
		!inside && /^[[:space:]]*\[build\][[:space:]]*(#.*)?$/ { found = 1 }
		END { exit !found }
	' "$1"
}

link_target() { # directory
	local root="${TCAB_CARGO_TARGET_LINK_ROOT:-/cargo-target}"
	local link="$root/the-test-cabinet"
	if [ -e "$link" ] && [ ! -L "$link" ]; then
		say "$link is a real directory, not a link; left untouched"
		return
	fi
	if mkdir -p "$root" 2>/dev/null && ln -sfn "$1" "$link" 2>/dev/null; then
		say "$link -> $1"
	else
		say "could not link $link; run:"
		say "    sudo mkdir -p $root && sudo ln -sfn \"$1\" $link"
	fi
}

place() {
	if [ -n "${CARGO_TARGET_DIR:-}" ]; then
		say "CARGO_TARGET_DIR is already $CARGO_TARGET_DIR; cargo's target and the /cargo-target link are left as they are"
		return
	fi

	local fstype relocate=0 target
	fstype="$(checkout_fstype)"
	case "${TCAB_CARGO_TARGET_RELOCATE:-}" in
	1) relocate=1 ;;
	0) relocate=0 ;;
	*) relocating_fstype "$fstype" && relocate=1 ;;
	esac

	if [ "$relocate" = 1 ]; then
		target="$HOME/.cache/cargo-target/the-test-cabinet"
		mkdir -p "$target"
		local config="${CARGO_HOME:-$HOME/.cargo}/config.toml"
		if has_foreign_build_table "$config"; then
			say "$config already has a [build] table; add this line to it:"
			say "    target-dir = \"$target\""
		else
			write_block "$config" "[build]
target-dir = \"$target\"" ||
				say "could not write $config"
		fi
		write_block "$HOME/.bashrc" "export CARGO_TARGET_DIR=\"$target\"" ||
			say "could not write $HOME/.bashrc"
		say "cargo builds into $target, in the container layer:"
		say "  the checkout is on $fstype, where parallel rustc processes writing crate"
		say "  metadata fail intermittently with E0463 (\"can't find crate\")."
		say "  Open a new shell, or export CARGO_TARGET_DIR=\"$target\", to use it now."
	else
		target="$ROOT/target"
		say "cargo builds into $target (the checkout is on $fstype)"
	fi

	link_target "$target"
}

place
exit 0
