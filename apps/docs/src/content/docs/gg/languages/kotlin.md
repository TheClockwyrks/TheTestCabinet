---
title: "Kotlin"
---

## The arm

`language: "kotlin"` selects this arm on an agent's responses-as-code
capability. A reply is a whole Kotlin file: the `import` lines the model wrote,
and a `fun main()` it declared. The Kotlin compiler (`K2JVMCompiler`, embedded
in a JVM gg keeps warm) compiles that file to bytecode, TeaVM's
`WEBASSEMBLY_WASI` backend translates the bytecode to a `wasm32` core module,
and gg encodes that module as the WebAssembly component the turn runs. The JDK,
the TeaVM jars, the TeaVM settings, the canonical ABI, the wire encoding and the
generated entry class are the shared [JVM road](/gg/languages/java/).

gg writes no prologue, no epilogue, no entry point and no import into the file
the compiler reads, so every diagnostic and every stack frame is already in the
model's own coordinates.

## Preparation

- The model's reply is written to `Program.kt` byte for byte and compiled as it
  stands. `GgEntry.java` is the one file gg writes beside it, and an agent's
  loaded code modules reach that compile as classpath entries rather than as
  sources.
- The model declares `fun main()`, with no parameters. That form compiles to a
  `main()` on the file facade `ProgramKt`, which is the method gg's generated
  entry class calls; `fun main(args: Array<String>)` compiles to a different
  method and is refused with the convention quoted back.
- Anything else the model declares — a class, an object, a sealed interface, an
  enum class, a typealias — is an ordinary top-level declaration beside `main`.

## Toolchain

The Kotlin jars are found at `TCAB_GG_KOTLIN`, then `/opt/gg/toolchains/kotlin`,
then `~/.local/share/gg-kotlin`. The JDK and TeaVM are found on the JVM road
(`TCAB_GG_JAVA`, `TCAB_GG_TEAVM`, `/opt/gg/toolchains/java`,
`~/.local/share/gg-java`). `checkers/kotlin.toolchain.json` pins the Kotlin
release and the driver protocol. A driver answering another protocol, or naming
a release other than the pinned one, is refused at the handshake. A release that
cannot be read at all is not a mismatch.

The compiler is driven embedded rather than as the `kotlinc` shell script,
because the first build in a JVM costs seconds and every build after it costs a
fraction of one. Preparations are served from a pool of four JVM processes, each
lent to one preparation at a time and retired after 64 builds. Warm-up starts a
JVM and places the driver and the SDK jar.

A model's source is read against the Kotlin standard library and gg's SDK. The
driver's own compiler and TeaVM jars are a separate classpath, so a program
cannot import the compiler's internals or `kotlinx.coroutines`.

A build request names the directory the Kotlin compiler writes its classes into
and the classpath entries to add to that pair, which is how a code module's
classes reach the program compiled against them. An empty target file selects
the Kotlin compiler alone, which is what a module is compiled with: a module is
checked at the read that binds it, for the author's own located diagnostic, and
compiled again under its binding key for each program that uses it.

`packages/gg-sandbox-kotlin/libraries.txt` declares in groups what a program may
import, which is the Kotlin standard library as TeaVM is able to translate it.
The catalogue's `libraries` section is reflected from that file, and the arm's
tests hold the claim to the artifact: every declared package goes through the
real Kotlin compiler and the real TeaVM, and a real declaration in each must
compile and run.

## Build outputs

Nothing for this arm is committed. `crates/gg-sandbox-artifacts/kotlin` compiles
`packages/gg-sandbox-kotlin/src` and `packages/gg-sandbox-jvm` into
`kotlin.sdk.jar`, which the gg binary embeds and places beside the driver. The
jar must carry `META-INF/<module>.kotlin_module`, or a program's calls fail to
resolve. `crates/gg/build.rs` reflects the signature catalogue into the build's
`OUT_DIR` as `kotlin.signatures.json`, and the arm asserts the parsed catalogue
names this language, so the SDK and its description come out of one build.

This arm has no guest artifact and cannot have one. TeaVM emits per program only
the classlib and standard-library methods that program's own call graph reached,
so there is no runtime two programs could share. The component is built per
turn.

## The SDK

