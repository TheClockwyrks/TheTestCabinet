---
title: "Kotlin"
---

## The arm

`language: "kotlin"` selects this arm on an agent's responses-as-code
capability. A reply is a Kotlin script: statements and declarations side by side
at the top level, in whatever order the model wrote them. The Kotlin compiler
(`K2JVMCompiler`, embedded in a JVM gg keeps warm) compiles that script to
bytecode, TeaVM translates the bytecode to JavaScript, and the shared ECMAScript
guest evaluates it. The JDK, the TeaVM jars, the TeaVM settings and the reading
of TeaVM's source map are the shared JVM road.

The script shape is required. A function body would put every declaration the
model wrote in a local position, where Kotlin refuses `object`, `interface`,
`enum class`, `typealias` and `private fun`. In a script all of them compile,
and a top-level function can read a top-level `val`.

## Preparation

- Every `import` is hoisted into the file's header and blanked where it stood,
  so no later line moves. The hoist runs over a lexer that reads string
  templates, nested block comments and backquoted identifiers, so an `import`
  inside one of them stays where it is. A reply with no `import` is compiled
  byte for byte with a shift of zero, and otherwise a diagnostic located in the
  model's file is moved back by the number of header lines gg added.
- A `package` declaration is refused by name, because a program is one anonymous
  compilation unit.
- A program is written as `Program.kts` and reported as `program.kts`.
- A `main` the model declares is an ordinary function that nothing calls. The
  top-level statements are what run.

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
JVM and places the driver and the SDK jar. The script shape needs four scripting
jars found by unversioned name under a `kotlin-home/lib` directory, the
`-Xallow-any-scripts-in-source-roots` flag, and three `idea.*` system
properties, all pinned.

A model's source is read against the Kotlin standard library, the script runtime
its script class extends and gg's SDK. A code module gets TeaVM's `@JSExport`
jar as well. The driver's own compiler and TeaVM jars are a separate classpath,
so a program cannot import the compiler's internals or `kotlinx.coroutines`.

`packages/gg-sandbox-kotlin/libraries.txt` declares in groups what a program may
import, which is the Kotlin standard library as TeaVM is able to translate it.
The catalogue's `libraries` section is reflected from that file, and the arm's
tests hold the claim to the artifact: every declared package goes through the
real Kotlin compiler and the real TeaVM, and a real declaration in each must
compile and run.

## Build outputs

Nothing for this arm is committed. `crates/gg-sandbox-artifacts/kotlin` compiles
`packages/gg-sandbox-kotlin/src` into `kotlin.sdk.jar`, which the gg binary
embeds and places beside the driver. The jar must carry
`META-INF/<module>.kotlin_module`, or a program's calls fail to resolve.
`crates/gg/build.rs` reflects the signature catalogue into the build's `OUT_DIR`
as `kotlin.signatures.json`, and the arm asserts the parsed catalogue names this
language, so the SDK and its description come out of one build.

This arm has no guest artifact of its own. It evaluates on the TypeScript arm's
component, which the seam records as a declared share.

## The SDK

The SDK is declared in `gg.*` packages as top-level functions, one package per
capability module plus `gg.core`. gg writes no import for it, and a program
calls the fully-qualified name: `gg.files.readFile("src/a.kt", offset = 2,
limit = 5)`, `gg.shell.run("npm test", timeoutSecs = 30)`. A type is written
under the module that produces it (`gg.files.FileRead`, `gg.tasks.TaskStatus`).
Bridge declarations are `internal`, which is module visibility, and a program is
its own module, so a program cannot name the crossing. Every function is bound
on every turn: a call the agent was not granted compiles and fails when it runs,
which is the rule the
[agent surface](/gg/languages/agent-surface/) states for every arm.

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
- A failure is a thrown `gg.core.ToolError` with an enum `code`, caught with
  `catch` or `runCatching`.
- The code a skill or memory carried is reached by string through `gg.core.lib`:
  `text`, `number`, `flag`, `run` and `has`.

