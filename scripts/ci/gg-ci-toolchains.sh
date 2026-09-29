#!/usr/bin/env bash
# Provisions, from a cached directory, everything a pipeline job needs to build
# or test Rust in this workspace beyond what the Rust CI image carries: Node, and
# gg's program-language and C# build toolchains.
#
#   scripts/ci/gg-ci-toolchains.sh <cache-dir>              # Node, then gg's toolchains
#   scripts/ci/gg-ci-toolchains.sh <cache-dir> --node-only  # Node alone
#
# It is the one provisioner for every job that compiles the workspace: the
# template's `rust` job (through .azure/project/setup-steps.yml), the project's
# Rust container jobs, and the arm64 gg build on the organisation's pool, all
# through .azure/tcab/gg-toolchains-steps.yml, which restores <cache-dir> with a
# Cache@2 task first and saves it after a job that succeeded.
#
# WHY IT EXISTS. The template's Rust CI image carries the compiler, nextest and
# the apt packages the `rust_ci_packages` answer names, and deliberately no Node
# and nothing project-specific. Building crates/gg needs both: its build script
# reflects gg's signature catalogues with the npm workspace's pinned
# `typescript`, and every arm's SDK and documentation tool (about 3.4 GB, see
# scripts/ci/install-gg-toolchains.sh). The developer's devcontainer installs
# the same set through scripts/devcontainer-setup.sh, from the same installers.
#
# WHAT IT DOES, in order:
#
#   1. Node, at the NODE_VERSION .devcontainer/docker-compose.yml pins (read with
#      the template's `build_arg`), from the official tarball into
#      <cache-dir>/node, then `##vso[task.prependpath]` so every later step of the
#      job finds it. scripts/ci/npm-install.sh refuses any other Node.
#   2. The default install locations under $HOME that the gg installers and
#      crates/gg/build.rs use become symlinks into <cache-dir>/home: $HOME/.local
#      (every pinned toolchain prefix, `purs`, `esbuild`, uv's own dirs), uv's
#      download cache (the CPython and pinned wheels the Python arm resolves
#      offline), the Ruby gem user dir when it is not under .local (the pinned
#      YARD), and NuGet's package folder. Each consumer then finds its tools where
#      it looks by default, with nothing exported. What the image or an earlier
#      step already put at one of those paths is merged into the cache first.
#   3. scripts/ci/install-gg-toolchains.sh and
#      scripts/ci/install-gg-build-toolchains.sh. Each installer compares what
#      it finds with its pin and touches no network when they match, so on a warm
#      cache the two take seconds. Then `##vso[task.prependpath]` for
#      $HOME/.local/bin, where `purs`, `esbuild` and the other pinned binaries
#      live.
#
# THE ONE DOWNLOAD A WARM CACHE CANNOT AVOID. scripts/ci/install-rust-wasm.sh
# adds the `wasm32-wasip1` standard library (tens of MB compressed) to the
# toolchain under the image's RUSTUP_HOME, which is outside $HOME and outside the
# cache, so every job that runs step 3 downloads it again.
#
# ACCOUNTS. In a container job the step runs as the agent's uid (1001) with
# HOME=/root, which the image opens to every uid; nothing here uses sudo. The
# interpreters the installers assume (ruby, python3, curl, xz) come from the
# image's packages. On the arm64 pool it runs as the agent user, in its own home.
#
# Outside a pipeline the `##vso` lines are inert text, so a developer can run
# this against a scratch directory to reproduce a job's provisioning.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/lib.sh
source "$here/lib.sh"
# shellcheck source=scripts/ci/tcab-lib.sh
source "$here/tcab-lib.sh"

usage() {
	echo "usage: scripts/ci/gg-ci-toolchains.sh <cache-dir> [--node-only]" >&2
	exit 2
}

