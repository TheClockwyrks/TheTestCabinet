# syntax=docker/dockerfile:1
# The **gg language-toolchain** BUILDER image for The Test Cabinet's run containers.
#
# This is NOT a run image: nothing ever executes in it and it is never published. It
# exists solely as a `COPY --from` source, exactly as `containers/tools` does, so the
# toolchains land in one place and every gg run image copies the same tree.
#
# Why this exists
# ---------------
# `gg`'s [responses-as-code] capability lets a model answer with a *program* rather than
# with tool calls, and the language that program is written in is a run variable — the
# point of the capability being to ask whether it changes how well a model works. A
# compiled language needs its compiler on the turn path, inside the run container, and gg
# itself is a single static binary copied in at run time: a binary copies fine, a JDK does
# not.
#
# It is a variant image rather than a layer on the shared run images because these
# toolchains exist for ONE harness. A run driven by Claude Code, Codex or any other CLI
# harness must not carry them — they are gigabytes a run that cannot use them would pull,
# and a model that found a Swift compiler on `PATH` in an end-to-end run would have been
# handed a capability no other arm of that comparison has. `containers/gg/Dockerfile` is
# the thin layer that puts this tree on top of a run image; `harness::gg_variant` in
# `crates/core` is what resolves a gg run to it.
#
# What goes in it
# ---------------
# One toolchain per program language gg can drive, all of them together. "Together" is not
# a convenience: a program's language is resolved **per agent**, so a single run may drive
# a C# agent and a Python agent at the same time, and an image carrying one language's
# compiler would be an image that cannot run that configuration at all.
#
# Everything installs under a single prefix, `/opt/gg/toolchains`, with executables in
# `/opt/gg/toolchains/bin`. Nothing may install into `/usr`, `/etc` or any other shared
# path: the consuming image copies `/opt/gg` and nothing else, so anything written
# elsewhere is silently dropped, and a package manager run here would additionally bind
# this tree to one distribution's library versions.
#
# Two constraints every toolchain added here must meet
# ----------------------------------------------------
# 1. **Relocatable and distribution-portable.** Every run image publishes a `-gg` variant,
#    so this tree is copied onto the Debian-bookworm-derived images *and* onto
#    `blender-gg`, whose parent is Ubuntu — and it is copied
#    to the same absolute path in both, so a toolchain that hard-codes a build-time prefix
#    or links a library only one of them ships is a toolchain that works on some gg runs
#    and not others. Prefer a statically linked or self-contained distribution; where that
#    is impossible, the language's own step is responsible for vendoring what it needs
#    under `/opt/gg`.
# 2. **Isolated per invocation, by construction.** Several compilers run CONCURRENTLY
#    inside one run — up to `limits.maxParallel` agents times a program chain of four — and
#    two silent-corruption bugs were measured from exactly that: a shared TeaVM build
#    strategy and a shared `purs` output tree each interleaved two agents' programs while
#    every process exited zero. A toolchain installed here must be usable with a
#    per-invocation working tree, output directory and process; anything that only works
#    through a shared daemon, a shared build cache or a fixed output path does not belong
#    in this image until it can. It need not be *told* to be isolated: the calling side
#    (`crates/gg/src/sandbox/language/compile.rs`) runs every compiler with its working
#    directory, `HOME`, `TMPDIR` and `XDG_*` roots inside that preparation's own tree, so a
#    toolchain that writes beside its input or into the user's cache is isolated without
#    being configured for it. What must NOT be installed here is a toolchain that can only
#    be driven through a process shared between compilations — and a toolchain worth
#    keeping warm is driven from a `CompilerPool`, which lends an instance exclusively.
#    `crates/gg/src/sandbox/language/isolation.rs` is the gate that holds every language to
#    this at 16-way concurrency, and it reproduces both measured bugs to prove it can.
#
# Each toolchain arrives with the language that needs it, so this layer grows one block at
# a time. It carried nothing at all until PureScript's arrived, which was deliberate: an
# empty `/opt/gg` costs a gg run nothing and meant the resolution seam, the build and the
# published variant images were all exercisable before the first compiler landed.

FROM debian:bookworm-slim AS build

# The tree every consuming image copies. `bin` is created up front because
# `containers/gg/Dockerfile` puts it on `PATH` unconditionally — an image whose `PATH`
# names a directory that does not exist is a confusing thing to debug, and a directory
# that exists and is empty is not.
RUN mkdir -p /opt/gg/toolchains/bin

# --- Toolchains -------------------------------------------------------------
# One block per program language, each installing under /opt/gg/toolchains and touching
# nothing outside it. Added with the language that needs them; see the header for the two
# constraints each must meet.
#
# Python: nothing, and that is a property of the strategy rather than an omission. Its
# guest embeds a whole CPython (`componentize-py` links one against gg's WIT world), so a
# program crosses the membrane as a string and is evaluated by an interpreter that is
# already inside the committed component. There is no compiler on the turn path and
# nothing to install — see `packages/gg-sandbox-python/README.md`. A *typed* Python arm,
# should one be added, would be the thing that needs a block here: it type-checks the
# model's program with a real host-side binary before the guest ever sees it.
#
# Ruby: nothing either, and for a DIFFERENT reason worth writing down, because it is the
# cheaper of the two shapes. This arm does have a compiler on the turn path — Opal, which
# compiles the model's Ruby to JavaScript before the guest sees it — but Opal has a
# self-hosted JavaScript build, so the compiler is 2.9 MB of JavaScript gg carries inside
# its own binary (`crates/gg/src/sandbox/checkers/ruby.opal.cjs`) and runs with the `node`
# every run image already ships. A compiler small enough to BE an artifact does not need an
# image at all; see `crates/gg/src/sandbox/language/ruby.compile.rs`. What needs a block
# here is a toolchain that cannot be copied — a JDK, a Swift toolchain, a `purs` — which is
# what this image exists for.

