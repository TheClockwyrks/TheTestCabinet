#!/usr/bin/env bash
# Install every toolchain that BUILDING `test-cabinet-gg` requires, on any machine, in one call.
#
# THE POLICY THIS SCRIPT EXISTS TO MAKE TRUE. gg drives a model in one of eleven program languages,
# and what a model is *told* about each one — every module, signature, argument, type and type
# member the responses-as-code prompt renders — is a **signature catalogue** reflected out of that
# arm's own SDK by that arm's own documentation tool: `tsc`, griffe, YARD, `purs`, javadoc, the
# Kotlin front end, rustdoc, `swiftc -emit-symbol-graph`, `clang++ -ast-dump=json`, Roslyn. Those
# catalogues used to be committed, precisely so that building gg would not require eleven
# toolchains. They are not committed any more: `crates/gg/build.rs` reflects them on the build that
# compiles the host embedding them, so a prompt cannot describe a surface the guest does not export.
#
# That trade is now made the other way round on purpose. This repository is developed in a
# devcontainer so that every developer has ONE environment rather than eleven personal ones, and a
# toolchain that is required is therefore a toolchain that is *installed*. There is no machine that
# builds gg without them and no artifact committed to spare one the install. **This is the single
# script that makes a machine such a machine** — the devcontainer IMAGE runs it as its last build
# layer (`.devcontainer/languages/gg/install.sh`) and its `postCreateCommand` runs it again to
# reconcile an image built before a pin moved, the CI scripts run it, `containers/gg-ci/Dockerfile`
# runs it to bake the image those CI jobs hydrate from, the release workflow runs it, and the driver
# image's gg build stage runs it. One pinned list, run everywhere, rather than a per-surface
# sequence that drifts arm by arm.
#
# It composes the per-arm installers rather than reimplementing any of them. Each of those owns one
# toolchain, reads its pin from that arm's own `*-version.sh`, prunes what a run container does not
# need, and explains itself at length; this file owns only the LIST and the order.
#
# WHAT IT COSTS. About **1.9 GB on disk** once everything is unpacked — ~835 MB of Swift toolchain
# and wasm SDK, ~375 MB of JDK and TeaVM jars, ~200 MB of wasi-sdk, ~122 MB of .NET and Roslyn, ~97
# MB of `purs`, ~91 MB of `wasm32-unknown-unknown` standard library, ~66 MB of Kotlin compiler jars,
# and change. The first run downloads rather more than that (the Swift toolchain alone is a 1.05 GB
# archive of which most is deleted, and `dotnet-install.sh` fetches a ~770 MB SDK to keep ~122 MB of
# it), so budget a slow first call and a fast every-call-after.
#
# IDEMPOTENT, and that is the property every caller relies on. Each installer checks what is already
# there against its pin and exits without touching the network when they match, so re-running this
# is seconds and running it from four different surfaces on the same machine costs no more than
# running it once. Nothing here is conditional on a "have I run before" marker of its own: the
# installed versions are the marker.
#
# WHAT IT DOES NOT INSTALL, and why. Two of the eleven arms are reflected by tools that come from
# somewhere this script has no business reaching:
#
#   * Node and the npm workspaces. The TypeScript and JavaScript catalogues come out of the pinned
#     `typescript` a repo-root `npm ci` installs. Node is part of the machine (the devcontainer's
#     image, a CI job's `setup-node`), and `npm ci` deletes and re-creates `node_modules` — which is
#     a thing to do to a checkout on purpose, not a side effect of installing compilers. This script
#     checks and says so; it does not do it for you.
#   * The Ruby INTERPRETER, which is a distribution package and needs root. What this script does
#     own is the arm's reflector: the pinned YARD, installed per-user, so a build never discovers
#     mid-`cargo build` that it wants to talk to rubygems.org.
#
# PATH — TWO OBLIGATIONS, and a caller that meets only the first gets a build that dies three arms
# in. `purs` and `esbuild` land in `$HOME/.local/bin`, so a caller that shells out to them AFTERWARDS
# needs that directory on PATH; a child process cannot fix its parent's environment (this script
# exports it for its own run, which is why the checks below work regardless). The second is
# `rustup`, usually `$HOME/.cargo/bin`, which must be on PATH BEFORE this runs: `install-rust-wasm.sh`
# asks `rustc` where the wasm32 standard library would live and falls back to `rustup target add`,
# and it exits 1 rather than skipping when it can find neither — deliberately, because on a machine
# that runs this for real a missing wasm32 std is a defect and not a choice. That obligation is
# invisible on an interactive shell, where rustup's own `~/.bashrc` edit has already met it, and
# very visible inside a Dockerfile `RUN`, which sources no profile: it is what
# `.devcontainer/ubuntu.dockerfile` and `containers/gg-ci/Dockerfile` both set an `ENV PATH` for.
# Everything else installs under a prefix `crates/gg` and the reflectors look for by name, so
# nothing else has to be exported.
#
# Usage:
#   scripts/ci/install-gg-toolchains.sh
#
# The per-arm `*_INSTALL_DIR` overrides each installer documents still work — they are read from the
# environment, so `SWIFT_INSTALL_DIR=/opt/gg/toolchains/swift scripts/ci/install-gg-toolchains.sh`
# does what it looks like it does. That is how `containers/gg-toolchains/Dockerfile` reaches the same
# installers for a run image.
set -euo pipefail
# shellcheck source=scripts/ci/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# The per-arm installers put binaries here, and two of the checks below look for one.
export PATH="$HOME/.local/bin:$PATH"

# ---------------------------------------------------------------------------------------------
# The cheap arms first, so a machine that is missing something learns it in seconds rather than
# after a gigabyte of Swift. The order below is otherwise cost-ascending for the same reason.
# ---------------------------------------------------------------------------------------------

