# `gg-sandbox-kotlin`

The **Kotlin** program language's toolchain pin and its hand-written SDK.

| | |
| --- | --- |
| [`kotlin-version.sh`](kotlin-version.sh) | the Kotlin release this arm is pinned to, the jars its compiler runs with, and the four the scripting plugin is loaded by name from |
| [`src/`](src/) | the **SDK** a model's program is compiled against, and the KDoc every word a model reads is reflected out of |
| [`libraries.txt`](libraries.txt) | the packages this arm says a program may reach, grouped as the prompt shows them |
| [`build.sh`](build.sh) | compiles the SDK to `crates/gg/src/sandbox/checkers/kotlin.sdk.jar` |
| [`signatures.sh`](signatures.sh) | reflects `crates/gg/src/sandbox/guests/kotlin.signatures.json` out of the SDK's own KDoc |
| [`tools/`](tools/) | the reflector `signatures.sh` runs, and the identity table it reads |

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

## The SDK is in the root package, and that is the decision

Every other arm's SDK sits in a namespace a program reaches through an import — `gg.*`,
`import Gg`, `from gg import …`. This one has none, and the reason is what it buys.

Kotlin **forbids importing from the root package** into a named one, and resolves a name in the
*same* package with no import at all. A model's program has no `package` line, so it is itself
in the root package — which means `fs.readFile("main.kt")` resolves with nothing written above
it. That is what keeps the substrate's headline property intact now that there is a surface to
reach: **a reply with no `import` in it is still compiled byte for byte, with a shift of zero**,
where every other compiled arm has to write a header and move every diagnostic back over it.

The bridge is still out of a program's reach, and by a stronger fence than a package would give
it. Everything in [`src/internal/`](src/internal/) is `internal`, which in Kotlin means *visible
inside this module* — and a model's program is compiled as its own module against this one's
jar, so it cannot name `ggCall` at all. The reflector never reads that directory either, so
nothing there can reach a model as prose.

## Three artifacts, shipped three ways

Each of them can only go one way, and where each goes is the argument:

- The **compiler** is the embeddable Kotlin compiler and its jars — third-party, far too large
  for gg's binary, installed rather than built, into the
  [gg toolchain image](../../containers/gg-toolchains/).
- gg's own **compiler driver** — the thing that speaks to `K2JVMCompiler` and TeaVM's
  `InProcessBuildStrategy` on gg's behalf — is a single `.java` file at
  `crates/gg/src/sandbox/checkers/kotlin.compiler.java`, assembled with the JVM arms' shared
  back end and run by the JDK's **single-file source-code launcher**.
- The **SDK** is a jar, because a classpath entry is what Kotlin calls a library, and it is
  **committed** rather than installed beside TeaVM. The image is built separately from the
  binary that runs in it, so an SDK living there could be a different vintage from the gg whose
  catalogue describes it — and a model shown one surface in its prompt and compiled against
  another is the failure this whole seam is built to prevent. Committed, the SDK and the
  catalogue reflected from it move in one diff, and
  [`scripts/ci/contract-drift.sh`](../../scripts/ci/contract-drift.sh) rebuilds both and diffs
  them. `build.sh` fixes every jar entry's timestamp and sorts the entry list, so two builds of
  identical sources are identical bytes.

One detail of that jar is a measured trap rather than a preference: it carries
`META-INF/gg.kotlin_module` as well as its class files. That file is what tells the compiler
which facade class a package's **top-level** declarations live in, and a jar built without it
compiles, ships, and answers every `fs.readFile` in every program with
`Unresolved reference 'fs'`.

## Which documentation tool this is, and why it is not Dokka

Kotlin's documentation tool is **Dokka**, and Dokka has no JSON output: its formats are HTML,
GFM, Jekyll and Javadoc. Emitting anything else means writing a Dokka *plugin* — a second Kotlin
artifact compiled against `dokka-core`, run through `dokka-cli` with a plugins classpath, and
pinned separately from the compiler that compiles a model's program.

And Dokka reads KDoc by asking the **compiler's own front end** for it, which is what
[`tools/GgSignatures.kt`](tools/GgSignatures.kt) does directly: `KotlinCoreEnvironment` builds
the compiler's project, the same `KtFile` the compiler compiles is what gets read, and `KDoc` is
the compiler's own KDoc parser rather than a regular expression over comments. The difference is
a dependency, not a reading — and the property that decides it is the one PureScript's arm has,
whose documentation tool *is* its compiler: **the release that describes the surface is the
release that compiles a program against it**, because both come out of `kotlin-version.sh`'s one
pinned `kotlin-compiler-embeddable`.

## Working on the SDK

```sh
scripts/ci/install-kotlin.sh              # once: the Kotlin jars, the JDK and TeaVM
packages/gg-sandbox-kotlin/build.sh       # the jar a program is compiled against
packages/gg-sandbox-kotlin/signatures.sh  # the catalogue a model reads
cargo nextest run -p test-cabinet-gg sandbox::language::kotlin
```

Both scripts are gates as much as they are builds. `build.sh` compiles under
`-Xexplicit-api=strict -Werror`, which is Kotlin's own public-API completeness check — every
declaration a model can see states its visibility and its return type; `signatures.sh` reads the
same comments through the compiler's front end and refuses to emit a catalogue with a blank in
it, or one whose identity table names a function no class declares, or one that leaves a public
function of an API object unnamed. Between them, prose a model would have been shown as an empty
line fails on the author instead.

## Where the rest of this arm is

- `crates/gg/src/sandbox/language/kotlin.compile.rs` — the warm-JVM pool, the four classpaths,
  the three failure bands and the generated entry class.
- `crates/gg/src/sandbox/language/kotlin.source.rs` — the script shape, the import hoist and the
  export scan.
- `crates/gg/src/sandbox/language/kotlin.substrate.test.rs` — real Kotlin through gg's real
  linker, membrane and store.
- `crates/gg/src/sandbox/language/kotlin.surface.test.rs` — every gg tool driven through that
  membrane from its Kotlin spelling, the agreement gate over the committed catalogue, and every
  declared library driven into the real compiler.
- [`gg/program-languages.md`](../../apps/docs/src/content/docs/gg/program-languages.md) — the
  prose, including why a program is a script.
