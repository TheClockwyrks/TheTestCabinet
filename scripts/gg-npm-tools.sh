# shellcheck shell=bash
#
# Resolve one pinned npm-delivered BUILD tool for a gg arm, without reaching a registry on a machine
# that has already been provisioned. Sourced, never executed.
#
#   gg_npm_tool <package> <version>   # prints a directory holding `node_modules/<package>`
#
# WHAT THIS IS FOR. Four of gg's arms build their artifacts with a tool that is published on npm and
# nowhere else: `@bytecodealliance/componentize-js` bakes the TypeScript and Ruby guest components,
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
# THE RESOLUTION ORDER, and the first three touch no network:
#
#   1. `$TCAB_GG_NPM_PREFIX` — an operator override, for a machine that stages its own.
#   2. `/opt/gg/toolchains/npm` — where an image that bakes these would put them, the same `/opt`
#      prefix `gg_swift_home`, `gg_wasi_sdk_home` and `gg_dotnet_home` all probe first.
#   3. `$HOME/.local/share/tcab/gg-npm` — what `scripts/ci/install-gg-build-tools.sh` warms.
#   4. an install into (3), which is what a cold machine that skipped the installer does. One call,
#      once, into the same place the installer would have put it — so the next build is warm too.
#
# The directory is stamped with the package version, so a bumped pin installs rather than silently
# reusing the previous release's tree, and two arms pinning the same tool at the same version share
# one copy while two arms pinning different versions do not collide. That is the same discipline
# `packages/gg-sandbox-*/bindings.sh` uses for `wit-bindgen`.

# The prefix a tool is installed under, given its package name and version. `@scope/name` becomes
# `scope-name` so the stamp is one path segment.
gg_npm_tool_dir() {
	local package="$1" version="$2" stamp prefix
	stamp="$(printf '%s' "$package" | tr '/@' '--')"
	stamp="${stamp#-}-$version"

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
	local package="$1" version="$2" dir
	dir="$(gg_npm_tool_dir "$package" "$version")"

	if [ ! -d "$dir/node_modules/$package" ]; then
		echo "==> installing $package@$version -> $dir" >&2
		mkdir -p "$dir"
		# `--no-package-lock` because this prefix is a tool cache and not a project: a lockfile here
		# would be a second, unreviewed record of a version the caller already pinned. `--silent` and
		# the two `--no-*` flags keep an ordinary build's log about the build.
		npm install --silent --no-audit --no-fund --no-package-lock \
			--prefix "$dir" "$package@$version" >&2
	fi

	if [ ! -d "$dir/node_modules/$package" ]; then
		echo "error: $package@$version is not at $dir after installing it." >&2
		return 1
	fi
	echo "$dir"
}
