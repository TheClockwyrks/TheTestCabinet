---
title: "Java"
---

The `java` arm compiles a model's reply to bytecode with `javac`, translates
that bytecode to JavaScript with TeaVM, and hands the JavaScript to the
ECMAScript guest. Both compilers run inside a warm JVM that gg keeps between
preparations. An agent selects the arm with the `responses-as-code`
capability's `language` parameter.

This arm does not keep the [invariants](/gg/responses-as-code/invariants/) yet,
and this page states what it does today. gg wraps the reply and writes the
imports and the entry point around it, and a compile diagnostic's line is
reached by an offset gg computes rather than through a source map.

## Preparation

A program is a sequence of statements. Java has nowhere for a loose statement to
live, so gg wraps the reply in the body of `Program.ggBody()`, declared
`throws Throwable` so a program calling something with a checked exception needs
no `try`, and generates an entry class beside it. A helper type the program
declares is therefore a local declaration and may not carry an access modifier.
`public class Helper {}` is a located compile error and `class Helper {}`
compiles.

Everything gg does to the source before javac reads it is lexical and
line-preserving, because a diagnostic is only worth handing back if it names the
line the model wrote. Lines may be added ahead of the body, which every
diagnostic is then moved back by. Nothing is inserted or removed inside it, and
the scans compare bytes rather than slicing the source so that a multi-byte
character anywhere in the reply still reaches javac.

- An `import` the model wrote is copied into the header and blanked where it
  stood.
- A `package` declaration is refused by name.
- `@JSExport` is inserted inline before a code module's exported method.

The header imports eight standard packages without being asked: `java.util`,
`java.util.function`, `java.util.stream`, `java.math`, `java.time`,
`java.time.format`, `java.text` and `java.util.regex`. It carries thirteen more
on-demand imports for gg's own surface, `gg.*` plus one per capability module.

## Compilation

The warm JVMs are a pool of four processes, each lent to one preparation at a
time. A build writes into the calling preparation's own workspace, the daemon
stands on ground of its own, and each request builds through a fresh build
strategy. A JVM is retired after 64 builds, because every build makes a fresh
class loader over the toolchain's jars. A build may take 180 seconds and a JVM
start 120 seconds; past either the failure is reported as a toolchain failure,
and a JVM that did not answer its build is retired. Warming starts one JVM and
places the driver and the SDK jar, so the first code turn pays for neither.

Two TeaVM settings are required. `setJsModuleType(NONE)`, so the emitted code
names its entry point as a bare identifier the guest's scope can reach.
`setStrict(true)`, without which TeaVM omits the null and bounds checks that
make a `NullPointerException` an exception at all. The arm names `javac` as its
checker, so compile time is recorded on the failing path as well as the
succeeding one.

## Toolchain and build outputs

The JDK and TeaVM's jars are found in the order `TCAB_GG_JAVA` and
`TCAB_GG_TEAVM`, then `/opt/gg/toolchains/java`, then `~/.local/share/gg-java`.
A `java` on `PATH` is the last answer for the JDK binary. Missing TeaVM jars are
a toolchain failure naming all three places.

gg's compiler driver is assembled from this arm's front end
(`checkers/java.compiler.java`) and the backend both JVM arms share
(`checkers/jvm.backend.java`), and is run by the JDK's single-file source-code
launcher. `checkers/java.toolchain.json` pins the JDK and TeaVM releases and the
driver protocol, and a driver answering another protocol is refused at the
handshake. The driver and the SDK jar are placed in a shared directory keyed on
the pinned TeaVM release and a digest of both files.

The arm has no guest component of its own and declares TypeScript's. The build
produces three things for it, and commits none:

- `java.sdk.jar`, the SDK compiled, cut by `crates/gg-sandbox-artifacts/java`
  running `packages/gg-sandbox-java/build.sh` and embedded in the gg binary.
- `java.adapter.wasm`, the pinned `wasi_snapshot_preview1` reactor adapter both
  JVM arms encode their WebAssembly components with.
- `java.signatures.json`, the signature catalogue, reflected by
  `packages/gg-sandbox-java/signatures.sh` and embedded from the build's own
  `OUT_DIR`. gg refuses a catalogue generated for another language.

## The SDK and the signature catalogue

The SDK is `packages/gg-sandbox-java/src/gg/`, compiled into the jar both
compilers put on their classpath, so a program type-checks against the same
bytes TeaVM translates. A call is a static method on an imported class,
`Files.readFile("main.java")`, whose catalogue key is `gg.files.Files.readFile`.
Every gg function is reached through a qualified name. Types are nested in the
module that produces them, `Files.FileRead` and `Views.OpenView`, so the same
short name may belong to two modules.

The SDK is spelled the way a Java library is spelled:

- An optional argument is an overload. `Files.readFile("main.java")` and
  `Files.readFile("main.java", 2, 5)`.
- A list argument is varargs, which also spells "and you may name none".
- A bag of optional fields is a builder, and a three-way patch field is two
  methods, so `clearDescription()` says what no sentinel would.
