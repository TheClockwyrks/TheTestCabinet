# `gg-sandbox-kotlin`

The **Kotlin** program language's toolchain pin and its hand-written SDK.

|                                            |                                                                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`kotlin-version.sh`](kotlin-version.sh)   | the Kotlin release this arm is pinned to, and the jars its compiler runs with                                                           |
| [`src/`](src/)                             | the **SDK** a model's program is compiled against, and the KDoc every word a model reads is reflected out of                            |
| [`../gg-sandbox-jvm/`](../gg-sandbox-jvm/) | the canonical ABI and the wire encoding, which the Java arm compiles too                                                                |
| [`libraries.txt`](libraries.txt)           | the packages this arm says a program may reach, grouped as the catalogue renders them                                                   |
| [`build.sh`](build.sh)                     | compiles the SDK to `$GG_ARTIFACTS_OUT_DIR/kotlin.sdk.jar`; `crates/gg-sandbox-artifacts/kotlin` runs it on every build                 |
| [`signatures.sh`](signatures.sh)           | reflects `kotlin.signatures.json` out of the SDK's own KDoc, into `$GG_SIGNATURES_OUT_DIR`; `crates/gg/build.rs` runs it on every build |
| [`tools/`](tools/)                         | the reflector `signatures.sh` runs, and the module table it reads                                                                       |

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

## What this arm does _not_ install

A JDK, and TeaVM. It compiles Kotlin to JVM bytecode and hands that bytecode to the road it
shares with the Java arm, so `install-kotlin.sh` **runs** `install-java.sh` rather than
installing a second JDK beside it. One JDK per machine, one place where the TeaVM release is
decided, and one `crates/gg/src/sandbox/language/jvm.rs` where both arms find them.

## What a program is

A whole Kotlin file: the `import` lines the model wrote, and a `fun main()` with no parameters.
gg writes nothing into it, so the compiler reads the reply byte for byte and every diagnostic and
every stack frame is already in the model's own coordinates. TeaVM's `WEBASSEMBLY_WASI` backend
turns the bytecode into a core module and gg encodes that as the component the turn runs.

## The surface is thirteen packages, and a program writes a name in full

Every function, every type and every member is reached by a **module-qualified** name:
`gg.files.readFile`, `gg.files.FileRead`, `gg.delegation.SubagentHandle.send`. Thirteen packages
carry them — `gg.files`, `gg.shell`, `gg.board`, `gg.tasks`, `gg.memories`, `gg.docs`, `gg.views`,
`gg.context`, `gg.delegation`, `gg.skills`, `gg.programs`, `gg.session`, plus `gg.core` for the
failure type and the values every other module speaks in — and each owns the types it produces,
so two of them are free to declare a `Usage` and neither has to be renamed.

Idiomatic Kotlin is a **top-level function in a package**, which is the closest thing any arm
has to a free function, so that is what these are. There is no holder object, no static class,
and nothing that has to be in scope before anything can be reached.

**gg writes no import into a program, and a program has two ways to reach a name.** A
fully-qualified Kotlin name resolves from the root package with nothing above it — a model's
program has no `package` line, so it is itself in the root one — and `gg.files.readFile("main.kt")`
is a call a reply can write as it stands. The other is `import gg.files.*`, which is the line every
module's catalogue entry states and what a Kotlin author writes to reach a package's top-level
functions and the types its signatures name.

`gg.log` is the one declaration outside those thirteen packages. It writes a line to the run's own
log, which reaches the operator and never the model, and it is outside the catalogue on the terms
every arm's `console.log` is: the catalogue describes the capability modules and this belongs to
none of them. Standard output reaches nobody at all.

The bridge is out of a program's reach, and by a stronger fence than a package alone would give
it. Everything in [`src/gg/internal/`](src/gg/internal/) is `internal`, which in Kotlin means
_visible inside this module_ — and a model's program is compiled as its own module against this
one's jar, so it cannot name `ggCall` at all. The reflector skips that package by name, so
nothing there can reach a model as prose.

## Where the identity of a call is written

On the declaration, in its own KDoc, as `@ggop files.read_file` — never in a table beside it,
because a table is a second place to be wrong. A declaration that is a _second_ way to reach an
operation some other declaration binds carries `@ggalias` instead, and a package says which of
gg's modules it is with a `@ggmodule` tag in the file-level KDoc above its `package` line.