# --- PureScript -------------------------------------------------------------
# The first toolchain that is actually a toolchain. A PureScript program is compiled to
# JavaScript on the host before it crosses the membrane and evaluated by the ECMAScript
# guest, so this arm adds no engine — but the compiler cannot ride inside gg's binary the
# way Opal does: `purs` is a ~100 MB statically linked Haskell executable with a separate
# build per platform. `esbuild`, which flattens the module graph `purs` emits into the one
# script the guest evaluates and tree-shakes away everything the program did not use, is a
# 10 MB Go binary with the same property.
#
# Both are statically linked and neither reads a build-time prefix, so they satisfy
# constraint 1 outright: the same two files work on the Debian-derived images and on
# `blender-gg`'s Ubuntu. Both satisfy constraint 2 outright too — each is a plain
# one-shot process with an explicit output directory, and `crates/gg` gives every
# invocation its own hard-linked copy of the library tree, which is what the measured
# `purs` corruption in this header's constraint 2 was the absence of.
#
# What is NOT here is the library set a program is compiled against. It is compiled once
# by `packages/gg-sandbox-purescript/build.sh` and shipped inside gg's binary, because
# this image is built separately from the binary that runs in it — and a library tree of a
# different vintage from the SDK compiled into it would mean a model shown one surface and
# compiled against another. See `crates/gg/src/sandbox/language/purescript.compile.rs`.
#
# The versions are the ones `packages/gg-sandbox-purescript/purescript-version.sh` pins and
# `scripts/ci/install-purescript.sh` installs on a developer's or CI machine; they must
# match, because externs are a compiler-version-private format and the committed tree was
# compiled by exactly this `purs`.
ARG PURS_VERSION=0.15.16
ARG ESBUILD_VERSION=0.28.1
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
	--mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
	apt-get update && apt-get install -y --no-install-recommends ca-certificates curl
RUN set -eux; \
	case "$(dpkg --print-architecture)" in \
	amd64) purs_asset="linux64"; esbuild_platform="linux-x64" ;; \
	arm64) purs_asset="linux-arm64"; esbuild_platform="linux-arm64" ;; \
	*) echo "no pinned purs build for $(dpkg --print-architecture)" >&2; exit 1 ;; \
	esac; \
	curl -sSfL "https://github.com/purescript/purescript/releases/download/v${PURS_VERSION}/${purs_asset}.tar.gz" \
	| tar -xz -C /tmp; \
	install -m 0755 /tmp/purescript/purs /opt/gg/toolchains/bin/purs; \
	curl -sSfL "https://registry.npmjs.org/@esbuild/${esbuild_platform}/-/${esbuild_platform}-${ESBUILD_VERSION}.tgz" \
	| tar -xz -C /tmp; \
	install -m 0755 /tmp/package/bin/esbuild /opt/gg/toolchains/bin/esbuild; \
	rm -rf /tmp/purescript /tmp/package; \
	/opt/gg/toolchains/bin/purs --version; \
	/opt/gg/toolchains/bin/esbuild --version

# --- Java -------------------------------------------------------------------
# The first toolchain here that is not one file. A Java program is compiled to bytecode by `javac`
# and then to JavaScript by TeaVM, both on the host before the program crosses the membrane, so this
# arm adds no engine either — but it needs a JDK (javac is a JDK, not a JRE) and ~29 MB of TeaVM
# jars named on a classpath.
#
# Eclipse Temurin satisfies constraint 1 outright: a plain relocatable tarball per platform, with no
# installer and no distribution packaging, so the same tree works on the Debian-derived run images
# and on `blender-gg`'s Ubuntu.
#
# Constraint 2 is the interesting one, because this is the arm the measured TeaVM corruption was
# found on — one `InProcessBuildStrategy` driven from four threads produced no output for three of
# them while throwing nothing. A JDK is *not* excluded by that constraint: what the constraint bars
# is a toolchain that can only be driven through a process shared between compilations, and this one
# is driven through a `CompilerPool` of JVMs that lends each to one preparation at a time. The pool
# is what makes the warmth affordable — a cold build is 4-9 s and a warm one is 0.33-0.56 s — and
# what makes the measured bug's precondition impossible. See
# `crates/gg/src/sandbox/language/java.compile.rs`.
#
# What is NOT here is gg's own compiler driver. It is a single `.java` file inside gg's binary
# (`crates/gg/src/sandbox/checkers/java.compiler.java`), run by the JDK's single-file source-code
# launcher — because this image is built separately from the binary that runs in it, and a driver of
# one vintage speaking to a gg of another is a protocol mismatch nobody notices.
#
# The versions are the ones `packages/gg-sandbox-java/java-version.sh` pins and
# `scripts/ci/install-java.sh` installs on a developer's or CI machine; the script is run here so
# there is one list of jars rather than two.
COPY packages/gg-sandbox-java/java-version.sh /tmp/gg-java/packages/gg-sandbox-java/java-version.sh
COPY scripts/ci/install-java.sh /tmp/gg-java/scripts/ci/install-java.sh
RUN set -eux; \
	JAVA_INSTALL_DIR=/opt/gg/toolchains/java bash /tmp/gg-java/scripts/ci/install-java.sh; \
	rm -rf /tmp/gg-java; \
	/opt/gg/toolchains/java/jdk/bin/javac --version

# --- Export just the tree ---------------------------------------------------
# `scratch` so this published-nowhere builder carries no base layers: it is only ever a
# `COPY --from` source, and keeping it to the toolchain tree alone means the gg run images
# pull the smallest possible thing out of the local image store.
FROM scratch
COPY --from=build /opt/gg /opt/gg
