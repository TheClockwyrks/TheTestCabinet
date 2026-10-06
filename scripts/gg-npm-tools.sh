# shellcheck shell=bash
#
# Resolve one pinned npm-delivered BUILD tool for a gg arm, without reaching a registry on a machine
# that has already been provisioned. Sourced, never executed.
#
#   gg_npm_tool <package> <version>   # prints a directory holding `node_modules/<package>`
#
# WHAT THIS IS FOR. Three of gg's arms build their artifacts with a tool that is published on npm and
# nowhere else: `@bytecodealliance/componentize-js` bakes the Ruby guest component,
# `opal-compiler` carries the Opal runtime and self-hosted compiler the Ruby arm is made of, and
# `spago` resolves the PureScript package set. Each `build.sh` used to reach for its own with `npx
# --yes` or `npm install --prefix .build`, which meant a REGISTRY CALL from inside what is now an
# ordinary `cargo build` — see `scripts/gg-artifacts.sh`'s header on why that is not acceptable.
#
# WHY A PINNED PREFIX RATHER THAN THE REPOSITORY'S npm WORKSPACE. The obvious alternative is to add
# these as devDependencies of the guest packages, which are already npm workspaces, and let the
# repo-root `npm ci` install them. That was rejected on cost: `npm ci` at the root is run by every
# job in this repository — the web console's build, the docs site's, the linters, the spell check —
# and none of them has any business downloading a JavaScript-engine componentiser. These are gg BUILD
# toolchains, and gg's build toolchains live where the other eleven do: under a version-stamped
# per-user prefix, installed by `scripts/ci/install-gg-toolchains.sh`, which is the one script every
# surface that builds gg already runs. That is the same shape as `~/.local/share/tcab/gg-swift`,
# `~/.local/share/tcab/gg-wasi-sdk` and the rest, and it costs the rest of the repository nothing.
#
# THE WHOLE TREE IS PINNED, NOT THE ONE PACKAGE. A pin on `componentize-js@0.21.0` alone pins
# nothing below it: that package names `@bytecodealliance/jco` as `^1.15.1`, jco names
# `@bytecodealliance/preview2-shim` by a caret range of its own, and `npm install` resolves each range
# to whatever the registry holds on the day the prefix is installed. So two machines provisioned a
# week apart ran two different trees under the same stamp, and the tree decided whether the tool
# worked at all: preview2-shim 0.26.1 stopped preopening the host's root directory by default, the
# bindings splicer inside componentize-js 0.21.0 reads the WIT directory through that shim, and a
# prefix installed after 2026-09-28 failed every Ruby arm build with `reading file crates/gg/wit: No
# such file or directory (os error 44)` — on a path that existed — while a prefix installed before it
# kept working. Nothing in this repository had changed.
#
# Each tool therefore has a LOCK, committed under `scripts/gg-npm-locks/<stamp>/`: a `package.json`
# naming exactly the pinned version, and the `package-lock.json` npm resolved its tree to, which
# `npm ci` installs byte for byte and refuses to install anything else from. The componentize-js
# lock also carries an `overrides` entry holding preview2-shim at 0.26.0, the last release that
# preopens the root, for the reason above; it is in the lock's `package.json` because that is the
# one place npm reads an override from, and the reason is here because that file cannot hold a
# comment. A tool's pin is still the one in its arm's version file: the lock is checked against it
# and a lock that names another version is an error, not a second opinion.
#
# TO BUMP A TOOL, or to re-resolve its tree deliberately: change the pin in the arm's version file,
# then, in a scratch directory, write a `package.json` holding `"private": true` and the one
# dependency at its exact version (and the override, for componentize-js), run
# `npm install --package-lock-only --no-audit --no-fund`, and commit both files under the new stamp.
# The old stamp's directory goes with the old pin.
#
# THE RESOLUTION ORDER, and the first three touch no network:
#
#   1. `$TCAB_GG_NPM_PREFIX` — an operator override, for a machine that stages its own.
#   2. `/opt/gg/toolchains/npm` — where an image that bakes these would put them, the same `/opt`
#      prefix `gg_swift_home`, `gg_wasi_sdk_home` and `gg_dotnet_home` all probe first.
#   3. `$HOME/.local/share/tcab/gg-npm` — what `scripts/ci/install-gg-build-tools.sh` warms.
#   4. an install into (3), which is what a cold machine that skipped the installer does. One call,
#      once, into the same place the installer would have put it — so the next build is warm too.
#
# The directory is stamped with the package version AND the first eight hex digits of the lock's
# SHA-256, so a bumped pin or a re-resolved tree installs rather than silently reusing the previous
# tree, and two arms pinning the same tool at the same version share one copy while two arms
# pinning different versions do not collide. That is the same discipline
# `packages/gg-sandbox-*/bindings.sh` uses for `wit-bindgen`, extended to cover what the version
# alone did not.

