# `gg-sandbox-kotlin`

The **Kotlin** program language's toolchain pin.

| | |
| --- | --- |
| [`kotlin-version.sh`](kotlin-version.sh) | the Kotlin release this arm is pinned to, the jars its compiler runs with, and the four the scripting plugin is loaded by name from |

That is all it holds **today**. This arm has landed its *execution substrate* — the compile,
the guest and the proof that a real Kotlin program runs through gg's real membrane — and not
its SDK or its registration, which land later and on the order every arm before it took. When
the SDK arrives it lives here, beside this pin, exactly as the
[Java arm's](../gg-sandbox-java/README.md) does.

## Why the pin lives here

Two worlds have to install the same compiler and neither owns the other:

- [`scripts/ci/install-kotlin.sh`](../../scripts/ci/install-kotlin.sh), for a developer's or
  CI machine running gg's tests;
- [`containers/gg-toolchains/Dockerfile`](../../containers/gg-toolchains/Dockerfile), for a
  gg run image — which runs that same script rather than repeating its list of jars.

A third copy of the version lives at
`crates/gg/src/sandbox/checkers/kotlin.toolchain.json`, for the Rust side's own messages, for
the key of the directory it places its compiler driver in, and for the **handshake**: a daemon
that loaded a different release is refused by number rather than left to word its diagnostics
differently. It is not a duplicate that can drift — `kotlin.compile.test.rs` fails if the two
files ever name different releases, or if a jar in the list is at another version.

## What this arm does *not* install

A JDK, and TeaVM. It compiles Kotlin to JVM bytecode and hands that bytecode to the Java arm's
second half, so `install-kotlin.sh` **runs** `install-java.sh` rather than installing a second
JDK beside it. One JDK per machine, one place where the TeaVM release is decided, and one
`crates/gg/src/sandbox/language/jvm.rs` where both arms find them.

## The one directory that is not a classpath

`kotlin-home/lib`. gg compiles a model's program as a Kotlin **script**, because Kotlin refuses
`object`, `interface`, `enum class`, `typealias` and `private fun` as *local* declarations —
so wrapping a reply in a function gg declares would refuse five things a Kotlin author writes
without thinking. The compiler loads its scripting plugin by four **unversioned** file names
out of that tree, which is a Kotlin distribution's layout rather than a Maven repository's, so
the installer lays one out. Without it every program on this arm fails with
`SCRIPTING_ERROR: Unable to evaluate script, no scripting plugin loaded` — a sentence about
gg's packaging wearing the shape of a diagnostic about the model's program.
