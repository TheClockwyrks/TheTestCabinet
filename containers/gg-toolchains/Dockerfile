# syntax=docker/dockerfile:1
# The **gg language-toolchain** BUILDER image for The Test Cabinet's run containers.
#
# This is NOT a run image: nothing ever executes in it. It exists to be a `COPY --from`
# source, exactly as `containers/tools` does, so the toolchains land in one place and
# every gg run image copies the same tree.
#
# It IS published, though, and this file is where that fact belongs — `containers/build.sh`
# and `containers/README.md` both point a reader here, and it used to say the opposite.
# `build.sh` pushes it under `PUSH=1` and `.github/workflows/build-containers.yml`'s
# manifest job fuses its two arch tags, so the exact tree baked into every `-gg` variant is
# pullable and pinned by digest on its own terms; the argument for paying for that is where
# `GG_TOOLCHAINS_IMAGE` is defined in `build.sh`, and is not repeated here.
#
# Published and yet absent from `containers/image-names.sh`, which looks like a
# contradiction and is not: that list is the set of images a RUN RESOLVES, and nothing
# resolves this one. The obstacle to listing it anyway is `build.sh` rather than the Rust
# suite — `every_resolvable_image_is_one_the_build_publishes` in
# `crates/core/src/harness.test.rs` keeps a `NOT_A_RUN_IMAGE` exception list, which already
# holds `base` for exactly this shape — but `build_one` dispatches on that list BY NAME, so
# an entry here would send `./build.sh` (and `make run-images`) through `build_asset_image`
# for something that is not one. That is why the manifest job fuses this image by name
# instead of picking it up from the loop.
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
# Three constraints every toolchain added here must meet
# ------------------------------------------------------
# 1. **Relocatable and distribution-portable.** Every run image publishes a `-gg` variant,
#    so this tree is copied onto the Debian-bookworm-derived images *and* onto
#    `blender-gg`, whose parent is Ubuntu — and it is copied
#    to the same absolute path in both, so a toolchain that hard-codes a build-time prefix
#    or links a library only one of them ships is a toolchain that works on some gg runs
#    and not others. Prefer a statically linked or self-contained distribution; where that
#    is impossible, the language's own step is responsible for vendoring what it needs
#    under `/opt/gg` — which is constraint 3, spelled out.
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
# 3. **Self-contained, and proven where it runs.** Constraint 1 taken to its conclusion, and
#    written separately because that one is about PATHS and this one is about LIBRARIES. A
#    toolchain carries under `/opt/gg` every shared library the run images do not supply, and the
#    arm names that directory on the loader path of every compiler it spawns — or the tree's own
#    binaries carry an `RPATH` into it, which is the same answer without the variable. The
#    installer decides that list by walking the transitive ELF closure of the binaries it keeps,
#    and resolves each library from its distribution's own package index rather than from a
#    version written into a script.
#
#    A dependency the image happens to contain is NOT satisfied, and there are more images than
#    there are parents. Two external parents exist — `node:24.18.0-bookworm-slim` under 25 of the
#    26 variants and `ubuntu:26.04` under `blender-gg` — but a dozen run images `apt-get install`
#    packages of their own on top of `base`, and apt brings each package's whole dependency closure
#    with it. Probed with this arm's own missing library: `sprite-gg` and `base-wasm-gg` carry no
#    ICU at all, `voxel-gg` carries `libicu72` because `mesa-vulkan-drivers` pulled it in, and
#    `blender-gg` carries `libicu78` because Blender did. An arm that read ICU out of the image was
#    therefore an arm that worked on some run images and aborted on others, and that would move
#    between the two the next time any of their package closures changed for an unrelated reason.
#    `COPY --link` makes this tree byte-identical in all 26 variants and says nothing whatever
#    about what is underneath it.
#
#    Vendoring is a FLOOR and not an override, which is why the gate below is per environment
#    rather than once. What the vendored copy guarantees is that the compiler starts where the
#    image supplies nothing; where the image supplies a newer copy of the same library the loader
#    may answer with that one instead — .NET probes versioned ICU sonames from newest downwards, so
#    `blender-gg` binds its own `libicu78` before the probe reaches the bookworm 72 under
#    `/opt/gg`, measured with `LD_DEBUG=libs`. Self-contained means no image can leave an arm
#    unable to start, not that every image gives it the same library.
#
#    THE SECOND HALF IS THE HALF THAT WAS MISSING. Each installer ends by compiling with the
#    pruned copy, and that compile runs HERE — in a builder stage that `apt-get install`s what it
#    needs and then exports `/opt/gg` without it. A pass here is a statement about the machine that
#    assembled the tree, not about the image the tree is copied into. And `ldd` is weaker still: a
#    library reached by `dlopen` is named in no ELF header, so a clean link check is exactly what a
#    `csc` that `FailFast`s with SIGABRT before writing a line to stdout reports. So no stage here
#    may install a library an arm's own vendoring is supposed to supply — see the C# block, whose
#    `apt` line deliberately does not carry ICU, which is what makes that installer's own check
#    honest — and the gate that settles the question for real is
#    [`gg selfcheck`](../../apps/docs/src/content/docs/gg/languages/selfcheck.md), run inside a
#    BUILT `-gg` variant of each ENVIRONMENT — `sprite-gg`, `base-wasm-gg`, `voxel-gg`,
#    `blender-gg` — before any of them is published.
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
# already inside the prebuilt component gg carries. There is no compiler on the turn path and
# nothing to install — see `packages/gg-sandbox-python/README.md`. A *typed* Python arm,
# should one be added, would be the thing that needs a block here: it type-checks the
# model's program with a real host-side binary before the guest ever sees it.
#
# Ruby: nothing either, and for a DIFFERENT reason worth writing down, because it is the
# cheaper of the two shapes. This arm does have a compiler on the turn path — Opal, which
# compiles the model's Ruby to JavaScript before the guest sees it — but Opal has a
# self-hosted JavaScript build, so the compiler is 2.9 MB of JavaScript gg carries inside
# its own binary (`ruby.opal.cjs`, cut by the gg build itself and embedded from its OUT_DIR)
# and runs with the `node` every run image already ships. A compiler small enough to BE an artifact does not need an
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
# What is NOT here is the library set a program is compiled against. It is compiled by
# `packages/gg-sandbox-purescript/build.sh` into a cargo `OUT_DIR` and embedded in gg's
# binary, because this image is built separately from the binary that runs in it — and a
# library tree of a different vintage from the SDK compiled into it would mean a model
# shown one surface and compiled against another. See
# `crates/gg/src/sandbox/language/purescript.compile.rs`.
#
# THE VERSIONS ARE NOT WRITTEN DOWN HERE, and that is the whole of why this block runs a
# script instead of a `curl`. They belong to `packages/gg-sandbox-purescript/purescript-
# version.sh`, and they have to be the SAME release the library tree inside gg's binary was
# compiled by — externs are a compiler-version-private format, so a `purs` in this image
# one patch away from the one that built the tree does not compile a model's program at all,
# it fails on every program. This block used to restate both pins as `ARG` defaults that
# `containers/build.sh` then overrode with the real ones; an override is only as good as the
# caller that remembers it, and the default was a second answer sitting in the tree waiting
# for a `docker build -f` that skipped the wrapper. So this runs
# `scripts/ci/install-purescript.sh` — the same script a developer's and a CI machine run —
# exactly as the Java, Kotlin, Swift, C++ and C# blocks below run theirs, and for the same
# reason: one list of versions, read by the image and by the machine, rather than copied
# into both. Its `.dockerignore` re-inclusions are what let the two COPYs find anything.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
	--mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
	apt-get update && apt-get install -y --no-install-recommends ca-certificates curl
