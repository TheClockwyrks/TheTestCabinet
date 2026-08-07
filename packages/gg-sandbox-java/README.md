# `gg-sandbox-java`

The **Java** program language's toolchain pin, and nothing else.

This directory is not a package and builds nothing. It holds one file —
[`java-version.sh`](java-version.sh) — because two worlds have to install the same
compiler and neither owns the other:

- [`scripts/ci/install-java.sh`](../../scripts/ci/install-java.sh), for a developer's or
  CI machine running gg's tests;
- [`containers/gg-toolchains/Dockerfile`](../../containers/gg-toolchains/Dockerfile), for
  a gg run image — which runs that same script rather than repeating its list of jars.

A third copy of the two version numbers lives at
`crates/gg/src/sandbox/checkers/java.toolchain.json`, for the Rust side's own messages and
for the key of the directory it places its compiler driver in. It is not a duplicate that
can drift: `java.compile.test.rs` fails if the two files ever name different releases, or
if a TeaVM jar in the list is at a version other than the pinned one.

## Why there is no build here

Every other compiled arm has a `build.sh` in its own package directory, because every other
one ships a **built artifact**: Ruby's Opal compiler is 2.9 MB of generated JavaScript,
PureScript's library set is a 1.2 MB tarball of compiled externs. Java ships neither.

- The **compiler** is a JDK and TeaVM's jars. Both are third-party, both are far too large
  for gg's binary, and both are installed rather than built.
- gg's own **compiler driver** — the thing that speaks to `javax.tools.JavaCompiler` and
  TeaVM's `InProcessBuildStrategy` on gg's behalf — is a single `.java` file at
  `crates/gg/src/sandbox/checkers/java.compiler.java`, embedded in gg's binary and run by
  the JDK's **single-file source-code launcher**. The launcher compiles it in memory once
  per JVM, inside the start this arm pays anyway. So there is no jar, no committed binary
  and no reproducible-build gate to keep green — and the driver a reviewer reads in the
  diff is the driver that runs.

## What the pins mean

`JDK_VERSION` is an Eclipse Temurin release, chosen because Temurin publishes a plain
relocatable tarball per platform: no installer, no distribution packaging, and therefore
the same tree on the Debian-derived run images and on `blender-gg`'s Ubuntu. It is **21**
rather than the newest, because TeaVM reads class files with a bundled ASM and a JDK whose
class-file version outran it fails with `Unsupported class file major version` — which is
not a diagnostic a model could act on. gg compiles a model's program with `--release 21`
whatever JDK it runs, so the pin is about javac's own diagnostics agreeing between machines
rather than about the bytecode.

`TEAVM_VERSION` and the jar list are TeaVM and every runtime dependency of
`teavm-tooling`, resolved once and written down rather than resolved by Maven at install
time. An install step that runs a dependency resolver is an install step whose result
depends on the day it ran, and this arm's whole point is that two runs of a study differ in
the language and in nothing else.

## Where the rest of this arm is

- `crates/gg/src/sandbox/language/java.compile.rs` — the warm-JVM pool, the two failure
  bands, the source-map fold and the generated entry class.
- `crates/gg/src/sandbox/language/java.source.rs` — the wrapper, the import hoist and the
  export scan.
- `crates/gg/src/sandbox/language/java.substrate.test.rs` — real Java through gg's real
  linker, membrane and store.
- [`gg/program-languages.md`](../../apps/docs/src/content/docs/gg/program-languages.md) —
  the prose, including what TeaVM is not.
