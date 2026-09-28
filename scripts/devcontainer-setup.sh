#!/usr/bin/env bash
# Provisions the dev container with what The Test Cabinet needs beyond the image.
#
#   bash scripts/devcontainer-setup.sh              foreground: returns in seconds
#   bash scripts/devcontainer-setup.sh --provision  the long work (normally spawned)
#
# WHY IT EXISTS. The dev container's image is the workspace template's, and the
# template gives a project no layer of its own and no post-create or post-start
# hook: the one project-owned thing its lifecycle runs is the root package.json's
# npm lifecycle scripts, through the `npm ci` in `.devcontainer/post-create.sh`.
# So the root `postinstall` runs this script, and this script does what the image
# used to bake in:
#
#   - apt packages the image does not carry: ruby (gg's Ruby arm reflects its
#     catalogue with YARD, so `cargo build --workspace` needs it, and the gg
#     installer refuses to run without it), libicu-dev (the C# arm's `csc`),
#     ffmpeg (`scripts/build-sample-pack.mjs` silently degrades without it),
#     cmake, and iproute2, lsof and procps (`ss`, `lsof` and `ps` for the local
#     cluster tooling and `scripts/free-local-forward.sh`);
#   - gg's toolchains: `scripts/ci/install-gg-toolchains.sh` (the eleven arms,
#     the wasm32 target among them) and `scripts/ci/install-gg-build-toolchains.sh`
#     (what building the C# guest needs);
#   - wrangler, which `tcab publish` shells out to.
#
# Without them, building crates/gg fails, and so do the rust-clippy and rust-doc
# hooks of any commit that touches Rust.
#
# WHAT IT COSTS, AND WHY IT RUNS IN THE BACKGROUND. The first create downloads
# and unpacks about 3.4 GB, which takes up to an hour. `post-create.sh` runs
# `npm ci` under `set -e`, and a bring-up with a deadline must not wait an hour,
# so the foreground only places cargo's target directory (below), then spawns
# `--provision` detached and returns. This script never exits non-zero: a
# failure here must not fail the container's creation.
#
#   log     ~/.cache/tcab-devcontainer-setup.log
#   marker  ~/.cache/tcab-devcontainer-setup.done  (written on full success; it
#           holds a digest of the provisioning inputs, so moving a pin
#           re-provisions on the next run)
#   pid     ~/.cache/tcab-devcontainer-setup.pid
#
# RECOVERY. A provisioner stopped mid-run (the container stopped, the machine
# rebooted) writes no marker, and a restart runs no post-create. With no marker
# and no provisioner running, run `bash scripts/devcontainer-setup.sh` again: it
# resumes, because every installer skips what is already at its pin. An
# abandoned lock file is no obstacle; the lock dies with the process holding it.
#
# CARGO'S TARGET DIRECTORY. On a checkout mounted over virtiofs or FUSE (macOS
# Podman, Docker Desktop), parallel rustc processes writing crate metadata into
# `target/` fail intermittently with E0463 ("can't find crate"). There this
# script moves cargo's target into the container layer,
# ~/.cache/cargo-target/the-test-cabinet, through a marked block in
# ~/.cargo/config.toml and an exported CARGO_TARGET_DIR in ~/.bashrc. On any
# other filesystem cargo keeps `target/` in the checkout.
# TCAB_CARGO_TARGET_RELOCATE=1 forces the move and =0 forbids it. Either way,
# /cargo-target/the-test-cabinet is linked to the directory cargo builds into,
# the path the reference implementations' scripts and gg's local candidates
# default to. When CARGO_TARGET_DIR is already set, the choice has been made and
# neither is touched.
#
# $HOME does not survive a rebuild: the toolchains, the marker and a relocated
# target are downloaded or built again after every rebuild.
#
# WHEN IT DOES NOTHING. It prints one line and exits 0 in CI (TF_BUILD,
# BUILD_BUILDID or CI set), when TCAB_SKIP_DEVCONTAINER_SETUP is set, outside a
# container (no /.dockerenv or /run/.containerenv), and when this checkout is
# not ${TCAB_DEVCONTAINER_WORKSPACE:-/workspaces/the-test-cabinet} holding
# .devcontainer/devcontainer.json. So image builds, CI jobs, host checkouts and
# linked worktrees all skip it.
#
# Exist only for scripts/devcontainer-setup.test.sh:
#   TCAB_DEVCONTAINER_TEST_IN_CONTAINER=1|0  stands in for the container check
#   TCAB_DEVCONTAINER_TEST_FSTYPE=<type>     stands in for the workspace's filesystem
#   TCAB_CARGO_TARGET_LINK_ROOT=<dir>        stands in for /cargo-target
set -uo pipefail