COPY packages/gg-sandbox-purescript/purescript-version.sh \
	/tmp/gg-purescript/packages/gg-sandbox-purescript/purescript-version.sh
COPY packages/gg-sandbox-purescript/spago.yaml \
	/tmp/gg-purescript/packages/gg-sandbox-purescript/spago.yaml
COPY scripts/ci/install-purescript.sh /tmp/gg-purescript/scripts/ci/install-purescript.sh
RUN set -eux; \
	PURS_INSTALL_DIR=/opt/gg/toolchains/bin \
	bash /tmp/gg-purescript/scripts/ci/install-purescript.sh; \
	rm -rf /tmp/gg-purescript; \
	/opt/gg/toolchains/bin/purs --version; \
	/opt/gg/toolchains/bin/esbuild --version

# --- Java -------------------------------------------------------------------
# The first toolchain here that is not one file. A Java program is compiled to bytecode by `javac`
# and then to a WebAssembly component by TeaVM, both on the host before the program crosses the
# membrane, so this arm adds no engine either — but it needs a JDK (javac is a JDK, not a JRE) and
# ~29 MB of TeaVM jars named on a classpath.
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
# WHAT USED TO BE HERE AND IS NOT: a `kotlin-home/lib` directory holding four scripting-plugin jars
# under unversioned names. gg compiled a model's program as a Kotlin SCRIPT, because the shape it was
# compared against wrapped a reply in a function gg declared and Kotlin refuses `object`,
# `interface`, `enum class`, `typealias` and `private fun` as LOCAL declarations. Under whole
# programs there is no wrapper and no local position, so the plugin went with the problem it solved.
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
	test -f /opt/gg/toolchains/kotlin/libs/kotlin-compiler-embeddable-*.jar

