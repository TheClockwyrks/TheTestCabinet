---
title: "Swift"
---

## Preparation

The arm is selected per agent by the responses-as-code capability's `language`
parameter, with the value `"swift"`. A model's reply is compiled verbatim as
`main.swift`. Nothing is prepended, appended or re-indented, so a diagnostic at
line 7 is line 7 of what the model wrote and this arm subtracts no offset
anywhere. Swift admits `extension`, `protocol` and `import` only outside a
function body, and a top-level file is the only Swift context carrying
declarations and bare statements together, so the file the compiler reads is the
reply itself. gg's shell is a second file of the same Swift module: Swift lowers
a top-level file's statements into the target's C entry point, and the shell
names that symbol and calls it from the component's `run` export.

One `swiftc` invocation compiles the model's file, the shell, the code modules
in scope, the prebuilt SDK module and the library archive at `-Osize -g`. gg
then encodes the linked core module in process, with the pinned
`wasi_snapshot_preview1` reactor adapter that turns the preview1 module the
Swift SDK emits into a preview 2 component. That component is what the turn is
evaluated by, so this arm declares no guest component and the bytes ride on the
prepared program. A compile has 120 seconds before it is killed.

Swift's standard library is statically linked, so the artifact is around 7 MB
and instantiating it costs more per turn than producing it, reported as the
turn's compile wait. The isolation rules every per-turn compile obeys are on the
[compilation](/gg/languages/compilation/) page.

## Toolchain and build artifacts

The toolchain is a tree rather than a binary on `PATH`: a compiler, the Swift
SDK for WebAssembly and the shared libraries its linker was built against must
agree. gg looks in `TCAB_GG_SWIFT_HOME` when an operator sets it, then
`/opt/gg/toolchains/swift` when `toolchain/usr/bin/swiftc` is a file there, then
`~/.local/share/tcab/gg-swift`. The tree is around 835 MB even pruned, so it
lives in the gg toolchain image rather than inside the `tcab` binary.

`crates/gg-sandbox-artifacts/swift` runs `packages/gg-sandbox-swift/build.sh`
and publishes four files, none of them committed. The arm reaches them through
`GG_ARTIFACTS_SWIFT` and embeds them in the gg binary.

| Artifact | What it carries |
| --- | --- |
| `swift.guest.tar.gz` | The bridging header, the C bindings generated from `crates/gg/wit` compiled to a wasm object, the component-type object, the shell's source, and this arm's SDK prebuilt as `gg.swiftmodule` plus `gg.o` |
| `swift.libraries.tar.gz` | The curated library set as one static archive, plus the `.swiftmodule` files a program's `import` resolves against |
| `swift.adapter.wasm` | The pinned `wasi_snapshot_preview1` reactor adapter |
| `swift.toolchain.json` | What built the above, and what is in it |

The SDK and the library set are prebuilt so that no turn re-typechecks them.
Warm-up unpacks both archives into shared content-keyed directories, placed by
rename and sealed read-only.

## SDK and signature catalogue

The SDK is compiled ahead of time into a module named `gg`, and the shell writes
`@_exported import gg`. A re-export is module-scoped, so the whole surface is in
scope in the model's own file with no import line. A separate module is also
what lets a program shadow a name gg bound rather than collide with it.

Twelve capability modules are caseless `enum`s, so `files.readFile("a.swift")`
is a call on a namespace and nothing is constructed first. A thirteenth, `core`,
declares no function and holds the types other modules' signatures name. Each
module owns the types it produces, such as `files.FileRead`. A program declaring
its own `files` wins, and the fully qualified `gg.files.readFile` still reaches
gg's. That fully qualified form is the name the catalogue publishes.

The library set is the Swift standard library, the modules the Swift SDK for
WebAssembly ships, and three vendored packages compiled into one static archive,
declared by `packages/gg-sandbox-swift/libraries.txt`. That file's group
headings are what the catalogue's library section renders, and every module it
lists must sit under one. The archive is pulled by member, so a module a program
leaves unimported costs it nothing.

The catalogue is reflected by `swiftc -emit-symbol-graph` over the SDK's own
documentation comments and generated into the build's `OUT_DIR`, and the arm
asserts the catalogue it embeds was generated for Swift. Four doc-comment
conventions are contracts the reflector holds the SDK to:

- `- Parameter <label>:` and `- Parameters:` document an argument under the name
  a call site writes, which for a labelled argument is the label;
- `- Returns:` and `- Throws:` stay in the description, landing in the detail
  rather than the brief;
- `- ggop:` names the operation a function binds and `- ggop-alias:` a second
  spelling of one, and a public module function naming neither is refused;
- `- ggmodule:` says which of gg's modules a namespace is.

Which calls a run offered is the same question on every arm. See
[the agent surface](/gg/languages/agent-surface/).

## Code modules

