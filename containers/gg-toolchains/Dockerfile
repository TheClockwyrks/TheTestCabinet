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

# --- Kotlin -----------------------------------------------------------------
# The second arm on the JVM road, and the cheapest one added yet: a Kotlin program is compiled to
# bytecode by the Kotlin compiler and then handed to the SAME TeaVM the Java block above installed,
# so everything from bytecode onwards already exists here. What this block adds is ~67 MB of Kotlin
# compiler jars.
#
# Constraint 1 is satisfied the way the Java block satisfies it: these are plain jars named on a
# classpath, with no installer and no distribution packaging.
#
# Constraint 2 is satisfied the same way too. The compiler is only affordable WARM — a cold compile
# measured 1.7-9 s against 0.14-0.4 s in a JVM that has already done one, and `kotlinc` has no
# daemon of its own to ask — so gg embeds `K2JVMCompiler` in a JVM it keeps, out of a `CompilerPool`
# that lends each JVM to one preparation at a time. Two preparations are never inside one compiler.
# See `crates/gg/src/sandbox/language/kotlin.compile.rs`.
#
# One thing here is not a classpath. gg compiles a model's program as a Kotlin SCRIPT — because
# Kotlin refuses `object`, `interface`, `enum class`, `typealias` and `private fun` as LOCAL
# declarations, and a wrapper function would therefore refuse five things a Kotlin author writes
# without thinking — and the compiler loads its scripting plugin by four UNVERSIONED file names out
# of a `kotlin-home/lib` directory, which the installer writes.
#
# The versions are the ones `packages/gg-sandbox-kotlin/kotlin-version.sh` pins. The script is run
# here for the same reason the Java one is, and it RUNS that one: this arm compiles through the same
# JDK and the same TeaVM, and a second copy of either would be a second thing to keep in step.
COPY packages/gg-sandbox-kotlin/kotlin-version.sh \
	/tmp/gg-kotlin/packages/gg-sandbox-kotlin/kotlin-version.sh
COPY packages/gg-sandbox-java/java-version.sh \
	/tmp/gg-kotlin/packages/gg-sandbox-java/java-version.sh
COPY scripts/ci/install-kotlin.sh /tmp/gg-kotlin/scripts/ci/install-kotlin.sh
COPY scripts/ci/install-java.sh /tmp/gg-kotlin/scripts/ci/install-java.sh
RUN set -eux; \
	JAVA_INSTALL_DIR=/opt/gg/toolchains/java \
	KOTLIN_INSTALL_DIR=/opt/gg/toolchains/kotlin \
	bash /tmp/gg-kotlin/scripts/ci/install-kotlin.sh; \
	rm -rf /tmp/gg-kotlin; \
	test -f /opt/gg/toolchains/kotlin/kotlin-home/lib/kotlin-scripting-compiler.jar