[[ $# -ge 1 && $# -le 2 ]] || usage
node_only=false
if [[ $# -eq 2 ]]; then
	[[ "$2" == --node-only ]] || usage
	node_only=true
fi
mkdir -p "$1"
cache="$(cd "$1" && pwd)"
readonly cache node_only

# --- 1. Node -------------------------------------------------------------------------------------
node_version="$(build_arg NODE_VERSION)"
readonly node_version
case "$(uname -m)" in
	x86_64 | amd64) node_arch=x64 ;;
	aarch64 | arm64) node_arch=arm64 ;;
	*)
		echo "no Node build is published for $(uname -m)" >&2
		exit 1
		;;
esac
readonly node_dir="$cache/node"

log "Node $node_version -> $node_dir"
if [[ -x "$node_dir/bin/node" && "$("$node_dir/bin/node" --version 2>/dev/null)" == "v$node_version" ]]; then
	echo "Node v$node_version is already in the cache"
else
	staging="$(mktemp -d)"
	curl -fsSL --retry 5 --retry-delay 5 \
		"https://nodejs.org/dist/v${node_version}/node-v${node_version}-linux-${node_arch}.tar.xz" \
		-o "$staging/node.tar.xz"
	rm -rf "$node_dir"
	mkdir -p "$node_dir"
	tar -xJf "$staging/node.tar.xz" -C "$node_dir" --strip-components=1
	rm -rf "$staging"
	"$node_dir/bin/node" --version
fi
export PATH="$node_dir/bin:$PATH"
echo "##vso[task.prependpath]$node_dir/bin"

if [[ "$node_only" == true ]]; then
	log "Node only: gg's toolchains are not provisioned"
	exit 0
fi

# --- 2. $HOME's install locations, into the cache ------------------------------------------------
#
# Makes $HOME/<rel> a symlink to <cache>/home/<rel>. A real directory already there is merged into
# the cache without replacing what the cache holds, then replaced by the link.
link_home() {
	local rel="$1"
	local target="$cache/home/$rel" link="$HOME/$rel"
	mkdir -p "$target"
	if [[ -L "$link" ]]; then
		[[ "$(readlink "$link")" == "$target" ]] && return 0
		rm -f "$link"
	elif [[ -d "$link" ]]; then
		tar -C "$link" -cf - . | tar -C "$target" --skip-old-files -xf -
		rm -rf "$link"
	elif [[ -e "$link" ]]; then
		echo "$link is neither a directory nor a symlink, so it cannot be moved into the cache." >&2
		exit 1
	fi
	mkdir -p "$(dirname "$link")"
	ln -s "$target" "$link"
	echo "$link -> $target"
}

log "gg's install locations under $HOME -> $cache/home"
# Every pinned toolchain prefix (.local/share/tcab, gg-java, gg-kotlin), the binaries in .local/bin,
# and uv's default Python and tool directories.
link_home .local
# uv's download cache, where the Python arm's CPython, griffe and wheels are resolved offline from.
link_home .cache/uv
# NuGet's global package folder, which the C# arm's MSBuild restores into.
link_home .nuget
# The pinned YARD is a `gem install --user-install`, into Gem.user_dir: under .local on a Ruby that
# follows XDG, but ~/.gem on one that does not.
if command -v ruby >/dev/null 2>&1; then
	gem_dir="$(ruby -e 'print Gem.user_dir')"
	case "$gem_dir" in
		"$HOME"/.local/*) ;;
		"$HOME"/*)
			rel="${gem_dir#"$HOME"/}"
			link_home "${rel%%/*}"
			;;
		*) echo "Gem.user_dir is $gem_dir, outside $HOME; YARD is installed there uncached" ;;
	esac
fi
# The image names uv a Python directory outside $HOME for the root user that built it. When the
# job's uid cannot write it, uv's Python installs go to its default under the cached .local instead,
# for this step and every later one.
if [[ -n "${UV_PYTHON_INSTALL_DIR:-}" && ! -w "$UV_PYTHON_INSTALL_DIR" && ! -w "$(dirname "$UV_PYTHON_INSTALL_DIR")" ]]; then
	UV_PYTHON_INSTALL_DIR="$HOME/.local/share/uv/python"
	export UV_PYTHON_INSTALL_DIR
	echo "##vso[task.setvariable variable=UV_PYTHON_INSTALL_DIR]$UV_PYTHON_INSTALL_DIR"
fi

# --- 3. gg's toolchains --------------------------------------------------------------------------
export PATH="$HOME/.local/bin:$PATH"
log "gg's program-language toolchains"
./scripts/ci/install-gg-toolchains.sh
log "gg's C# build toolchains"
./scripts/ci/install-gg-build-toolchains.sh
echo "##vso[task.prependpath]$HOME/.local/bin"

log "gg's toolchains are provisioned ($(du -sh "$cache" 2>/dev/null | cut -f1) cached)"