# Python's catalogue is reflected by griffe, which parses the SDK statically rather than importing
# it. uv is how this repository provisions any Python at all — the devcontainer's base image ships
# no usable pip and a CI agent's system Python refuses installs under PEP 668 — and griffe itself is
# resolved at its pin by `uv run --with` when the arm runs.
log "uv (gg's python arm reflects its catalogue with griffe, run through uv)"
./scripts/ci/install-uv.sh

# Ruby's catalogue is reflected by YARD, which is pure Ruby and pinned in
# packages/gg-sandbox-ruby/yard-version.sh. The interpreter is the machine's own — see the header —
# so this is the one arm whose prerequisite this script can only check.
log "YARD (gg's ruby arm reflects its catalogue with it)"
# shellcheck source=packages/gg-sandbox-ruby/yard-version.sh
source "$REPO_ROOT/packages/gg-sandbox-ruby/yard-version.sh"
if ! command -v ruby >/dev/null 2>&1; then
	echo "error: no \`ruby\` on PATH, and gg's Ruby arm reflects its signature catalogue with" >&2
	echo "       YARD — so this machine cannot build test-cabinet-gg." >&2
	echo "       A distribution Ruby is all it needs and any recent one will do; installing one" >&2
	echo "       takes root, which is why this script will not do it for you:" >&2
	echo "           sudo apt-get install -y ruby        # Debian, Ubuntu" >&2
	echo "       The devcontainer image installs it in .devcontainer/system/apt.sh, so a container" >&2
	echo "       built before that line landed wants a rebuild." >&2
	exit 1
fi
if ruby -e 'gem "yard", ARGV[0]' "$YARD_VERSION" >/dev/null 2>&1; then
	echo "yard $YARD_VERSION already installed"
else
	# `--user-install` needs no root and no `bundle`, and lands in `Gem.user_dir`, where the
	# interpreter finds it without anything being exported. `--no-document` skips generating rdoc
	# for a gem nobody reads the rdoc of.
	echo "Installing yard $YARD_VERSION -> $(ruby -e 'print Gem.user_dir')"
	gem install --user-install --no-document yard -v "$YARD_VERSION"
fi

# Rust's catalogue is rustdoc's own JSON, emitted for `wasm32-unknown-unknown` because that is what
# the arm compiles a model's program to. The compiler is the one that builds this repository — the
# arm has no compiler pin of its own, deliberately — but that target's STANDARD LIBRARY is a
# separate rustup component, and this is what adds it.
log "the wasm32 target (gg's rust arm documents and compiles against it)"
./scripts/ci/install-rust-wasm.sh

# PureScript is the one arm whose compiler IS its documentation tool: `purs --codegen docs` over the
# SDK staged into the committed library tree. `purs` cannot ride inside gg's binary the way the Ruby
# arm's Opal compiler does — it is a ~100 MB statically linked Haskell executable with a build per
# platform — so it is installed, here as in a gg run image. `esbuild`, which flattens what `purs`
# emits for a real run, comes with it.
log "PureScript (gg's purescript arm documents and compiles with purs)"
./scripts/ci/install-purescript.sh

# Java and Kotlin share one install and one JDK, and must: a Kotlin program is compiled to JVM
# bytecode and handed to the same TeaVM, so the bytecode one writes and the other reads is one
# artifact. `install-kotlin.sh` runs `install-java.sh` itself for that reason, which is why only one
# of the two is named here. The JDK is what javadoc comes from — gg's own doclet reflects the Java
# catalogue with it — and the Kotlin compiler's front end is what reads KDoc for the Kotlin one, so
# both arms document with exactly the compiler they compile with.
log "the JDK, TeaVM and the Kotlin compiler (gg's java and kotlin arms document and compile with them)"
./scripts/ci/install-kotlin.sh

# C++ documents with `clang++ -ast-dump=json` out of wasi-sdk — the same clang that compiles a
# model's program against the same libc++ — which makes it the lightest of the compiled arms to
# install: ~200 MB kept of a ~650 MB tarball, pruned by the script itself.
log "wasi-sdk (gg's c++ arm documents and compiles with its clang++)"
./scripts/ci/install-wasi-sdk.sh

# C# documents with Roslyn, compiled against the reference assemblies a model's program is compiled
# against, so the surface a model is told about is the surface the compiler will accept. It is the
# only arm that installs no wasm toolchain at all: the wasm half was compiled once by
# packages/gg-sandbox-csharp/build.sh and committed.
log ".NET and Roslyn (gg's csharp arm documents and compiles with them)"
./scripts/ci/install-dotnet.sh

# Swift documents with `swiftc -emit-symbol-graph`, which needs the whole toolchain and the wasm SDK
# the arm compiles against — the heaviest install here by a factor of four, and therefore last.
log "the Swift toolchain (gg's swift arm documents and compiles with swiftc)"
./scripts/ci/install-swift.sh

# The one prerequisite this script deliberately does not satisfy, reported at the end rather than
# the start: a checkout whose npm workspaces were never installed builds none of gg, because two of
# the eleven catalogues come out of the pinned `typescript` that lives there. It is a warning and
# not a failure because installing toolchains before installing packages is a perfectly ordinary
# order to do things in — the devcontainer's first-create is exactly that — and because `npm ci`
# throws away a `node_modules` a developer may be mid-something with.
if [ ! -x "$REPO_ROOT/node_modules/.bin/tsc" ]; then
	log "note: the npm workspaces are not installed"
	echo "gg's typescript and javascript catalogues are reflected with the pinned \`typescript\`"
	echo "a repo-root \`npm ci\` installs, so building test-cabinet-gg needs one too:"
	echo
	echo "    npm ci"
	echo
fi

log "gg's toolchains are installed"