readonly BLOCK_BEGIN='# >>> tcab devcontainer-setup >>>'
readonly BLOCK_END='# <<< tcab devcontainer-setup <<<'
readonly RERUN='bash scripts/devcontainer-setup.sh'

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "$SELF")/.." && pwd -P)"
WORKSPACE="${TCAB_DEVCONTAINER_WORKSPACE:-/workspaces/the-test-cabinet}"

say() { printf 'devcontainer-setup: %s\n' "$*"; }

skip() {
	say "skipped: $*"
	exit 0
}

in_container() {
	case "${TCAB_DEVCONTAINER_TEST_IN_CONTAINER:-}" in
	1) return 0 ;;
	0) return 1 ;;
	esac
	[ -e /.dockerenv ] || [ -e /run/.containerenv ]
}

guard() {
	local var
	for var in TF_BUILD BUILD_BUILDID CI TCAB_SKIP_DEVCONTAINER_SETUP; do
		if [ -n "${!var+set}" ]; then
			skip "$var is set"
		fi
	done
	in_container || skip "not inside a container"
	local workspace
	workspace="$(cd "$WORKSPACE" 2>/dev/null && pwd -P)" ||
		skip "no workspace at $WORKSPACE"
	if [ "$ROOT" != "$workspace" ] || [ ! -f "$ROOT/.devcontainer/devcontainer.json" ]; then
		skip "$ROOT is not the dev container's workspace ($WORKSPACE)"
	fi
	cd "$ROOT" || skip "cannot enter $ROOT"
}

# ── cargo's target directory ────────────────────────────────────────────────

workspace_fstype() {
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
# it when the file has none. A re-run therefore never writes it twice.
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

# Whether the file has a [build] table outside this script's block.
has_foreign_build_table() { # file
	[ -f "$1" ] || return 1
	awk -v begin="$BLOCK_BEGIN" -v end="$BLOCK_END" '
		$0 == begin { inside = 1; next }
		$0 == end { inside = 0; next }
		!inside && /^[[:space:]]*\[build\][[:space:]]*(#.*)?$/ { found = 1 }
		END { exit !found }
	' "$1"
}

place_cargo_target() {
	if [ -n "${CARGO_TARGET_DIR:-}" ]; then
		say "CARGO_TARGET_DIR is already $CARGO_TARGET_DIR; cargo's target and the /cargo-target link are left as they are"
		return
	fi

	local fstype relocate=0 link_target
	fstype="$(workspace_fstype)"
	case "${TCAB_CARGO_TARGET_RELOCATE:-}" in
	1) relocate=1 ;;
	0) relocate=0 ;;
	*) relocating_fstype "$fstype" && relocate=1 ;;
	esac

	if [ "$relocate" = 1 ]; then
		link_target="$HOME/.cache/cargo-target/the-test-cabinet"
		mkdir -p "$link_target"
		local config="${CARGO_HOME:-$HOME/.cargo}/config.toml"
		if has_foreign_build_table "$config"; then
			say "$config already has a [build] table; add this line to it:"
			say "    target-dir = \"$link_target\""
		else
			write_block "$config" "[build]
target-dir = \"$link_target\"" ||
				say "could not write $config"
		fi
		write_block "$HOME/.bashrc" "export CARGO_TARGET_DIR=\"$link_target\"" ||
			say "could not write $HOME/.bashrc"
		say "cargo builds into $link_target, in the container layer:"
		say "  the checkout is on $fstype, where parallel rustc processes writing crate"
		say "  metadata fail intermittently with E0463 (\"can't find crate\")."
		say "  Open a new shell, or export CARGO_TARGET_DIR=\"$link_target\", to use it now."
	else
		link_target="$ROOT/target"
		say "cargo builds into $link_target (the checkout is on $fstype)"
	fi

	link_cargo_target "$link_target"
}

link_cargo_target() { # target
	local root="${TCAB_CARGO_TARGET_LINK_ROOT:-/cargo-target}"
	local link="$root/the-test-cabinet"
	if [ -e "$link" ] && [ ! -L "$link" ]; then
		say "$link is a real directory, not a link; left untouched"
		return
	fi
	if sudo -n mkdir -p "$root" >/dev/null 2>&1 &&
		sudo -n ln -sfn "$1" "$link" >/dev/null 2>&1; then
		say "$link -> $1"
	else
		say "could not link $link; run:"
		say "    sudo mkdir -p $root && sudo ln -sfn \"$1\" $link"
	fi
}

# ── provisioning ────────────────────────────────────────────────────────────

readonly APT_PACKAGES=(ruby libicu-dev ffmpeg cmake iproute2 lsof procps)

cache_dir() { printf '%s\n' "$HOME/.cache"; }