- A read is a sealed interface narrowed by a `switch`, every result is a record,
  and a value the wire may omit is `Optional` or `OptionalInt`.
- A fixed choice is an enum, and one with a wire spelling carries it as
  `wireName()`.
- A failure is an unchecked `ToolError` carrying `code()`, so a composed program
  needs no `try` around every line.

Every function is bound in every program, and a call the agent was not granted is
refused by the host. See [static SDKs](/gg/languages/static-sdks/) for that surface's rules.

The catalogue is reflected by `javadoc` and a doclet of gg's own, so a signature
is javac's reading of the declaration and every word of prose comes off the
declaration it describes. An `@ggop` block tag carries operation identity,
`tools/GgCatalogue.java` holds the thirteen module identities and the order they
are presented in, and the doclet refuses to emit a catalogue with a blank in it.
`build.sh` compiles the model-facing packages a second time under
`-Xdoclint:all/protected -Werror`, so a missing `@param` is an error on the
author.

## The library set

The library set is TeaVM's classlib, a subset of `java.base` plus the ThreeTen
backport that makes `java.time` real. `packages/gg-sandbox-java/libraries.txt`
declares it in groups, the catalogue's `libraries` section is reflected from
that file, and a compile failure quotes that section back group by group. The
arm's surface tests hold the claim to the artifact: every declared package goes
through the real javac and the real TeaVM, and a real class in each must compile
and run. The subset is a subset by method as well as by class, and an absence of
either kind is a located compile error at the model's own line, on the turn that
reached for it.

The classlib is wider than the declared set, so a package the set omits may still
compile. `java.nio.file` is the one that matters: the classlib backs it with an
in-memory filesystem that starts empty and that nothing writes to, so a read
raises `NoSuchFileException` and a write raises `IOException`. The filesystem a
program reaches is gg's own `fs` module.

## Failures

Only diagnostics about the model's own file are the model's. When every error
names a file gg generated, the whole build is reported as a toolchain failure
instead, as is a failure of TeaVM or the driver itself. Diagnostics from either
compiler are deduplicated and capped at eight, and their lines are moved back
over the header gg wrote. The band is decided over the whole set rather than the
shown eight: any javac code marking text the parser could not read makes the
failure a syntax error, and everything else is a compile error. A class TeaVM's
classlib does not carry is a located compile error on the turn that wrote it.
The shared rules are on [compilation](/gg/languages/compilation/).

At run time the generated entry class names twelve exception classes and
`StackOverflowError` in `catch` clauses one by one, subtype before supertype,
because TeaVM answers `null` from `getClass().getName()` for a
`NullPointerException`. Each clause describes what it caught and rethrows the
original. A class outside the list is described from `getName()`, with a stated
sentence when that answers nothing. The location comes from TeaVM's own source
map, folded on the host into a generated-line to model-line table shipped in the
bundle's prelude, so a `NullPointerException` on the model's line 14 reads
`java.lang.NullPointerException` followed by `at program.java:14`.

Integer division by zero answers `0` rather than throwing, because the
arithmetic underneath is JavaScript's, and a `Thread` a program starts is
refused by the sandbox.

Two failures cross untouched, so that the guest classifies the turn from what
the host said. A `ToolError` the host raised is recorded as the host's own
refusal before any Java description is considered, and a JavaScript exception
TeaVM wrapped and prefixed `(JavaScript)` is passed through undescribed.

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`java`, and `code-nothing-shown.hbs` through a clause naming
`System.out.println`. The segment states:

- the reply is a sequence of statements gg puts into a method body, so a helper
  type is a local declaration and an `import` is lifted into the header;
- a failed call throws an unchecked `ToolError`, caught as
  `catch (ToolError failure)` and told apart by `failure.code()`;
- an optional argument is an overload, a bag of them is a builder and a list is
  a varargs, and each module is a class of `static` methods already imported.

The arm names `javac` as its [checker](/gg/languages/compilation/), so the
shared body states that a program is compiled before it runs, that one the
compiler refuses is not executed, and that a call the run withheld compiles and
fails when it runs. The library set TeaVM can translate is carried by a compile
failure rather than by the prompt.

## Healing dialect

The healing dialect reads a `#` line as prose and deletes it, because Java has
no `#` token at all, and treats a backtick as prose punctuation rather than
code. A leading `*` is not read as code, because it opens a Javadoc
continuation line and a model's bullet list alike. Its program fence tags are
`java` and `jav`. No predicate parses.

## Code modules

A code module is a class body rather than a statement sequence. Its
`public static` methods become the namespace bound at `lib.<key>`, and a module
offering none is refused by name. The names are read from the model's own source
by the export scan rather than out of the compiled bundle.

A program reaches a module by string, because a module is compiled separately
and there is no `import` for javac to check the program against:
`Lib.has(key, name)`, `Lib.text`, `Lib.number`, `Lib.flag` and `Lib.run`. A key
this session has no module for is a `ToolError` carrying `NOT_FOUND`. Binding
names are camelCase and ASCII-only, and hold to being valid Java identifiers.
The arm reads `.java` files and nothing else.