# The stamp a tool's lock directory is named by: `@scope/name` becomes `scope-name` so it is one
# path segment, followed by the version.
gg_npm_tool_stamp() {
	local package="$1" version="$2" stamp
	stamp="$(printf '%s' "$package" | tr '/@' '--')"
	echo "${stamp#-}-$version"
}

# The committed lock for a tool: the directory holding its `package.json` and `package-lock.json`.
gg_npm_tool_lock_dir() {
	local package="$1" version="$2"
	echo "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gg-npm-locks/$(gg_npm_tool_stamp "$package" "$version")"
}

# The first eight hex digits of a file's SHA-256. `sha256sum` is coreutils; `shasum` is what a Mac
# has instead.
gg_npm_tool_digest() {
	local file="$1" sum
	if command -v sha256sum >/dev/null 2>&1; then
		sum="$(sha256sum "$file")"
	else
		sum="$(shasum -a 256 "$file")"
	fi
	echo "${sum:0:8}"
}

# The prefix a tool is installed under, given its package name and version: the stamp above, then
# the lock's digest, so the directory names the whole tree it holds.
gg_npm_tool_dir() {
	local package="$1" version="$2" lock stamp prefix
	lock="$(gg_npm_tool_lock_dir "$package" "$version")"
	if [ ! -f "$lock/package-lock.json" ] || [ ! -f "$lock/package.json" ]; then
		echo "error: $package@$version has no lock under scripts/gg-npm-locks/." >&2
		echo "       Every npm-delivered build tool is installed from a committed package.json and" >&2
		echo "       package-lock.json at $lock;" >&2
		echo "       scripts/gg-npm-tools.sh's header says how to write them for a new pin." >&2
		return 1
	fi
	stamp="$(gg_npm_tool_stamp "$package" "$version")-$(gg_npm_tool_digest "$lock/package-lock.json")"

	if [ -n "${TCAB_GG_NPM_PREFIX:-}" ]; then
		echo "$TCAB_GG_NPM_PREFIX/$stamp"
		return 0
	fi
	if [ -d "/opt/gg/toolchains/npm/$stamp/node_modules/$package" ]; then
		echo "/opt/gg/toolchains/npm/$stamp"
		return 0
	fi
	prefix="${GG_NPM_INSTALL_DIR:-$HOME/.local/share/tcab/gg-npm}"
	echo "$prefix/$stamp"
}

# Resolve a tool, installing it if this machine has not been provisioned, and print its directory.
# The caller then reaches `<dir>/node_modules/<package>` or `<dir>/node_modules/.bin/<binary>`.
#
# The presence check is on the package directory rather than on a marker file of this script's own
# invention: npm either unpacked the tree or it did not, and a marker is a second thing that can be
# true when the first is not.
gg_npm_tool() {
	local package="$1" version="$2" lock dir declared
	lock="$(gg_npm_tool_lock_dir "$package" "$version")"
	dir="$(gg_npm_tool_dir "$package" "$version")" || return 1

	# The lock's `package.json` has to name the version the caller pinned, exactly: a lock written
	# for one release and left behind by a bump would otherwise install the old tree under the new
	# stamp, and the pin in the version file would be a label on the wrong box.
	declared="$(node -p 'require(process.argv[1]).dependencies?.[process.argv[2]] ?? ""' \
		"$lock/package.json" "$package")"
	if [ "$declared" != "$version" ]; then
		echo "error: the lock at $lock pins $package at '${declared:-nothing}', not $version." >&2
		echo "       The pin in the arm's version file and the lock's package.json have to agree;" >&2
		echo "       scripts/gg-npm-tools.sh's header says how the lock is written." >&2
		return 1
	fi

	if [ ! -d "$dir/node_modules/$package" ]; then
		echo "==> installing $package@$version -> $dir" >&2
		mkdir -p "$dir"
		# The prefix is an `npm ci` of the committed lock and nothing else: `npm ci` installs exactly
		# what the lock resolved and fails if the manifest and the lock disagree, where `npm install`
		# would resolve every range again on the day and write a tree nobody reviewed. `--silent`
		# and the two `--no-*` flags keep an ordinary build's log about the build.
		cp "$lock/package.json" "$lock/package-lock.json" "$dir/"
		npm ci --silent --no-audit --no-fund --prefix "$dir" >&2
	fi

	if [ ! -d "$dir/node_modules/$package" ]; then
		echo "error: $package@$version is not at $dir after installing it." >&2
		return 1
	fi
	echo "$dir"
}