A code skill's or memory's namespace is bound at `lib.<key>`. Swift links, so a
module becomes a further file of the program's own Swift module, and each of its
top-level declarations is moved into `lib.<key>` by being wrapped where it
stands in an `extension` of a caseless `enum`. That preserves every line number,
because the wrap is a prefix on the declaration's first line and a suffix on its
last, and it preserves argument labels, defaults, generic parameters, `where`
clauses, `throws` and overloads, because the author's own text is what the
compiler reads.

Declarations Swift keeps out of a type stay at file scope, which here is the
program's own module, so a `protocol` two code modules both declare is a
redeclaration the turn's compile reports. A compiler conditional at a module's
top level is refused by name as unsupported, because its two halves would land
in two different `extension` bodies.

A module is compiled twice: type-checked alone when it is read, so a module that
does not build fails on the turn that loaded it, and compiled again as part of
each program that uses it. `lib.<key>.<name>` is therefore a name the compiler
resolves, and a key that does not exist is a diagnostic on the turn that wrote
it. Binding keys are camelCase and ASCII only, since a key names both a nested
type and the file the module is compiled under.

## Failures

`swiftc` has no parse-only phase, so an unclosed brace and a type error arrive
together from one invocation and everything the compiler rejects is a compile
error. Warnings, notes and the compiler's exit summary are dropped, and what is
left is bounded at eight errors. Each error keeps the source line `swiftc` drew
under it and the caret under that, so the excerpt stays aligned.

A diagnostic located outside the model's own file and the code modules in its
scope is gg's own shell or bindings, a diagnostic with no location is a link or a
driver that failed, and no diagnostics at all is a compiler that crashed or hit
its timeout. All three are toolchain failures rather than the model's problem,
and all three are decided over the compiler's whole output before any line is
dropped. A diagnostic in a code module is the model's, since the module compiled
on its own when it was read and has stopped working in company.

At run time a failure is a trap. An uncaught error, a `fatalError`, a
force-unwrapped `nil`, an index out of range and an arithmetic overflow all end
the program, and nothing inside the guest can catch one. `-g` is this arm's
error surface: at `-Osize` the optimiser encodes a runtime failure's message in
the debug information as a synthetic inlined frame, and gg's engine symbolicates
the trap, so a model reads the message with its own line and column.

```text
Swift runtime failure: Index out of range
  … at /gg/work/main.swift:3:22
```

An uncaught throw is the exception. The runtime hands the error to
`swift_errorInMain` from the entry point's synthesized epilogue, so what reaches
the model is gg's own sentence naming the failed call, with no line. Catching an
expected failure is what buys the line back.

## Prompt dialect

Two Handlebars templates, `system-code.swift.hbs` and
`code-nothing-shown.swift.hbs`, are written in Swift's syntax. Neither writes a
function name or a signature: every spelling they quote is resolved from this
arm's catalogue when the template renders. The system prompt states:

- the response is compiled verbatim as a whole Swift file, and a program
  `swiftc` refuses comes back as type diagnostics at the model's own line and
  column instead of running;
- every call throws, so `try` is required, an expected failure is caught as
  `core.ToolError` and branched on by its `code`, and a runtime failure ends the
  program with nothing able to catch it;
- the program is synchronous, so nothing is awaited and a `Task` compiles,
  schedules and never runs;
- the declared libraries are the whole of what is linked;
- gg's surface needs no import line, a program's own declaration of a module's
  name shadows gg's while the fully qualified form still reaches it, and
  optional arguments are default values passed by label.

Statements gg synthesizes into the transcript are written in the same dialect:
`try views.openFile("src/main.swift")`, with a window passed as the call's own
`offset:` and `limit:` arguments.

The arm's healing dialect reads Swift lexically rather than parsing it, and
declines rather than guessing. A `"` string ends at its line's end while a `"""`
string may carry a newline. A raw string's `#` fence is counted rather than
looked for, and inside one neither a quote nor a backslash escapes.
Interpolation is a parenthesis count, so `"total: \(rows["n"])"` is one string
whose spliced contents are code. Block comments nest. Swift has no character
literal, so an apostrophe in a line of prose is ordinary punctuation.

## The idiomatic Swift surface

The argument label is Swift's defining feature, so a call reads as a sentence
and the label is part of the function's name.

```swift
try files.editFile("src/main.swift", replacing: "old", with: "new")
let built = try shell.run("swift build", timeout: 300)
try views.openText("build", body: built.output)
```

Every call throws and `core.ToolError` is an ordinary Swift `Error` carrying a
`code`. Required arguments are positional and optional ones are default values.
A fixed choice is an `enum` and a choice that carries something is an `enum`
with an associated value, so a wrong value is a program that does not compile. A
three-way patch field is an `enum` whose default is `.keep`, and a span of turns
is a `ClosedRange`. A value a call hands back carries the calls that belong to
it, each catalogued as an alias of the module function it repeats. The arm
compiles full Swift, so Foundation, `Codable`, existentials and reflection are
all reachable.