The SDK is declared in `gg.*` packages as top-level functions, one package per
capability module plus `gg.core`. A program reaches a call either by writing the
fully-qualified name (`gg.files.readFile("src/a.kt", offset = 2, limit = 5)`) or
by writing the module's own import line, `import gg.files.*`, which every
module's catalogue entry states. A type is written under the module that
produces it (`gg.files.FileRead`, `gg.tasks.TaskStatus`).

`gg.log` writes one line to the run's log, which reaches the operator and never
the model. It is outside the catalogue, because the catalogue describes the
capability modules. Standard output reaches nobody at all.

The Kotlin half of the bridge is `internal`, which is module visibility, and a
program is its own module. The crossing under it is the Java `gg.internal`
package both JVM arms compile, whose classes are public because Java has no
module visibility to give them. What keeps them out of a program's way is that
nothing describes them: no catalogue entry covers `gg.internal` and no prompt
names it, which is the position every arm's SDK is in. Every function is bound on
every turn: a call the agent was not granted compiles and fails when it runs,
which is the rule the [agent surface](/gg/languages/agent-surface/) states for
every arm.

The surface is idiomatic Kotlin:

- An optional argument is a default argument passed by name, so every catalogue
  entry carries one signature and there are no overloads.
- A value the wire may leave out is nullable.
- A fixed choice is an `enum class`, and one a program hands back to the host
  carries its wire spelling as a `wireName` property. A choice of shapes is a
  `sealed` type, so `gg.delegation.Brief` is `Brief.Prompt` or `Brief.Issue` and
  neither "both" nor "neither" compiles.
- A three-way patch field is a sealed type: `gg.core.Patch.Replace(…)` and
  `gg.core.Patch.Clear`, with a left-out argument meaning "leave it alone".
- A span of turns is an `IntRange`.
- A result is a `data class`, and a read is a sealed type narrowed by `when`.
- A failure is a thrown `gg.core.ApiError` with an enum `code`, caught with
  `catch` or `runCatching`. Its message is ``​`operation` failed (code): what went
  wrong``, so an uncaught one names all three; `detail` is gg's sentence alone.

## The catalogue

The catalogue is reflected by `tools/GgSignatures.kt`, which parses each SDK
file into the same `KtFile` the compiler compiles and reads KDoc with the
compiler's own KDoc parser, so the release that describes the surface is the
release that compiles a program against it. `@ggmodule` on a module file carries
module identity, and `tools/GgCatalogue.kt` fixes the module set and its order.
An `@throws` tag names an error type a function declares, and the catalogue
carries those types as that function's `throws` list.
Each module's entry states `import <package>.*` as the line a program writes,
composed from the module's own path, which is the one thing the reflector
composes.

`build.sh` compiles the SDK under `-Xexplicit-api=strict -Werror`, which is a
second reading of the same sources beside the reflector's, and the reflector
refuses to emit a catalogue containing a blank, an identity the SDK does not
declare, a `@param` naming an argument a function does not take, or a public
function of a module the identity table does not name. A signature states
`: Unit` out loud, because that a call returns nothing tells a model the rest of
its program still runs, and a sealed type's declaration carries its arms inline,
because Kotlin has no clause that names them.

## Checker and failures

The checker is `kotlinc` rather than TeaVM, which translates what the Kotlin
compiler accepted and judges nothing else. Naming a checker is what has this
arm's compile time recorded on every turn, the failing path included.

| What happened | How it is reported |
| --- | --- |
| the Kotlin compiler's `SYNTAX` diagnostic | a syntax failure |
| any other Kotlin error in the model's own file | a compile failure |
| TeaVM naming a class or method its classlib lacks | a compile failure |
| a `package` declaration or a `@file:JvmName` | a shape refusal naming the line that moved the facade |
| a program declaring `GgEntry` itself | a diagnostic against the model's own file naming the reserved class |
| javac refusing gg's generated entry class | a shape refusal quoting the `fun main()` convention |
| a compiler that could not run, a timeout, or a failed handshake | a toolchain failure |

The compile asks for `-Xrender-internal-diagnostic-names`, which is what makes
the compiler's own names for its diagnostics readable. Telling a parse failure
from a rejection otherwise means matching on English.