# --- Rust -------------------------------------------------------------------
# The heaviest toolchain in this image by a wide margin — **~380 MB** — and the first that is
# not a compiler *for* a guest but the thing that PRODUCES one. Every other arm here compiles a
# model's program into something an interpreter already inside a prebuilt component evaluates;
# `rustc` emits the component itself, per turn, because there is no Rust runtime to bake. See
# `crates/gg/src/sandbox/language/rust.compile.rs`.
#
# Constraint 1 is satisfied by construction. A rustup toolchain directory is relocatable: `rustc`
# derives its sysroot from its own path and finds `librustc_driver`/`libLLVM` through an `$ORIGIN`
# rpath, so the tree works at this absolute path on the Debian-derived run images and on
# `blender-gg`'s Ubuntu alike. Verified here by running the copy, not assumed.
#
# Constraint 2 is satisfied outright: `rustc` is a plain one-shot process with an explicit `-o`, it
# has no daemon and nothing to keep warm (a compile is ~45 ms), and it only ever READS the library
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
# NEITHER ARG IS DEFAULTED, and that is the rule this file now keeps everywhere. `containers/
# build.sh` reads both out of `packages/gg-sandbox-rust/rust-version.sh` (which reads the compiler
# out of `rust-toolchain.toml`) and passes them in, because the compiler in this image and the
# compiler that built the `.rlib` set inside gg's binary must be the SAME release — an `.rlib` is a
# compiler-version-private format and `rustc` refuses another release's with E0514. A default would
# be a second answer to that question, sitting here, correct only until somebody edited the version
# file; the `test -n` below turns a build that forgot the argument into an immediate failure
# instead. This is the only arm still passed its versions rather than running its own installer,
# because the block IS the installer: `rustup` needs no script around it.
#
# The build ends by compiling a `bin` for the target WITH THE COPY rather than with the rustup
# installation — the relocated sysroot, the pruned host tree and `rust-lld` are exactly what a run
# will use, and each of the three is a thing the pruning above could have broken. A `bin` rather
# than a library crate because that is the crate type a run compiles: it is what links the target's
# start files and emits the entry symbol gg's SDK calls the model's `main` through.
ARG RUST_VERSION
ARG RUST_TARGET
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
	--mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
	apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils
RUN set -eux; \
	test -n "${RUST_VERSION}"; \
	test -n "${RUST_TARGET}"; \
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
	printf 'fn main() { eprintln!("smoke"); }\n' >/tmp/smoke.rs; \
	"$dst/bin/rustc" --edition 2024 --target "${RUST_TARGET}" --crate-type bin \
	-Copt-level=s -Cstrip=symbols -Cpanic=abort -o /tmp/smoke.wasm /tmp/smoke.rs; \
	test -s /tmp/smoke.wasm; \
	rm -f /tmp/smoke.rs /tmp/smoke.wasm; \
	"$dst/bin/rustc" --version; \
	du -sh "$dst"