# --- Rust -------------------------------------------------------------------
# The heaviest toolchain in this image by a wide margin — **~376 MB** — and the first that is
# not a compiler *for* a guest but the thing that PRODUCES one. Every other arm here compiles a
# model's program into something an interpreter already inside a committed component evaluates;
# `rustc` emits the component itself, per turn, because there is no Rust runtime to commit. See
# `crates/gg/src/sandbox/language/rust.compile.rs`.
#
# Constraint 1 is satisfied by construction. A rustup toolchain directory is relocatable: `rustc`
# derives its sysroot from its own path and finds `librustc_driver`/`libLLVM` through an `$ORIGIN`
# rpath, so the tree works at this absolute path on the Debian-derived run images and on
# `blender-gg`'s Ubuntu alike. Verified here by running the copy, not assumed.
#
# Constraint 2 is satisfied outright: `rustc` is a plain one-shot process with an explicit `-o`, it
# has no daemon and nothing to keep warm (a compile is ~60 ms), and it only ever READS the library
# set gg ships inside its own binary. Nothing here is written to by a compilation.
#
# WHAT IS PRUNED, and why each is safe. `cargo` (40 MB) — gg drives `rustc` directly, and a build
# system on the turn path would be a second thing to isolate. `rustdoc`, `clippy-driver`, `rustfmt`
# and their cargo shims — nothing on the turn path runs them. `lib/rustlib/src` (77 MB) — sources
# for a debugger nothing here has. `share/` (896 MB of docs and man pages). And the HOST standard
# library, `lib/rustlib/<host>/lib` (~160 MB): a cross-compile to wasm32 links the wasm standard
# library, and the only thing that would want the host's is a proc macro, which a model's program
# cannot have — gg's library set is pre-generated for exactly that reason
# (packages/gg-sandbox-rust/rust-version.sh). What is KEPT out of that directory is
# `lib/rustlib/<host>/bin`, which holds `rust-lld`: the linker every wasm32 build runs.
#
# The version is not defaulted here. `containers/build.sh` reads it out of `rust-toolchain.toml`
# through `packages/gg-sandbox-rust/rust-version.sh` and passes it in, because the compiler in this
# image and the compiler that built the `.rlib` set inside gg's binary must be the SAME release —
# an `.rlib` is a compiler-version-private format and `rustc` refuses another release's with E0514.
#
# The build ends by compiling a `cdylib` for the target WITH THE COPY rather than with the rustup
# installation — the relocated sysroot, the pruned host tree and `rust-lld` are exactly what a run
# will use, and each of the three is a thing the pruning above could have broken.
ARG RUST_VERSION
ARG RUST_TARGET=wasm32-unknown-unknown
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
	--mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
	apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils
