# shellcheck shell=bash
# shellcheck disable=SC2034  # every variable here is read by the scripts that source this file

# The Java program language arm's toolchain pins, in one place.
#
# Sourced by `scripts/ci/install-java.sh` (a developer's or CI machine) and read by
# `containers/gg-toolchains/Dockerfile` (a gg run image) so both install the same
# thing. `crates/gg/src/sandbox/checkers/java.toolchain.json` carries the same two
# versions for the Rust side, and a test in `java.compile.test.rs` fails if the two
# ever disagree.
#
# Not a script to run: it only sets variables.

# The JDK. Eclipse Temurin, because it publishes a plain relocatable tarball per
# platform with no installer and no distribution packaging — which is constraint 1 of
# `containers/gg-toolchains/Dockerfile`, and what lets the same tree be copied onto the
# Debian-derived run images and onto `blender-gg`'s Ubuntu.
#
# 21 rather than the newest, and nothing about the toolchain forces it. TeaVM reads class files
# with a bundled ASM, and the 9.8 the pinned release carries reads up to Java 25; gg compiles
# the model's program with `--release 21` whatever JDK it is running, so the bytecode is the
# same either way. What the pin buys is javac's own DIAGNOSTICS agreeing between machines, which
# is what the arm's tests assert and what a model is shown on a compile failure. Moving it is a
# change to that text and belongs to its own change, with its own re-measurement.
JDK_VERSION="21.0.12+8"

# TeaVM, which compiles the bytecode to JavaScript. Every jar below is a runtime
# dependency of `teavm-tooling` and of `teavm-classlib`, resolved once and pinned here rather
# than resolved by Maven at install time: an install step that runs a dependency resolver is an
# install step whose result depends on the day it ran.
#
# 0.13.1 and it stays there. It is the last release carrying the `WEBASSEMBLY_WASI` target, which
# 0.14.0 deleted along with the other non-GC Wasm backend, and there is no 0.13.2. Both the 0.12.x
# and 0.13.x lines are closed upstream, so this is the terminal version of the one gg wants.
TEAVM_VERSION="0.13.1"

# group:artifact:version, one per line. Downloaded straight from Maven Central.
read -r -d '' TEAVM_JARS <<'JARS' || true
org.teavm:teavm-tooling:0.13.1
org.teavm:teavm-core:0.13.1
org.teavm:teavm-classlib:0.13.1
org.teavm:teavm-interop:0.13.1
org.teavm:teavm-jso:0.13.1
org.teavm:teavm-jso-apis:0.13.1
org.teavm:teavm-jso-impl:0.13.1
org.teavm:teavm-metaprogramming-api:0.13.1
org.teavm:teavm-metaprogramming-impl:0.13.1
org.teavm:teavm-platform:0.13.1
org.teavm:teavm-relocated-libs-asm:0.13.1
org.teavm:teavm-relocated-libs-asm-analysis:0.13.1
org.teavm:teavm-relocated-libs-asm-commons:0.13.1
org.teavm:teavm-relocated-libs-asm-tree:0.13.1
org.teavm:teavm-relocated-libs-asm-util:0.13.1
org.teavm:teavm-relocated-libs-commons-io:0.13.1
org.teavm:teavm-relocated-libs-hppc:0.13.1
org.teavm:teavm-relocated-libs-rhino:0.13.1
org.ow2.asm:asm:9.8
org.ow2.asm:asm-analysis:9.8
org.ow2.asm:asm-commons:9.8
org.ow2.asm:asm-tree:9.8
org.ow2.asm:asm-util:9.8
commons-io:commons-io:2.20.0
com.carrotsearch:hppc:0.10.0
joda-time:joda-time:2.12.2
com.jcraft:jzlib:1.1.3
org.mozilla:rhino:1.7.15
JARS
