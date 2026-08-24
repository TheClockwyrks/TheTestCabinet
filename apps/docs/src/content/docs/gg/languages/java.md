---
title: "Java"
---

The `java` arm compiles a model's reply to bytecode with `javac`, translates
that bytecode to a `wasm32` core module with TeaVM's `WEBASSEMBLY_WASI` backend,
and encodes that module as a WebAssembly component. Both compilers run inside a
warm JVM that gg keeps between preparations. An agent selects the arm with the
`responses-as-code` capability's `language` parameter.

## Preparation

A program is a whole Java compilation unit. The reply is written to
`Program.java` in the preparation's own workspace exactly as the model sent it,
so the file javac reads and the file the model sent are the same bytes and every
diagnostic and every stack frame is already in the model's own coordinates.

gg writes one more file beside it. `GgEntry.java` carries the component's two
exports and calls `Program.main(new String[0])`, and it declares no `main` of its
own. It names something the model declared, so a diagnostic about it is a refusal
the model reads rather than a toolchain failure.

This arm has no guest component: `guest_component()` answers `None`, the
compiled bytes ride on the prepared program, and the engine instantiates a fresh
component every turn. The prepared program carries no source. TeaVM emits per
program only the classlib methods that program's call graph reached, so there is
no shared runtime a baked guest could hold.

### The class a program declares

A program declares `Program` with a `public static void main(String[] args)`,
which `main` may declare `throws` on. Java names a compilation unit by its own
public type and a caller names the type it calls, so the name is what lets gg's
second compilation unit reach the model's entry point.

Both ways of getting it wrong are javac's own located diagnostics. A
`public class Something` in `Program.java` is
`class Something is public, should be declared in a file named Something.java`,
at the model's own line. A class named anything else, or one with no `main`,
leaves `GgEntry.java` unable to resolve `Program.main`, which gg reports as a
refusal quoting the shape a program takes.

Anything else the model declares goes beside `Program` in the same file, without
`public` on it, which is Java's own one-public-type-per-file rule.

## Compilation

The warm JVMs are a pool of four processes, each lent to one preparation at a
time. A build writes into the calling preparation's own workspace, the daemon
stands on ground of its own, and each request builds through a fresh build
strategy. A JVM is retired after 64 builds, because every build makes a fresh
class loader over the toolchain's jars. A build may take 180 seconds and a JVM
start 120 seconds; past either the failure is reported as a toolchain failure,
and a JVM that did not answer its build is retired. Warming starts one JVM and
places the driver and the SDK jar, so the first code turn pays for neither.

Three TeaVM settings are required, and each fails silently when it is missing.
`setStrict(true)`, without which TeaVM omits the null and bounds checks that make
a `NullPointerException` an exception at all. `setClassesToPreserve`, without
which `GgEntry` is dead-stripped and the encode produces a component with no
exports. An equal minimum and maximum heap, because TeaVM gives a program its
minimum rather than the difference. The arm names `javac` as its checker, so
compile time is recorded on the failing path as well as the succeeding one.

One transformer is required with them. `java.lang.Math`'s transcendental methods
are `native` in TeaVM's classlib and emitted as core imports of a module named
`teavmMath`, which no WebAssembly component can resolve. `gg.internal.MathImports`
rewrites that module to `test-cabinet:gg/math`, which gg's own host answers.

A build request names the directory javac writes its classes into and the
classpath entries to add to the toolchain's own, which is how a code module's
classes reach the program compiled against them. An empty target file selects
`javac` alone, which is what a module is compiled with: a module is checked at
the read that binds it, for the author's own located diagnostic, and compiled
again under its binding key for each program that uses it.

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

The build produces three things for this arm, and commits none:

- `java.sdk.jar`, the SDK compiled, cut by `crates/gg-sandbox-artifacts/java`
  running `packages/gg-sandbox-java/build.sh` and embedded in the gg binary. It
  also carries `packages/gg-sandbox-jvm/`, which both JVM arms compile: the
  canonical ABI, the wire encoding, the `teavmMath` transformer, and one vendored
  TeaVM runtime class kept under its own licence and changed so that an uncaught
  exception prints what was thrown as well as where. The jar goes first on TeaVM's
  program classpath, which is what makes that copy the one the compiler
  translates.
- `java.adapter.wasm`, the pinned `wasi_snapshot_preview1` reactor adapter every
  JVM component is encoded with.
- `java.signatures.json`, the signature catalogue, reflected by
  `packages/gg-sandbox-java/signatures.sh` and embedded from the build's own
  `OUT_DIR`. gg refuses a catalogue generated for another language.

## The SDK and the signature catalogue

The SDK is `packages/gg-sandbox-java/src/gg/`, compiled into the jar both
compilers put on their classpath, so a program type-checks against the same
bytes TeaVM translates. A jar on the classpath is packaging and puts no name in a
program's scope: a program reaches a name in full, `gg.files.Files.readFile(…)`,
or under the `import` line the catalogue states for that module. Types are nested
in the module that produces them, `Files.FileRead` and `Memories.MemoryHit`, so
the same short name may belong to two modules.

The SDK reaches gg through one imported function, `test-cabinet:gg/wire`'s
`call`, below a typed and namespaced surface. `gg.internal` carries that
crossing and nothing model-facing; see
[the languages overview](/gg/languages/overview/) for why the JVM arms have one
door where every other guest has fifteen.

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
- A failure is an unchecked `ApiError` carrying `code()` and `operation()`, so a
  composed program needs no `try` around every line. Its message is
  ``​`operation` failed (code): what went wrong``, which is what an uncaught one
  prints; `detail()` is gg's sentence without the first two.
- `Gg.log` is the one channel a program has to whoever is watching the run. It
  is outside the catalogue, on the same terms every other arm's `console.log`
  is.