RUN set -eux; \
	test -n "${RUST_VERSION}"; \
	host="$(uname -m)-unknown-linux-gnu"; \
	export RUSTUP_HOME=/tmp/rustup CARGO_HOME=/tmp/cargo; \
	curl -sSfL https://sh.rustup.rs \
	| sh -s -- -y --no-modify-path --profile minimal \
	--default-toolchain "${RUST_VERSION}" --target "${RUST_TARGET}"; \
	src="/tmp/rustup/toolchains/${RUST_VERSION}-${host}"; \
	dst=/opt/gg/toolchains/rust; \
	mkdir -p "$dst/bin" "$dst/lib/rustlib/${host}"; \
	cp -a "$src/bin/rustc" "$dst/bin/"; \
	cp -a "$src"/lib/*.so* "$dst/lib/"; \
	cp -a "$src/lib/rustlib/${RUST_TARGET}" "$dst/lib/rustlib/"; \
	cp -a "$src/lib/rustlib/${host}/bin" "$dst/lib/rustlib/${host}/"; \
	rm -rf /tmp/rustup /tmp/cargo; \
	printf '#[unsafe(no_mangle)] pub extern "C" fn smoke() -> u32 { 1 }\n' >/tmp/smoke.rs; \
	"$dst/bin/rustc" --edition 2024 --target "${RUST_TARGET}" --crate-type cdylib \
	-Copt-level=s -Cstrip=symbols -Cpanic=abort -o /tmp/smoke.wasm /tmp/smoke.rs; \
	test -s /tmp/smoke.wasm; \
	rm -f /tmp/smoke.rs /tmp/smoke.wasm; \
	"$dst/bin/rustc" --version; \
	du -sh "$dst"

# --- Swift ------------------------------------------------------------------
# The second toolchain that PRODUCES a component rather than compiling for one, and the second
# heaviest here — **~835 MB** against `rustc`'s ~376 MB. A Swift program is compiled by `swiftc`
# against the Swift SDK for WebAssembly into a core wasm module, which gg then encodes as a
# component in its own process. See `crates/gg/src/sandbox/language/swift.compile.rs`.
#
# Constraint 1 is the one this block works for, and it is the reason the install is a script rather
# than a `curl | tar`. The published toolchain is built for Debian 12 and its `lld` links against
# that distribution's `libxml2` soname; the gg run images derived from Debian bookworm have it, and
# `blender-gg`'s Ubuntu does not — and this tree is copied to the same absolute path in both. So
# `scripts/ci/install-swift.sh` vendors that library and its closure under `<home>/lib`, and
# `swift.compile.rs` names that directory on `LD_LIBRARY_PATH` for every compile. That is the "the
# language's own step vendors what it needs" clause of constraint 1, taken literally. Nothing else
# in the tree reads a build-time prefix: `swiftc` and `clang` derive their resource directories from
# their own paths, and the SDK is named explicitly on every invocation.
#
# Constraint 2 is satisfied outright. `swiftc` is a plain one-shot process with an explicit `-o`, it
# has no daemon and nothing to keep warm (a compile is ~0.3 s), and it only ever READS the committed
# bindings gg carries inside its own binary. Everything it writes — intermediates, the clang module
# cache, the precompiled bridging header — lands inside the preparation's own tree, because the
# calling side redirects `HOME`, `TMPDIR` and the `XDG_*` roots there and this arm additionally names
# `-pch-output-dir` explicitly.
#
# WHAT IS PRUNED, and why each is safe — the published toolchain is 3.3 GB unpacked and the wasm SDK
# another 286 MB. Kept: `swift-driver` (what `swiftc` is), `swift-frontend` (the compiler), `clang`
# (which the driver hands the link to), `lld` (which is `wasm-ld`), `swift-autolink-extract` (an
# ELF-era step the driver refuses to proceed without), the TRANSITIVE CLOSURE of the shared objects
# those five actually need — walked with `readelf` rather than copied by directory, which is what
# keeps Foundation's networking half out and with it `libcurl`'s whole system closure — clang's own
# headers, and the SDK's wasm sysroot and STATIC standard library. Dropped: `sourcekit-lsp`,
# the 184 MB dependency scanner (the driver falls back to `swift-frontend` and says so, which
# `swift.compile.rs` filters); `clangd`, `swift-format`, `docc`, `lldb*`,
# `swift-package*` and the `llvm-*` utilities (nothing on the turn path is an editor service, a
# debugger, a formatter or a build system) and the libraries they load; the HOST static standard
# library (this arm cross-compiles); `lib/swift/embedded`, 577 MB of Embedded Swift resources for
# every target; and the SDK's DYNAMIC standard library, since every compile passes `-static-stdlib`
# because a component is one self-contained module.
#
# The versions are the ones `packages/gg-sandbox-swift/swift-version.sh` pins, and the script is run
# here so there is one list rather than two. It ends by compiling both a C file and a Swift file for
# the wasm target with the pruned copy, because every deletion above is a thing that could have
# broken exactly one of them.
COPY packages/gg-sandbox-swift/swift-version.sh \
	/tmp/gg-swift/packages/gg-sandbox-swift/swift-version.sh
COPY scripts/ci/install-swift.sh /tmp/gg-swift/scripts/ci/install-swift.sh
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
	--mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
	apt-get update && apt-get install -y --no-install-recommends binutils
RUN set -eux; \
	SWIFT_INSTALL_DIR=/opt/gg/toolchains/swift \
	bash /tmp/gg-swift/scripts/ci/install-swift.sh; \
	rm -rf /tmp/gg-swift; \
	test -x /opt/gg/toolchains/swift/toolchain/usr/bin/swiftc; \
	test -d /opt/gg/toolchains/swift/sdk/WASI.sdk; \
	test -f /opt/gg/toolchains/swift/lib/libxml2.so.2

# --- C++ -------------------------------------------------------------------
# The third toolchain that PRODUCES a component rather than compiling for one, and the
# LIGHTEST of the three — **~200 MB**, against `rustc`'s ~376 MB and the Swift SDK's ~835 MB.
# A C++ program is compiled by `clang++` from wasi-sdk against wasi-libc and libc++ into a core
# wasm module, which gg then encodes as a component in its own process. See
# `crates/gg/src/sandbox/language/cpp.compile.rs`.
#
# Constraint 1 is satisfied about as completely as it can be, and that is a property of the
# toolchain rather than of this block. wasi-sdk is built for exactly this job: `clang` finds its
# sysroot and its resource directory from its own path (`bin/clang.cfg` names
# `<CFGDIR>/../share/wasi-sysroot`), every binary carries an `RPATH` of `$ORIGIN/../lib`, and the
# tree relocates whole. The one thing it does depend on is the distribution it was published for
# — its `clang` links Debian's `libstdc++.so.6` and `libgcc_s.so.1` — so the installer vendors
# exactly those two under `<home>/lib`, where that `RPATH` finds them and nothing else in the
# image does. No `LD_LIBRARY_PATH` and no ELF closure walk, which is the Swift block's price.
#
# Constraint 2 is satisfied outright. `clang++` is a plain one-shot process with an explicit
# `-o`, it has no daemon, and it only ever READS what gg carries. It writes its intermediates
# under `TMPDIR` and its module cache under the directory it derives from `HOME`, both of which
# the calling side has already redirected into the preparation's own tree.
#
# One thing this arm produces per MACHINE rather than per invocation is worth naming here,
# because it is the only toolchain input in this image's history that gg *builds*: a
# **precompiled header** of the ~55 standard-library headers every program is compiled against.
# Parsing them costs ~850 ms of every compile and reading the PCH back costs ~40 ms, which is
# the difference between an ~85 ms floor and a second. It cannot be committed — a PCH is
# readable only by the clang that wrote it and records the absolute path of every header in it —
# so it is built into a content-keyed shared toolchain directory, placed by rename and sealed
# read-only, exactly as the seam's contract requires of anything shared.
#
# WHAT IS PRUNED, and why each is safe: `lldb` (117 MB), `clang-tidy`, `clang-format`,
# `clang-scan-deps`, the PE/Mach-O/ELF linker drivers, the `llvm-*` object utilities and
# `wasm-component-ld` — nothing on the turn path is a debugger, a linter, a formatter or a
# second componentizer — and, the largest single deletion, four of the wasi-sysroot's five
# TARGETS, since this arm compiles to exactly the one `cpp-version.sh` pins. The installer names
# each with its reason and ends by compiling both a C file and a C++ file with the pruned copy,
# because every deletion is a thing that could have broken exactly one of them.
#
# The versions are the ones `packages/gg-sandbox-cpp/cpp-version.sh` pins, and the script is run
# here so there is one list rather than two.
COPY packages/gg-sandbox-cpp/cpp-version.sh \
	/tmp/gg-cpp/packages/gg-sandbox-cpp/cpp-version.sh
COPY scripts/ci/install-wasi-sdk.sh /tmp/gg-cpp/scripts/ci/install-wasi-sdk.sh
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
	--mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
	apt-get update && apt-get install -y --no-install-recommends libstdc++6
RUN set -eux; \
	WASI_SDK_INSTALL_DIR=/opt/gg/toolchains/wasi-sdk \
	bash /tmp/gg-cpp/scripts/ci/install-wasi-sdk.sh; \
	rm -rf /tmp/gg-cpp; \
	test -x /opt/gg/toolchains/wasi-sdk/bin/clang++; \
	test -f /opt/gg/toolchains/wasi-sdk/lib/libstdc++.so.6; \
	test -d /opt/gg/toolchains/wasi-sdk/share/wasi-sysroot/lib/wasm32-wasip1/eh

# --- Export just the tree ---------------------------------------------------
# `scratch` so this published-nowhere builder carries no base layers: it is only ever a
# `COPY --from` source, and keeping it to the toolchain tree alone means the gg run images
# pull the smallest possible thing out of the local image store.
FROM scratch
COPY --from=build /opt/gg /opt/gg
