# `gg-sandbox-kotlin`

The **Kotlin** program language's toolchain pin and its hand-written SDK.

| | |
| --- | --- |
| [`kotlin-version.sh`](kotlin-version.sh) | the Kotlin release this arm is pinned to, the jars its compiler runs with, and the four the scripting plugin is loaded by name from |
| [`src/`](src/) | the **SDK** a model's program is compiled against, and the KDoc every word a model reads is reflected out of |
| [`libraries.txt`](libraries.txt) | the packages this arm says a program may reach, grouped as the prompt shows them |
| [`build.sh`](build.sh) | compiles the SDK to `crates/gg/src/sandbox/checkers/kotlin.sdk.jar` |
| [`signatures.sh`](signatures.sh) | reflects `crates/gg/src/sandbox/guests/kotlin.signatures.json` out of the SDK's own KDoc |
| [`tools/`](tools/) | the reflector `signatures.sh` runs, and the module table it reads |

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

**gg writes no import header, and a program still needs none.** A fully-qualified Kotlin name
resolves from the root package with nothing above it — a model's program has no `package` line,
so it is itself in the root one — and `gg.files.readFile("main.kt")` is therefore a call a reply
can write as it stands. That keeps the substrate's headline property intact: *a reply with no
`import` in it is compiled byte for byte, with a shift of zero*, where every other compiled arm
writes a header and moves every diagnostic back over it.

A star import per package was the alternative and it **buys nothing**. Every name in this arm's
documentation is written in full — `gg.files.readFile` is the fully-qualified name the catalogue
carries and the spelling a model reads — so a header of star imports would shorten nothing a model
was ever going to write, while putting a line per module in front of every program. They would also
cost something: two modules are free to declare a type of the same name, and two star imports
decide between them by a rule that is nowhere in the call. A program that wants the short form
still writes its own import — gg hoists it — and picks which names it is importing.

The bridge is out of a program's reach, and by a stronger fence than a package alone would give
it. Everything in [`src/gg/internal/`](src/gg/internal/) is `internal`, which in Kotlin means
*visible inside this module* — and a model's program is compiled as its own module against this
one's jar, so it cannot name `ggCall` at all. The reflector skips that package by name, so
nothing there can reach a model as prose.

## Where the identity of a call is written

On the declaration, in its own KDoc, as `@ggop files.read_file` — never in a table beside it,
because a table is a second place to be wrong. A declaration that is a *second* way to reach an
operation some other declaration binds carries `@ggalias` instead, and a package says which of
gg's modules it is with a `@ggmodule` tag in the file-level KDoc above its `package` line.

Those tags are written **first**, before `@param`, and that is a measured constraint. KDoc's
parser starts a new tag at an `@` it does not know, so an `@ggop` after a `@param` or a `@return`
arrives as its own tag — but it does *not* after a `@throws`: that tag's content swallows every
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
compiles, ships, and answers every `gg.files.readFile` in every program with
`Unresolved reference 'files'`.

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
it, one whose opening paragraph is more than one line where a brief belongs, one whose module
table and packages disagree in either direction, or one that leaves a public top-level function
naming no gg operation. Between them, prose a model would have been shown as an empty line — or
as a paragraph where it expected a summary — fails on the author instead.

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