A diagnostic in a library file is the model's problem on this arm, because a
Kotlin program reaches TeaVM's classlib through a standard library written in
Kotlin. It is reported against the model's own file with the library's file and
line named inside it, rather than as a coordinate the model could open.
Diagnostics are deduplicated and capped at eight with the rest counted. The
bands are described under [compilation](/gg/languages/compilation/).

A runtime failure is the program's own. gg catches nothing: the program dies the
way TeaVM kills it, and what the model reads is the exception's header and
TeaVM's stack trace over the model's own file, off the guest's standard error.
The DWARF wasmtime symbolicates this artifact from is misattributed, so this arm
declares its wasm frames unlocated and gg strikes those locations out.

Integer division by zero is a wasm trap rather than an `ArithmeticException`,
because TeaVM lowers `/` to `i32.div_s`, and a `catch (failure:
ArithmeticException)` around it is never reached. A divisor the compiler can fold
is that fault one stage earlier and is reported as the program's: TeaVM folds a
constant expression by evaluating it, so `7 / 0` throws inside the build and
reaches the model as a compile error carrying the JVM's own
`java.lang.ArithmeticException: / by zero`, against the model's file with no
line. Every other way a build can throw is a toolchain failure.

`kotlin.io`'s `use` reaches TeaVM's own
reflection classes through `Throwable.addSuppressed` and is refused at compile
time, so a program closes a resource with `try`/`finally` instead. A `Thread` a
program starts is refused by the sandbox.

## Code modules

A code module is an ordinary Kotlin file, and `kt` is the only extension this arm
compiles. Its namespace is the file's public top-level functions, and a module
offering none is refused by name. The names, each declaration as its author wrote
it, and the type names that declaration writes in return and in parameter
position are read from the author's own source by the export scan rather than out
of a compiled artifact.

The wrapper costs no line at all: gg's `package` declaration shares the author's
own first line, so a diagnostic is the author's own coordinate with nothing
subtracted from it. A `package` the author wrote is refused at that line.

Each module is compiled on its own, into `package lib.<key>`, against the Kotlin
standard library and gg's SDK jar and nothing else. The directory its classes
land in goes on the `-classpath` of the program's own compile, which is how the
SDK jar reaches a program too: a classpath entry is packaging and puts no name in
a program's scope. So a program reaches an export the two ways it reaches gg's
own surface. It writes the fully-qualified `lib.csvTools.slugify(…)`, or the
module's own import line, `import lib.csvTools.*`, which the module's
documentation view states. A key or an export the session does not have is a
diagnostic on the turn that wrote it, and so is a program that writes neither the
qualified name nor the import line.

Binding names are camelCase and ASCII-only, and hold to being valid Kotlin
identifiers: the key is a package segment the compiler resolves, so a leading
digit and a hard keyword are each prefixed with an underscore.

A module is compiled before the program that uses it, so a module that does not
compile is a refusal naming the key it is bound at. Its file is named for that
key, so a TeaVM diagnostic about a module during a program's own build names the
key in the file position.

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`kotlin`, and `code-nothing-shown.hbs` through a clause naming `println`.
Neither names a function or a signature: every spelling they quote is resolved
from this arm's catalogue as the template renders. The segment states that the
reply is compiled verbatim as one Kotlin file with a `fun main()`, and that
everything else the model declares goes beside it at the top level.

Each module is a package of top-level functions, and each entry of the module
list beside the segment carries that module's own `import` line.

The arm names `kotlinc` as its [checker](/gg/languages/compilation/), so the
shared body states that a program is compiled before it runs, that one the
compiler refuses is not executed, and that a call the run withheld compiles and
fails when it runs. The library set is carried by a compile failure rather than
by the prompt.

## Healing dialect

The fence tags are `kotlin`, `kt` and `kts`; the script extension stays on the
list because a model that reached for it has still written Kotlin. A backtick is
code punctuation
here, because Kotlin has backquoted identifiers, so a line carrying one is never
deleted as prose. A `#` line is prose and is deleted, because Kotlin has no `#`
token at all and one left in a program is a syntax error. A `;` says almost
nothing, since Kotlin statements end at the newline, so the reading of "this
line is code" rests on the keyword clause, the call clause, a chain-continuation
clause and a line carrying an assignment. The dialect's lexer declines when a
string, comment, character literal or backquoted name is unterminated.