Those tags are written **first**, before `@param`, and that is a measured constraint. KDoc's
parser starts a new tag at an `@` it does not know, so an `@ggop` after a `@param` or a `@return`
arrives as its own tag — but it does _not_ after a `@throws`: that tag's content swallows every
following line to the end of the comment, blank lines included. The reflector detects the
swallowed case and names it, rather than reporting a declaration that plainly names an operation
as one that names none.

## Three artifacts, shipped three ways

Each of them can only go one way, and where each goes is the argument:

- The **compiler** is the embeddable Kotlin compiler and its jars — third-party, far too large
  for gg's binary, installed rather than built, into the
  [gg toolchain image](../../containers/gg-toolchains/).
- gg's own **compiler driver** — the thing that speaks to `K2JVMCompiler` and TeaVM's
  `InProcessBuildStrategy` on gg's behalf — is a single `.java` file at
  `crates/gg/src/sandbox/checkers/kotlin.compiler.java`, assembled with the JVM arms' shared
  back end and run by the JDK's **single-file source-code launcher**.
- The **SDK** is a jar, because a classpath entry is what Kotlin calls a library, and it rides
  inside gg's own binary rather than being installed beside TeaVM. The image is built separately
  from the binary that runs in it, so an SDK living there could be a different vintage from the gg
  whose catalogue describes it — and a model shown one surface in its prompt and compiled against
  another is the failure this whole seam is built to prevent. `crates/gg-sandbox-artifacts/kotlin`
  cuts it on every build of gg, out of the same `src/` the catalogue is reflected from, so the two
  cannot be two vintages. `build.sh` fixes every jar entry's timestamp and sorts the entry list, so
  two builds of identical sources are identical bytes.

One detail of that jar is a measured trap rather than a preference: it carries
`META-INF/gg.kotlin_module` as well as its class files. That file is what tells the compiler
which facade class a package's **top-level** declarations live in, and a jar built without it
compiles, ships, and answers every `gg.files.readFile` in every program with
`Unresolved reference 'files'`.

## Which documentation tool this is, and why it is not Dokka

Kotlin's documentation tool is **Dokka**, and Dokka has no JSON output: its formats are HTML,
GFM, Jekyll and Javadoc. Emitting anything else means writing a Dokka _plugin_ — a second Kotlin
artifact compiled against `dokka-core`, run through `dokka-cli` with a plugins classpath, and
pinned separately from the compiler that compiles a model's program.

And Dokka reads KDoc by asking the **compiler's own front end** for it, which is what
[`tools/GgSignatures.kt`](tools/GgSignatures.kt) does directly: `KotlinCoreEnvironment` builds
the compiler's project, the same `KtFile` the compiler compiles is what gets read, and `KDoc` is
the compiler's own KDoc parser rather than a regular expression over comments. The difference is
a dependency, not a reading — and the property that decides it is the one PureScript's arm has,
whose documentation tool _is_ its compiler: **the release that describes the surface is the
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
it, one whose opening paragraph is more than one line where a brief belongs, one whose module
table and packages disagree in either direction, or one that leaves a public top-level function
naming no gg operation. Between them, prose a model would have been shown as an empty line — or
as a paragraph where it expected a summary — fails on the author instead.

## Where the rest of this arm is

- `crates/gg/src/sandbox/language/kotlin.compile.rs` — the warm-JVM pool, the three classpaths,
  the four failure bands and the generated entry class.
- `crates/gg/src/sandbox/language/kotlin.source.rs` — the one convention a program keeps, the
  code-module wrapper and the export scan.
- `crates/gg/src/sandbox/language/kotlin.substrate.test.rs` — real Kotlin through gg's real
  linker, membrane and store.
- `crates/gg/src/sandbox/language/kotlin.surface.test.rs` — every gg tool driven through that
  membrane from its Kotlin spelling, the agreement gate over the generated catalogue, and every
  declared library driven into the real compiler.
- [`gg/languages/kotlin.md`](../../apps/docs/src/content/docs/gg/languages/kotlin.md) — the
  prose, including what a program is and what this toolchain is not.