## The catalogue

The catalogue is reflected by `tools/GgSignatures.kt`, which parses each SDK
file into the same `KtFile` the compiler compiles and reads KDoc with the
compiler's own KDoc parser, so the release that describes the surface is the
release that compiles a program against it. `@ggmodule` on a module file carries
module identity, and `tools/GgCatalogue.kt` fixes the module set and its order.

`build.sh` compiles the SDK under `-Xexplicit-api=strict -Werror`, which is a
second reading of the same sources beside the reflector's, and the reflector
refuses to emit a catalogue containing a blank, an identity the SDK does not
declare, a `@param` naming an argument a function does not take, or a public
function of a module the identity table does not name. A
signature states `: Unit` out loud, because that a call returns nothing tells a
model the rest of its program still runs, and a sealed type's declaration
carries its arms inline, because Kotlin has no clause that names them.

## Checker and failures

The checker is `kotlinc` rather than TeaVM, which translates what the Kotlin
compiler accepted and judges nothing else. Naming a checker is what has this
arm's compile time recorded on every turn, the failing path included.

| What happened | How it is reported |
| --- | --- |
| the Kotlin compiler's `SYNTAX` diagnostic | a syntax failure |
| any other Kotlin error | a compile failure |
| TeaVM naming a class or method its classlib lacks | a compile failure |
| every error naming the file gg generated | a toolchain failure |
| a compiler that could not run, a timeout, or a failed handshake | a toolchain failure |

The compile asks for `-Xrender-internal-diagnostic-names`, which is what makes
the compiler's own names for its diagnostics readable. Telling a parse failure
from a rejection otherwise means matching on English.

A diagnostic in a library file is the model's problem on this arm, because a
Kotlin program reaches TeaVM's classlib through a standard library written in
Kotlin. It is reported against the model's own file with the library's file and
line named inside it, rather than as a coordinate the model could open.
Diagnostics are deduplicated and capped at eight with the rest counted. A
toolchain failure reaches the model as a notice that its program was not run,
and the diagnostic goes to the operator. The bands are described under
[compilation](/gg/languages/compilation/).

Integer division by zero answers `0` rather than throwing, because the
arithmetic underneath is JavaScript's, and a `Thread` a program starts is
refused by the sandbox.

## Code modules

A code module is an ordinary Kotlin file rather than a script, and `kt` is the
only extension this arm compiles. Its namespace is the file's public top-level
functions, each given `@JSExport` inline so no line moves. A module offering
none is refused by name. The file's JVM class name and the name TeaVM exports it
under must differ, or the exported namespace resolves to `undefined`. A module
key is camelCase and ASCII-only, since a program names it as a string.

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`kotlin`, and `code-nothing-shown.hbs` through a clause naming `println`.
Neither names a function or a signature: every spelling they quote is resolved
from this arm's catalogue as the template renders. The segment states:

- the reply is compiled as a script, so statements and declarations sit side by
  side at the top level and an `import` written anywhere is lifted;
- a failed call is a `gg.core.ToolError`, and Kotlin has no checked exceptions,
  so one may escape or be caught;
- an optional argument is a named default, and every gg name is written fully
  qualified.

The arm names `kotlinc` as its [checker](/gg/languages/compilation/), so the
shared body states that a program is compiled before it runs, that one the
compiler refuses is not executed, and that a call the run withheld compiles and
fails when it runs. The library set is carried by a compile failure rather than
by the prompt.

## Healing dialect

The fence tags are `kotlin`, `kt` and `kts`. A backtick is code punctuation
here, because Kotlin has backquoted identifiers, so a line carrying one is never
deleted as prose. A `#` line is prose and is deleted, because Kotlin has no `#`
token at all and one left in a program is a syntax error. A `;` says almost
nothing, since Kotlin statements end at the newline, so the reading of "this
line is code" rests on the keyword clause, the call clause, a chain-continuation
clause and a line carrying an assignment. The dialect's lexer declines when a
string, comment, character literal or backquoted name is unterminated.