Every function is bound in every program, and a call the agent was not granted is
refused by the host. See [static SDKs](/gg/languages/static-sdks/) for that
surface's rules.

The catalogue is reflected by `javadoc` and a doclet of gg's own, so a signature
is javac's reading of the declaration and every word of prose comes off the
declaration it describes. An `@ggop` block tag carries operation identity,
`tools/GgCatalogue.java` holds the thirteen module identities and the order they
are presented in, and the doclet refuses to emit a catalogue with a blank in it.
An `@throws` tag names an error type a function declares, and the catalogue
carries those types as that function's `throws` list.
Each module states the line a program writes to reach it, composed from the
module's own path: `import gg.files.Files;` for a module that is a class, and
`import gg.*;` for `core`, whose path is the package the exception and the shared
types live in. `build.sh`
compiles the model-facing packages a second time under
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
compile. `java.nio.file` is the one that matters: `java.nio.file.Files.readString`
resolves against the classlib's jar and TeaVM then refuses inside its own
`TFiles.java`, naming the method its wasm backend has no implementation of. That
refusal is the model's own compile error rather than a toolchain failure, because
a TeaVM diagnostic is always about something the program's call graph reached.
The filesystem a program reaches is gg's own `fs` module.

## Failures

A program owns its failures and gg catches none of them. `GgEntry` has no `try`
and no `catch`, so a program that throws dies the way TeaVM kills it —
`printHeader(); printStack(); abort();` — and what the model reads is the guest's
own standard error: the exception's header, then the model's own file and lines,
`at Program.main(Program.java:8)`. There is no source map on this road and no
offset anywhere in the arm.

The vendored `org.teavm.runtime.ExceptionHandling` is what prints the header;
upstream's uncaught path prints the frames alone. The header names the class that
was thrown and its message, whichever class it is: `java.util.EmptyStackException`
and a program's own `class OutOfCoffee extends RuntimeException` are named exactly
as `java.lang.NullPointerException` is. TeaVM emits a class's name string only
where its dependency analysis sees that name being asked for, so gg's SDK jar
carries a TeaVM plugin, `gg.internal.ThrowableNames`, that propagates every
reachable `Throwable` into that analysis.

wasmtime symbolicates this artifact's DWARF into gg's own SDK internals for
frames that are really the model's, so the arm answers `wasm_frames_are_located`
with `false` and the model-facing failure keeps the function names and drops
those locations.

Compile diagnostics from either compiler are deduplicated and capped at eight.
Only diagnostics about the model's own file are banded: any javac code marking
text the parser could not read makes the whole verdict a syntax error, and
everything else is a compile error. The band is decided over the whole set rather
than the shown eight. A TeaVM diagnostic about any other file is a compile error
too, since TeaVM only refuses what the program reached. A javac diagnostic about
a file that is neither the model's nor `GgEntry.java` is reported to the
operator. The shared rules are on
[compilation](/gg/languages/compilation/).

Integer division by zero is the engine's own trap rather than an
`ArithmeticException`: TeaVM lowers `/` to `i32.div_s` and wasm traps on a zero
divisor, so what the model reads is `wasm trap: integer divide by zero` and the
name of the function it happened in. A `catch (ArithmeticException)` around it is
never reached, because the trap stops the program where it stands.

A divisor the compiler can fold is that fault one stage earlier and is reported
as the program's. TeaVM folds a constant expression by evaluating it, so `7 / 0`
throws inside the build; what the model reads is a compile error carrying the
JVM's own `java.lang.ArithmeticException: / by zero`, against the model's file
with no line, since the fold discards the expression's location. Every other way
a build can throw is a toolchain failure.

A `Thread` a program starts is refused by the sandbox.

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`java`, and `code-nothing-shown.hbs` through a clause naming
`System.out.println`. The segment states that the reply is compiled verbatim as
one compilation unit declaring `public final class Program` with a `main` in it,
and that anything else it declares goes beside that class without `public`.

Each module is a class of `static` methods, and each entry of the module list
beside the segment carries that module's own `import` line.

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

A code module is a class body rather than a whole compilation unit. Its
`public static` methods become the namespace, and a module offering none is
refused by name. The names, each declaration as its author wrote it, and the type
names that declaration writes in return and in parameter position are read from
the author's own source by the export scan rather than out of a compiled
artifact.

The wrapper costs no line at all: the author's `import` lines are lifted to the
front of the file, blanked where they stood, and the `package lib;` and the class
header share the author's own first line, so a diagnostic is the author's own
coordinate with nothing subtracted from it.

Each module is compiled on its own, into package `lib` under a class named by its
binding key, against the SDK jar and the toolchain and nothing else. The
directory its classes land in goes on the `-classpath` of the program's own
compile, which is how the SDK jar reaches a program too: a classpath entry is
packaging and puts no name in a program's scope. A program reaches an export in
full, `lib.csvTools.parse(…)`, or under the line the module's documentation view
states, `import lib.csvTools;`. A key or an export the session does not have is a
diagnostic on the turn that wrote it, and so is a program that writes neither the
full name nor the import line.

Binding names are camelCase and ASCII-only, and hold to being valid Java
identifiers: the key is the class's own name and a path segment javac resolves,
so a leading digit and a reserved word are each prefixed with an underscore. The
arm reads `.java` files and nothing else.

A module is compiled before the program that uses it, so a module that does not
compile is a refusal naming the key it is bound at. Its file is named for that
key, so a TeaVM diagnostic about a module during a program's own build names the
key in the file position.

A module body may not write the name of the class gg wraps it in, and the read
refuses one that does at the author's own line. That name is `Module` while the
read checks it and the binding key in a program, and a constructor is the one
declaration Java has whose meaning turns on it.
