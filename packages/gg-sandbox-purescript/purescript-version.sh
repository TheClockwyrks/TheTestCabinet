# shellcheck shell=bash
# shellcheck disable=SC2034  # every variable here is read by the scripts that source this file

# The toolchain this arm's programs are compiled with, pinned in one place.
#
# Three pins rather than one, because — unlike Ruby's, where a single Opal release decides both the
# compiler and the runtime it emits against — PureScript's halves are genuinely independent: `purs`
# decides what a program means, `esbuild` decides how the module graph it emits becomes one script,
# and the registry package set decides which libraries exist. What they share is that all three are
# baked into the library tree `build.sh` cuts into a cargo `OUT_DIR`, so bumping any of them
# rebuilds it — which now happens automatically, because this file is in the rerun set of
# `crates/gg-sandbox-artifacts/purescript`.
#
# The fourth pin, the registry package set, is deliberately NOT written here: it is read out of
# `spago.yaml` at the bottom of this file. See that block for why.

# The PureScript compiler. A model's program is compiled by this release on the host, against a
# library tree compiled by the same one — externs are a compiler-version-private format, so a tree
# built by one `purs` and read by another is not a supported combination.
#
# It is fetched as the platform tarball from the compiler's own GitHub releases rather than through
# the `purescript` npm package, because the run image needs the binary and not a node_modules tree:
# see `containers/gg-toolchains/Dockerfile`.
PURS_VERSION="0.15.16"

# The bundler. `purs` emits one ES module per PureScript module and the guest evaluates a single
# script, so something has to flatten the graph; esbuild also tree-shakes it, which is what keeps a
# program that imports `Data.Map` down to tens of kilobytes instead of the whole library set.
ESBUILD_VERSION="0.28.1"

# Spago, which resolves the package set and fetches the sources. Build-time only: nothing at run
# time knows Spago exists, because the tree it produced is shipped compiled.
SPAGO_VERSION="1.0.4"

# The registry package set the dependency versions in `spago.yaml` are resolved against. Pinned for
# the reason every other version here is: the library set a model writes against is a study
# parameter, and a set that drifted between two runs would be two different arms wearing one name.
# `spago.lock` records what this resolved to, package by package, and is committed.
#
# READ OUT OF `spago.yaml` RATHER THAN RESTATED, because Spago reads it from there and nothing can
# talk Spago out of that. It was written down twice — once as a literal under
# `workspace.packageSet.registry`, where the resolver actually reads it, and once here as a `sh`
# assignment for the scripts and the images — with nothing whatsoever comparing the two. That is a
# duplication with the nastiest failure this arm has: bump only the shell copy and every script
# reports a package set that is not the one a single library was resolved from, and bump only the
# YAML and the reported set is right while nothing that reads this file knows. Neither shows up as
# a build failure, because both files are individually valid. So the file the tool reads is the one
# copy, and this is a projection of it — the same move `rust-version.sh` makes for the compiler,
# which it seds out of `rust-toolchain.toml` rather than restating.
#
# Fatal when absent rather than empty: an unset package set silently reaching `build.sh` would be
# worse than not resolving at all.
REGISTRY_VERSION="$(sed -n 's/^[[:space:]]*registry:[[:space:]]*\(.*\)$/\1/p' \
	"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/spago.yaml")"
if [ -z "$REGISTRY_VERSION" ]; then
	echo "error: could not read workspace.packageSet.registry out of spago.yaml." >&2
	echo "       That file is where Spago reads the package set, and therefore the only" >&2
	echo "       place it is written down; purescript-version.sh projects it." >&2
	exit 1
fi
