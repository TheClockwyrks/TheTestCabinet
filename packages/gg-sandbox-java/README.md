# `gg-sandbox-java`

The **Java** program language's toolchain pin and its hand-written SDK.

| | |
| --- | --- |
| [`java-version.sh`](java-version.sh) | the JDK and TeaVM releases this arm is pinned to |
| [`src/gg/`](src/gg/) | the **SDK** a model's program is compiled against, and the doc comments every word a model reads is reflected out of |
| [`libraries.txt`](libraries.txt) | the packages this arm says a program may reach, grouped as the catalogue renders them |
| [`build.sh`](build.sh) | compiles the SDK to `$GG_ARTIFACTS_OUT_DIR/java.sdk.jar`; `crates/gg-sandbox-artifacts/java` runs it on every build |
| [`signatures.sh`](signatures.sh) | reflects `java.signatures.json` out of the SDK's Javadoc, into `$GG_SIGNATURES_OUT_DIR`; `crates/gg/build.rs` runs it on every build |
| [`tools/`](tools/) | the doclet `signatures.sh` runs, and the module table it reads |

## What the surface is shaped like

One **package per capability module**, and in each of them one class that *is* the module:
`gg.files.Files`, `gg.views.Views`, `gg.board.Board`. Java has no free functions, so an
operation every other arm spells as one is a `static` method here — `Files.readFile(path)`
— and the types a module hands back are nested in it, so `Files.FileRead` and
`Views.OpenView` are names a program can write without either module having to give up a
short one. `gg` itself is the thirteenth module: the exception and the types every other
module's signatures name.

Nothing is reached through a value that has to be in scope already. What gg writes into a
program's header is one on-demand `import` per module, so every name a model reads in a
signature is a name it can type, and every name is qualified by the module a search filed
it under.

Where a value carries an operation of its own, it carries the method too:
`handle.send(text)` beside `Delegation.sendMessage(id, text)`, `view.close()` beside
`Views.close(selector)`. Those are the same operation reached a second way rather than a
second operation, and the catalogue says so.

## Why the pin lives here

Two worlds have to install the same compiler and neither owns the other:

- [`scripts/ci/install-java.sh`](../../scripts/ci/install-java.sh), for a developer's or
  CI machine running gg's tests;
- [`containers/gg-toolchains/Dockerfile`](../../containers/gg-toolchains/Dockerfile), for
  a gg run image — which runs that same script rather than repeating its list of jars.

A third copy of the two version numbers lives at
`crates/gg/src/sandbox/checkers/java.toolchain.json`, for the Rust side's own messages and
for the key of the directory it places its compiler driver in. It is not a duplicate that
can drift: `java.compile.test.rs` fails if the two files ever name different releases, or
if a TeaVM jar in the list is at a version other than the pinned one.

## Three artifacts, shipped three ways

Each of them can only go one way, and where each goes is the argument:

- The **compiler** is a JDK and TeaVM's jars. Both are third-party, both are far too large
  for gg's binary, and both are installed rather than built — into the
  [gg toolchain image](../../containers/gg-toolchains/).
- gg's own **compiler driver** — the thing that speaks to `javax.tools.JavaCompiler` and
  TeaVM's `InProcessBuildStrategy` on gg's behalf — is a single `.java` file at
  `crates/gg/src/sandbox/checkers/java.compiler.java`, embedded in gg's binary and run by
  the JDK's **single-file source-code launcher**. The launcher compiles it in memory once
  per JVM, inside the start this arm pays anyway. So there is no jar to build, no binary
  artifact to commit and no reproducible-build gate to keep green — and the driver a
  reviewer reads in the diff is the driver that runs.
- The **SDK** is a jar, because a classpath entry is what Java calls a library, and it is
  **committed** rather than installed beside TeaVM. The image is built separately from the
  binary that runs in it, so an SDK living there could be a different vintage from the gg
  whose catalogue describes it — and a model shown one surface in its prompt and compiled
  against another is the failure this whole seam is built to prevent. Committed, the jar
  travels with the gg that describes it. It is also the half of the pair that can be
  committed stale, since the catalogue is reflected out of the same `src/gg/` on every
  build — which is why
  [`scripts/ci/contract-drift.sh`](../../scripts/ci/contract-drift.sh) re-cuts and diffs
  the jar. `build.sh` fixes every jar entry's timestamp and sorts the entry list, so two
  builds of identical sources are identical bytes.

## What the pins mean

`JDK_VERSION` is an Eclipse Temurin release, chosen because Temurin publishes a plain
relocatable tarball per platform: no installer, no distribution packaging, and therefore
the same tree on the Debian-derived run images and on `blender-gg`'s Ubuntu. It is 21
rather than the newest because gg compiles a model's program with `--release 21` whatever
JDK it runs, so the bytecode is the same either way and the pin buys javac's own
diagnostics agreeing between machines. Those diagnostics are what the arm's tests assert
and what a model is shown on a compile failure, so moving the pin is a change to that text
and belongs to its own change.

`TEAVM_VERSION` and the jar list are TeaVM and every runtime dependency of `teavm-tooling`
and `teavm-classlib`, resolved once and written down rather than resolved by Maven at
install time. An install step that runs a dependency resolver is an install step whose
result depends on the day it ran, and this arm's whole point is that two runs of a study
differ in the language and in nothing else.

The release is 0.13.1 and stays there. It is the last one carrying the `WEBASSEMBLY_WASI`
target, there is no 0.13.2, and both the 0.12.x and 0.13.x lines are closed upstream.

## Working on the SDK

```sh
scripts/ci/install-java.sh          # once: the JDK and TeaVM's jars
packages/gg-sandbox-java/build.sh       # the jar a program is compiled against
packages/gg-sandbox-java/signatures.sh  # the catalogue a model reads
cargo nextest run -p test-cabinet-gg sandbox::language::java
```

Both scripts are gates as much as they are builds. `build.sh` compiles the model-facing
packages a second time under `-Xdoclint:all/protected -Werror`, so an undocumented parameter
or a broken `{@link}` is an error; `signatures.sh` reads the same comments through the
doclet API and refuses to emit a catalogue with a blank in it — a method that names no gg
operation, a module class the table does not name, and an opening paragraph of more than one
line included. Between them, prose a model would have been shown as an empty line fails on
the author instead.

Two block tags carry what a doc comment cannot say in prose: `@ggop files.read_file` on
every model-facing method, and `@ggmodule files` on the class that is the module.
**Measured, with the build's own `-Xdoclint:all/protected -Werror`:** an unknown block tag
passes silently and arrives whole as one node, while the `<ggop>` element the C++ arm uses
is two errors here (`unknown tag: ggop`). The two arms therefore mark the same thing in
opposite ways, and each is the way its own documentation tool accepts.

## Where the rest of this arm is

- `crates/gg/src/sandbox/language/java.compile.rs` — the warm-JVM pool, the two failure
  bands, the source-map fold and the generated entry class.
- `crates/gg/src/sandbox/language/java.source.rs` — the wrapper, the import hoist and the
  export scan.
- `crates/gg/src/sandbox/language/java.substrate.test.rs` — real Java through gg's real
  linker, membrane and store.
- `crates/gg/src/sandbox/language/java.surface.test.rs` — every gg tool driven through that
  membrane from its Java spelling, the agreement gate over the generated catalogue, and
  every declared library driven into the real compiler.
- [`gg/languages/java.md`](../../apps/docs/src/content/docs/gg/languages/java.md) —
  the prose, including what TeaVM is not.
