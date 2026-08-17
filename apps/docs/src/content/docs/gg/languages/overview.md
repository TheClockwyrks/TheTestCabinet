---
title: "Program languages"
---

Under [responses as code](/gg/responses-as-code/overview/) a model answers a turn by
writing a program over its tools. gg supports more than one language for those
programs to determine whether a model's effectiveness depends on the language it
writes in. If a model performs noticeably better in Python than in JavaScript, a
harness that forces the model to write JavaScript handicaps it for no reason.

Supporting several languages also lets gg price the other things a language
choice buys. Some languages are more verbose than others, so two arms that score
identically can still differ in the tokens a model spends saying the same thing.
Some arms check a program before it runs and some do not, which prices the check
against the turn a runtime failure costs. Languages differ in how a failing call
is composed with the calls around it, which shows up as programs that give up
early.

The language is a parameter of the capability, resolved per agent. A study
holds the model, the test case and the rest of the capability set fixed and
varies this one value.

## The registered arms

Eleven languages are registered. Each has its own page, its own hand-written
SDK, its own segment of the shared prompt templates and its own healing dialect.

| Language | `language` | How a program runs |
| --- | --- | --- |
| [TypeScript](/gg/languages/typescript/) | `typescript` | The default. Type-checked by `tsc`, erased to JavaScript, evaluated as an ES module by the ECMAScript guest. |
| [JavaScript](/gg/languages/javascript/) | `javascript` | TypeScript's SDK and signatures with the compiler removed, evaluated as an ES module by the same guest. |
| [Python](/gg/languages/python/) | `python` | Evaluated as written by a guest carrying CPython 3.14, with no compiler on the turn path. |
| [Ruby](/gg/languages/ruby/) | `ruby` | Compiled to JavaScript on the host by an embedded Opal, evaluated by a guest carrying Opal's runtime. |
| [PureScript](/gg/languages/purescript/) | `purescript` | Type-checked and compiled to JavaScript by the run image's `purs`, bundled, evaluated as an ES module by the same guest. |
| [Java](/gg/languages/java/) | `java` | Compiled by `javac` and then TeaVM inside a warm JVM, into the wasm component that turn is evaluated by. |
| [Kotlin](/gg/languages/kotlin/) | `kotlin` | Compiled by the Kotlin compiler and then TeaVM inside the same warm JVM, into the wasm component that turn is evaluated by. |
| [Rust](/gg/languages/rust/) | `rust` | `rustc` compiles the program into the wasm component that turn is evaluated by. |
| [Swift](/gg/languages/swift/) | `swift` | `swiftc` compiles the reply verbatim into that turn's wasm component. |
| [C++](/gg/languages/cpp/) | `cpp` | `clang++` compiles the reply verbatim against a prelude precompiled once per machine. |
| [C#](/gg/languages/csharp/) | `csharp` | Roslyn compiles the reply to an IL assembly on the host, which a guest holding Mono's IL interpreter loads. |

## Rules every arm keeps

The rules required of every arm whatever language an agent writes in are on
[invariants](/gg/responses-as-code/invariants/): the program is the model's own
bytes, the SDK is reached by an import the model writes, documentation comes
from that language's own documentation generator, and a failure reaches the
model with the language's own words and locations. Every registered arm keeps
them, and two gates hold each arm to them on every test run.

The capability set is gg's. An arm chooses how a call is spelled, which module
it is filed under, whether it is a free function or a method, and how optional
arguments are passed. Which capabilities exist is fixed by gg. Every catalogue
entry names the gg operation it binds, and a gate holds each arm to gg's
operations table. See [registration](/gg/languages/registration/).

Every SDK is hand-written and idiomatic for its language. It reads as that
language's own code and bridges that idiom onto gg's WIT wire, so the model
sees only the SDK. The rules the surface keeps in every language are on
[agent surface](/gg/languages/agent-surface/).

An arm owns its catalogue, its prompt segment and its healing dialect. A
guest component is shared only between arms a declared table names, and a
declared pair must hand back identical bytes. TypeScript, JavaScript and
PureScript all evaluate in the [ECMAScript guest](/gg/languages/ecmascript-guest/),
and TypeScript and JavaScript declare it between them as the pair holding
everything but the compiler equal. Ruby compiles to JavaScript on the host as
well and still has its own guest, because that component carries Opal's runtime.
Rust, Swift, C++, Java and Kotlin have no guest to share, each program being its
own component.

Java and Kotlin compile to TeaVM's WebAssembly target. TeaVM emits per program
only the classlib that program's own call graph reached, so there is no runtime
two programs could share and the component is built per turn.

Both arms reach gg through one imported interface, `test-cabinet:gg/wire`,
rather than the fifteen typed ones. Every other guest binds the typed interfaces
directly, which requires a binding generator for its language; the JVM has none,
so the ABI its SDK implements is one string, two byte lists and a scalar. `call` takes an
operation id and the encoded arguments, runs the operation, and answers the byte
length of its encoded result; `take` hands those bytes over. Two steps rather
than one because a JVM guest may allocate only while the host holds no address
into its memory, so it sizes its buffer between them and carries an answer of
any length.

The host answers each id by calling the same typed host function the typed
interfaces are implemented by, so the capability gate, the recorded call and the
`tool-error` are one implementation for every arm. Each id's arm reads the
arguments its WIT function declares, in the order it declares them, so the WIT is
the one statement both halves of the crossing are built from. What travels inside
the byte lists is gg's own tagged encoding, and the model-facing surface stays
typed and namespaced.

`test-cabinet:gg/math` is the second interface those two arms alone import, and
the reason is the compiler rather than gg: `java.lang.Math`'s transcendental
methods are `native` in TeaVM's classlib and emitted as imports of a module no
component can resolve. gg declares them and answers them from the host, and a
transformer in each arm's SDK jar rewrites the module name the classlib asks for
to this interface's id.

TeaVM emits a core module with no component metadata in it, so gg stamps the
`component-type` section for the `jvm-sandbox` world from its own WIT and
encodes the component in process with a pinned `wasi_snapshot_preview1` reactor
adapter. A compiled program's Java heap is fixed at one size, because TeaVM
gives a program its minimum heap rather than its maximum.

A failure on that route reaches the model as the runtime's own words on standard
error: the exception's header, then frames naming the model's own file and lines.
wasmtime's DWARF symbolication of a TeaVM artifact names other files, so the
JVM arms report their trap frames without locations. TeaVM emits a class's name
only where it sees that name being asked for, so gg's generated entry class names
the classes a program fails with, reachable and never executed, to keep the
header from arriving blank. The two arms' entry classes differ by one line, the
call to the model's own entry point.

Guest components and signature catalogues are build outputs. Each arm's
artifacts are produced by the build from the sources in the checkout, so a
source edited without a rebuild is not a state the tree can reach. See
[compilation](/gg/languages/compilation/).

What an arm pays to compile is recorded, per turn and per run, because the
sandbox's own clock starts once a program is prepared and would otherwise absorb
it. See [compilation](/gg/languages/compilation/).

## Configuring and recording the language

The language is the `language` param of the `responses-as-code` capability,
taking `typescript` when absent and resolved per agent. One run may therefore
drive its root in one language and a reviewer subagent in another. A value that
is not a registered id refuses the launch, naming the ids gg registers, so a
typo never runs an arm the study did not ask for.

The answer is recorded as a scalar in two places, so a
[query](/gg/analysis/query-language/) slices arms on it with no new vocabulary:

- `summary.programLanguage`, the language the run's root agent wrote in,
  recorded off the run's configuration.
- `programLanguage` on each `agent_surface` event, the language that instance
  wrote in.

Both are absent for a tool-calling agent, which writes no programs, as against
one whose language is unknown.