# A digest of everything provisioning reads, so a moved pin re-provisions.
inputs_digest() {
	local files=()
	shopt -s nullglob
	files+=(scripts/ci/install-*.sh scripts/ci/fetch.sh scripts/gg-*.sh)
	files+=(packages/gg-sandbox-*/*-version.sh rust-toolchain.toml scripts/devcontainer-setup.sh)
	shopt -u nullglob
	local file
	for file in "${files[@]}"; do
		[ -f "$file" ] && sha256sum -- "$file"
	done | sha256sum | cut -d ' ' -f 1
}

missing_packages() {
	local package
	for package in "${APT_PACKAGES[@]}"; do
		if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null |
			grep -q 'install ok installed'; then
			printf '%s\n' "$package"
		fi
	done
}

provision_failed() { # command...
	say "FAILED: $*"
	say "nothing is marked done; once the cause is fixed, run: $RERUN"
	exit 0
}

provision() {
	local cache lock
	cache="$(cache_dir)"
	lock="$cache/tcab-devcontainer-setup.lock"
	mkdir -p "$cache"
	# The foreground hands over the lock it already holds (descriptor 9), so a
	# second foreground run between the spawn and this line sees it held.
	if [ "${TCAB_DEVCONTAINER_SETUP_LOCK_FD:-}" != 9 ]; then
		exec 9>>"$lock"
	fi
	unset TCAB_DEVCONTAINER_SETUP_LOCK_FD
	if ! flock -n 9; then
		say "another provisioner holds $lock; nothing to do"
		exit 0
	fi
	printf '%s\n' "$$" >"$cache/tcab-devcontainer-setup.pid"
	say "provisioning started at $(date -u +%FT%TZ), pid $$"

	case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) PATH="$HOME/.local/bin:$PATH" ;; esac
	case ":$PATH:" in *":$HOME/.cargo/bin:"*) ;; *) PATH="$HOME/.cargo/bin:$PATH" ;; esac
	export PATH

	local digest missing=()
	digest="$(inputs_digest)"
	mapfile -t missing < <(missing_packages)
	if [ "${#missing[@]}" -gt 0 ]; then
		say "apt: installing ${missing[*]}"
		timeout 900 sudo -n apt-get update -y 9>&- ||
			provision_failed "sudo -n apt-get update -y"
		timeout 900 sudo -n env DEBIAN_FRONTEND=noninteractive \
			apt-get install -y "${missing[@]}" 9>&- ||
			provision_failed "sudo -n apt-get install -y ${missing[*]}"
	else
		say "apt: ${APT_PACKAGES[*]} already installed"
	fi

	# Each command runs with the lock's descriptor closed, so a daemon one of them
	# leaves behind (a build server, say) cannot keep the lock held after this
	# process ends.
	local installer
	for installer in scripts/ci/install-gg-toolchains.sh scripts/ci/install-gg-build-toolchains.sh; do
		say "running $installer"
		bash "$installer" 9>&- || provision_failed "bash $installer"
	done

	if command -v wrangler >/dev/null 2>&1; then
		say "wrangler: already on PATH"
	else
		say "wrangler: installing into $HOME/.local"
		npm install -g --prefix "$HOME/.local" wrangler 9>&- ||
			provision_failed "npm install -g --prefix $HOME/.local wrangler"
	fi

	printf '%s\n' "$digest" >"$cache/tcab-devcontainer-setup.done"
	say "provisioned at $(date -u +%FT%TZ); marker $cache/tcab-devcontainer-setup.done"
}

foreground() {
	place_cargo_target

	local cache marker log lock
	cache="$(cache_dir)"
	marker="$cache/tcab-devcontainer-setup.done"
	log="$cache/tcab-devcontainer-setup.log"
	lock="$cache/tcab-devcontainer-setup.lock"
	mkdir -p "$cache" || skip "cannot create $cache"

	if [ -f "$marker" ] && [ "$(cat "$marker")" = "$(inputs_digest)" ]; then
		say "provisioned (gg's toolchains, apt packages and wrangler are current)"
		exit 0
	fi

	exec 9>>"$lock" || skip "cannot open $lock"
	if ! flock -n 9; then
		say "a provisioner is already running (pid $(cat "$cache/tcab-devcontainer-setup.pid" 2>/dev/null || echo '?'))"
		say "  tail -f $log"
		exit 0
	fi

	# Every descriptor that could be a pipe is redirected, or `npm ci` would wait
	# on the provisioner through the output pipe it captures.
	TCAB_DEVCONTAINER_SETUP_LOCK_FD=9 setsid nohup bash "$SELF" --provision \
		</dev/null >>"$log" 2>&1 &
	say "provisioning in the background (about 3.4 GB, up to an hour on a first create)"
	say "  log:    $log"
	say "  marker: $marker"
	say "building crates/gg and the rust-clippy/rust-doc hooks need this; tail the log;"
	say "if it stops without the marker, run \`$RERUN\` again"
}

guard
case "${1:-}" in
--provision) provision ;;
"") foreground ;;
*)
	say "unknown argument: $1 (usage: $RERUN [--provision])"
	;;
esac
exit 0
