# shellcheck shell=bash
# shellcheck disable=SC2034  # every variable here is read by the scripts that source this file

# The toolchain this arm's programs are compiled with, pinned in one place.
#
# Three pins rather than one, because — unlike Ruby's, where a single Opal release decides both the
# compiler and the runtime it emits against — PureScript's halves are genuinely independent: `purs`
# decides what a program means, `esbuild` decides how the module graph it emits becomes one script,
# and the registry package set decides which libraries exist. What they share is that all three are
# baked into the COMMITTED library tree, so bumping any of them means rebuilding it.

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
REGISTRY_VERSION="80.3.0"