# --- Swift ------------------------------------------------------------------
# The second toolchain that PRODUCES a component rather than compiling for one, and the second
# heaviest here — **~835 MB** against `rustc`'s ~380 MB. A Swift program is compiled by `swiftc`
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
# has no daemon and nothing to keep warm (a compile is ~0.3 s), and it only ever READS the prebuilt
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
# LIGHTEST of the three — **~200 MB**, against `rustc`'s ~380 MB and the Swift SDK's ~835 MB.
# A C++ program is compiled by `clang++` from wasi-sdk against wasi-libc and libc++ into a core
# wasm module, which gg then encodes as a component in its own process. See
# `crates/gg/src/sandbox/language/cpp.compile.rs`.
#
# Constraint 1 is satisfied about as completely as it can be, and that is a property of the
# toolchain rather than of this block. wasi-sdk is built for exactly this job: `clang` finds its
# sysroot and its resource directory from its own path (`bin/clang.cfg` names
# `<CFGDIR>/../share/wasi-sysroot`), every binary carries an `RPATH` of `$ORIGIN/../lib`, and the
# tree relocates whole. The one thing it does depend on is the distribution it was published for,
# so constraint 3 costs this arm three libraries rather than a strategy: `clang` links Debian's
# `libstdc++.so.6` and `libgcc_s.so.1`, and one level further down the closure the `libedit.so.0`
# shipped inside the tarball links `libtinfo.so.6`. The installer vendors all three under
# `<home>/lib`, where that `RPATH` finds them — transitively, since an `RPATH` and not a `RUNPATH`
# is what reaches a dependency's own dependencies — and nothing else in the image does. No
# `LD_LIBRARY_PATH`, which is the Swift and C# blocks' price; the closure is still walked, to
# decide the list rather than to place it. `libtinfo` in particular was resolving off the base
# images for as long as this block has existed, which both of them happen to carry because their
# `bash` depends on it: satisfied by accident is the thing constraint 3 does not count.
#
# Constraint 2 is satisfied outright. `clang++` is a plain one-shot process with an explicit
# `-o`, it has no daemon, and it only ever READS what gg carries. It writes its intermediates
# under `TMPDIR` and its module cache under the directory it derives from `HOME`, both of which
# the calling side has already redirected into the preparation's own tree.
#
# This arm builds nothing per MACHINE, and that is worth naming because it used to. A
# **precompiled header** of the ~55 standard-library headers was built into a content-keyed
# shared toolchain directory by the first compile, worth ~850 ms of parsing on every one after
# it. It also put those headers in scope of a program that had included none of them, which
# https://docs.testcabinet.ai/gg/responses-as-code/invariants/ forbids: a program reaches every
# name it uses through a line it wrote, its language's own standard library included. So it is
# gone, every compile parses what the program itself asked for, and the only shared directory
# this arm has left is the read-only unpacking of the archive gg carries.
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
# The three sonames the installer vendors are copied from THIS stage, so they have to be here to
# be copied — which is the opposite of the C# block's `apt` line and not a contradiction: what is
# forbidden there is a library the run image would have to supply, and what is required here is a
# library this stage hands to the tree. `libtinfo6` is declared rather than left to arrive with
# `bash`, for the reason `.devcontainer/system/apt.sh` declares the tools it does.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
	--mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
	apt-get update && apt-get install -y --no-install-recommends libstdc++6 libtinfo6
RUN set -eux; \
	WASI_SDK_INSTALL_DIR=/opt/gg/toolchains/wasi-sdk \
	bash /tmp/gg-cpp/scripts/ci/install-wasi-sdk.sh; \
	rm -rf /tmp/gg-cpp; \
	test -x /opt/gg/toolchains/wasi-sdk/bin/clang++; \
	test -f /opt/gg/toolchains/wasi-sdk/lib/libstdc++.so.6; \
	test -f /opt/gg/toolchains/wasi-sdk/lib/libtinfo.so.6; \
	test -d /opt/gg/toolchains/wasi-sdk/share/wasi-sysroot/lib/wasm32-wasip1/eh

