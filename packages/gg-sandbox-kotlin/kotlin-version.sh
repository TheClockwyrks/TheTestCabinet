# shellcheck shell=bash
# shellcheck disable=SC2034  # every variable here is read by the scripts that source this file

# The Kotlin program language arm's toolchain pins, in one place.
#
# Sourced by `scripts/ci/install-kotlin.sh` (a developer's or CI machine) and read by
# `containers/gg-toolchains/Dockerfile` (a gg run image) so both install the same thing.
# `crates/gg/src/sandbox/checkers/kotlin.toolchain.json` carries the same version for the
# Rust side, and a test in `kotlin.compile.test.rs` fails if the two ever disagree.
#
# WHAT IS NOT HERE: the JDK and TeaVM. This arm compiles Kotlin to JVM bytecode and then
# translates that bytecode to JavaScript with TeaVM, which is the Java arm's second half —
# so it installs `packages/gg-sandbox-java/java-version.sh`'s toolchain too, and adds only
# what is below on top of it. One JDK per machine rather than two, and one place where the
# TeaVM release is decided for both arms.
#
# Not a script to run: it only sets variables.

# The Kotlin compiler, as the EMBEDDABLE distribution rather than the `kotlinc` shell
# script. gg drives `org.jetbrains.kotlin.cli.jvm.K2JVMCompiler` inside a JVM it keeps warm,
# because a cold compile of a small program measured ~1.7-9 s against ~0.1-0.4 s in a JVM
# that has already done one — and `kotlinc` has no daemon of its own to ask for that. The
# embeddable jar is also the one built to be put on somebody else's classpath: its
# dependencies are relocated, so it does not fight the ASM that TeaVM reads bytecode with.
KOTLIN_VERSION="2.4.10"

# Every jar the embeddable compiler needs at run time, resolved once from its own POM and
# pinned here rather than resolved by Maven at install time: an install step that runs a
# dependency resolver is an install step whose result depends on the day it ran.
#
# `annotations` is on the list for a reason worth writing down, because nothing about the
# compiler's own POM says so: it is `kotlin-stdlib`'s declared dependency, and the compiler
# reaches for `org.jetbrains.annotations.NotNull` at CODE GENERATION time, when it emits the
# nullability annotation on a public function's parameter. A module of public functions
# therefore fails with `NoClassDefFoundError` where a program full of statements compiles
# fine — which is exactly the shape of bug that gets found in the wrong week. The version is
# the one kotlin-stdlib declares.
#
# `kotlin-stdlib` is the one a MODEL's program sees. It is on this list because the driver
# needs it too, and the arm's compile puts exactly that jar — and nothing else from here —
# on the classpath a model's program is compiled against, so what a program may reach is the
# standard library rather than gg's compiler.
read -r -d '' KOTLIN_JARS <<'JARS' || true
org.jetbrains.kotlin:kotlin-compiler-embeddable:2.4.10
org.jetbrains.kotlin:kotlin-stdlib:2.4.10
org.jetbrains.kotlin:kotlin-script-runtime:2.4.10
org.jetbrains.kotlin:kotlin-daemon-embeddable:2.4.10
org.jetbrains.kotlin:kotlin-build-tools-api:2.4.10
org.jetbrains.kotlin:kotlin-reflect:1.6.10
org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.8.0
org.jetbrains:annotations:13.0
JARS

# The SCRIPTING plugin, which is what lets a Kotlin program be a program at all here: gg
# compiles a model's reply as a Kotlin script, because Kotlin refuses `object`, `interface`,
# `enum class`, `typealias` and `private fun` as LOCAL declarations and a wrapper function
# would therefore refuse five things a Kotlin author writes without thinking. See
# `crates/gg/src/sandbox/language/kotlin.source.rs`.
#
# Two things about this list are not free choices:
#
#  - the `-embeddable` variants, because the compiler they plug into is the embeddable one.
#    The plain jars reference `com.intellij.…` where the embeddable compiler has relocated
#    those classes to `org.jetbrains.kotlin.com.intellij.…`, and the plugin then fails to
#    load with a message about a missing class rather than about a mismatched distribution.
#  - the UNVERSIONED names on the right. The compiler looks for exactly these four file names
#    under `<kotlin home>/lib`, which is a Kotlin distribution's layout rather than a Maven
#    repository's — so the install script writes that directory, from this list.
#
# `<coordinate> <file name>`, one per line.
read -r -d '' KOTLIN_SCRIPTING_JARS <<'JARS' || true
org.jetbrains.kotlin:kotlin-scripting-compiler-embeddable:2.4.10 kotlin-scripting-compiler.jar
org.jetbrains.kotlin:kotlin-scripting-compiler-impl-embeddable:2.4.10 kotlin-scripting-compiler-impl.jar
org.jetbrains.kotlin:kotlin-scripting-common:2.4.10 kotlin-scripting-common.jar
org.jetbrains.kotlin:kotlin-scripting-jvm:2.4.10 kotlin-scripting-jvm.jar
JARS