# --- C# ---------------------------------------------------------------------
# The LIGHTEST toolchain in this image — **~122 MB**, against wasi-sdk's ~200 MB, `rustc`'s
# ~380 MB and the Swift SDK's ~835 MB — and the only one here that is not a wasm toolchain
# at all. That is the arm's whole strategy rather than a saving: a C# program is compiled to
# **IL** by Roslyn on the host, in ~0.3 s, and interpreted by a Mono IL interpreter that
# `packages/gg-sandbox-csharp/build.sh` compiles to wasm once per build and gg embeds in its own
# binary. Nothing about a C# program is compiled to wasm, so nothing that compiles to wasm
# has to be here. See `crates/gg/src/sandbox/language/csharp.rs`.
#
# Constraint 1 is satisfied by construction: a `dotnet-install.sh` tree is relocatable, the
# launcher resolves its framework relative to `DOTNET_ROOT` (which gg sets to the tree it
# found), and the whole of it is managed code plus one small native host.
#
# Constraint 3 is NOT satisfied by construction, and this arm is the reason that constraint is
# written down. Being managed code over one small native host is exactly what hides the one
# native dependency it has: `libSystem.Globalization.Native.so` `dlopen`s `libicuuc` and
# `libicui18n` by name while the CLR is still starting, so ICU is in no ELF header anywhere in
# the tree and `ldd` reports a complete closure over a `csc` that cannot start. It shipped that
# way — a C# arm that worked on `blender-gg`, whose Ubuntu carries `libicu78` because Blender's
# apt dependencies do, and that killed the first turn of every run on the twenty-five Node-based
# variants with SIGABRT and an empty stdout. So `install-dotnet.sh` now vendors the three ICU
# libraries into `<home>/lib` out of Debian bookworm's own package index, and
# `csharp.compile.rs` names that directory on `LD_LIBRARY_PATH` for every `dotnet` it runs. It is
# the Swift block's arrangement, reached from the same constraint; Swift's vendored set does not
# rescue this one, because it carries `libicuuc` and `libicudata` for `libxml2` and not the
# `libicui18n` .NET also loads.
#
# Constraint 2 is satisfied outright, and one thing is deleted to keep it that way. `csc` is a
# plain one-shot process with an explicit `-out:`, and it only ever READS the reference
# assemblies. Roslyn does ship a compiler SERVER — `VBCSCompiler`, a resident process an SDK
# build reuses across compilations, which is precisely the shape of the measured corruption in
# this header's constraint 2 — and gg never reaches it, because gg runs `csc.dll` under
# `dotnet exec` rather than through the shim that starts it. The installer removes the server
# anyway, so nothing in this image can start one.
#
# WHAT IS PRUNED, and why each is safe — the published SDK is ~770 MB. Dropped: MSBuild, NuGet,
# the templating engine, the test host, F#, the AOT cross-compilers, the ASP.NET reference pack
# and the whole wasm workload (gg never builds a *project*, and the wasm half of this arm is built
# by that arm's own artifact crate, out of a separate and much larger prefix — see
# `scripts/ci/install-gg-build-toolchains.sh`); `vbc` and the Visual Basic code-analysis assembly; the compiler server, above;
# thirteen languages of localised compiler messages, since every diagnostic here is read by a
# model and every prompt in this repository is English; and 43 MB of IntelliSense XML beside
# the reference assemblies. Kept: the launcher and its resolver, the shared framework, Roslyn,
# and the reference assemblies — which are the whole reason this is pinned, because they decide
# what a model's program may call and must be the release the BCL inside the baked guest was cut
# from.
#
# The versions are the ones `packages/gg-sandbox-csharp/csharp-version.sh` pins, and the script
# is run here so there is one list rather than two. It ends by compiling a C# file with the
# pruned copy — with `<home>/lib` and nothing else on `LD_LIBRARY_PATH` — because every deletion
# above is a thing that could have broken it, and because with no ICU in this stage that compile
# is the only thing that can tell anyone the vendoring worked.
COPY packages/gg-sandbox-cpp/cpp-version.sh \
	/tmp/gg-csharp/packages/gg-sandbox-cpp/cpp-version.sh
COPY packages/gg-sandbox-csharp/csharp-version.sh \
	/tmp/gg-csharp/packages/gg-sandbox-csharp/csharp-version.sh
COPY scripts/ci/install-dotnet.sh /tmp/gg-csharp/scripts/ci/install-dotnet.sh
# `binutils` for the `ar` that unpacks the ICU package the installer vendors, and — deliberately,
# and this is the most load-bearing line in this block — NO `libicu72`. It used to be here, and it
# was here for one reason: to make the installer's own verification compile pass in THIS stage. It
# did, every time, on ICU that the next instruction threw away, because the export below is
# `FROM scratch` + `COPY --from=build /opt/gg /opt/gg` and nothing outside `/opt/gg` survives it.
# That is how a green check shipped a broken arm to twenty-five images. With no ICU installed here
# the builder has none to fall back on, so the installer's compile can only pass on the copy it
# vendored — which is the thing the run images will actually have. Anything added back to this
# line that an arm is supposed to vendor for itself undoes that, silently.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
	--mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
	apt-get update && apt-get install -y --no-install-recommends binutils
RUN set -eux; \
	DOTNET_INSTALL_DIR=/opt/gg/toolchains/dotnet \
	bash /tmp/gg-csharp/scripts/ci/install-dotnet.sh; \
	rm -rf /tmp/gg-csharp; \
	test -x /opt/gg/toolchains/dotnet/dotnet/dotnet; \
	test -f /opt/gg/toolchains/dotnet/roslyn/bincore/csc.dll; \
	test ! -f /opt/gg/toolchains/dotnet/roslyn/bincore/VBCSCompiler.dll; \
	ls /opt/gg/toolchains/dotnet/lib/libicuuc.so.* >/dev/null; \
	ls /opt/gg/toolchains/dotnet/lib/libicui18n.so.* >/dev/null; \
	ls /opt/gg/toolchains/dotnet/lib/libicudata.so.* >/dev/null

# --- Export just the tree ---------------------------------------------------
# `scratch` so this published-nowhere builder carries no base layers: it is only ever a
# `COPY --from` source, and keeping it to the toolchain tree alone means the gg run images
# pull the smallest possible thing out of the local image store.
FROM scratch
COPY --from=build /opt/gg /opt/gg
