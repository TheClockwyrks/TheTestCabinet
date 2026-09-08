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
reply itself. Swift lowers a top-level file's statements into the target's C
entry point, and gg's shell names that symbol and calls it from the component's
`run` export.

The shell is a module of its own, built ahead of time into `shell.o` and linked
into every program. A Swift access level is module-wide, so a shell compiled
beside the reply would put gg's two exports into the model's own file with no
line the model wrote, and an access level narrow enough to prevent that gives
the exported symbol internal linkage. The model's module is named `program` and
holds the reply and nothing else.

The shell's own two `import` lines are file-scoped. One is the SDK, for the one
function the shell asks it for. The other is the clang module declared by
`Sources/module.modulemap`, which carries the generated canonical ABI, `malloc`,
`free` and the entry-point symbol the shell calls.

One `swiftc` invocation compiles the model's file and links the prebuilt shell,
the prebuilt SDK module, the library archive and the object each code module in
scope compiled to, at `-Osize -g`. gg
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

| Artifact                 | What it carries                                                                                                                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swift.guest.tar.gz`     | The shell's header and the clang module map that names it, the C bindings generated from `crates/gg/wit` compiled to a wasm object, the component-type object, the shell prebuilt as `shell.o`, and this arm's SDK prebuilt as `gg.swiftmodule` plus `gg.o` |
| `swift.libraries.tar.gz` | The curated library set as one static archive, plus the `.swiftmodule` files a program's `import` resolves against                                                                                                                                          |
| `swift.adapter.wasm`     | The pinned `wasi_snapshot_preview1` reactor adapter                                                                                                                                                                                                         |
| `swift.toolchain.json`   | What built the above, and what is in it                                                                                                                                                                                                                     |

The SDK and the library set are prebuilt so that no turn re-typechecks them.
Warm-up unpacks both archives into shared content-keyed directories, placed by
rename and sealed read-only.

## SDK and signature catalogue

The SDK is compiled ahead of time into a Swift module named `gg`, and a program
reaches it by writing `import gg`. What the compile supplies is the `-I` that
resolves the module, which tells the compiler the module exists and puts no name
in scope, so a reply that writes no import reaches nothing gg carries. That is
the line every module of this arm's catalogue states. A separate module is also
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
- `- Returns:` stays in the description, landing in the detail rather than the
  brief;
- `- Throws:` names the error types a function declares, which the catalogue
  carries as that function's `throws` list;
- `- ggop:` names the operation a function binds and `- ggop-alias:` a second
  spelling of one, and a public module function naming neither is refused;
- `- ggmodule:` says which of gg's modules a namespace is.

Which calls a run offered is the same question on every arm. See
[the agent surface](/gg/languages/agent-surface/).

## Code modules

A code skill's or memory's file is compiled into a Swift module of its own,
named by the key the module is bound under, and the program compile is given the
`-I` that resolves it and the object it compiled to. That is the same mechanism
this arm supplies its own SDK through, so a program reaches an author's module
the way it reaches gg's: by writing `import csvTools`, after which
`csvTools.parse(…)` and the unqualified `parse(…)` both resolve. A program that
writes no import line reaches nothing the module carries, and `swiftc` says so
at the line that named it.

Access is Swift's own across a module boundary, so gg writes `public` in front
of a top-level declaration whose author wrote none. It is written on the
declaration's own line, which keeps every line number the author's, and it
leaves whatever the author did write alone: a `private` or `fileprivate`
declaration stays inside the module, and a member of a type or of an `extension`
carries the access its author gave it, as in any Swift library.

Nothing else is written. A declaration keeps its argument labels, defaults,
generic parameters, `where` clauses, `throws` and overloads, because the
author's own text is what the compiler reads. A module that calls gg's surface
writes `import gg` exactly as a program does.

A module is compiled once, when it is read, so a module that does not build fails
on the turn that loaded it. What that compile writes — the `.swiftmodule` the
`-I` resolves and the object the program links — is kept in the loaded-module
band of the agent's compile workspace for every later program. The file is read
`-parse-as-library`, so a code module is declarations where a program is the file
that also carries statements.

Binding keys are camelCase and ASCII only, since a key names both the Swift
module a program imports and the file it is compiled under. A key that names a
module the compile already supplies — `gg`, the program's own `program`, or one
of the library set's — is refused on the turn that would have used it.

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
dropped. A diagnostic in a code module's own file is the model's, since the
module compiled on its own when it was read and has stopped building since.

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

An uncaught throw is the exception, because Swift propagates an error by return
rather than by unwinding. By the time the entry point's synthesized epilogue
hands the error to `swift_errorInMain`, the throwing call's frame has been
popped, so what the model reads is the runtime's own sentence naming the failed
call and the standard library's location rather than its own line. Catching an
expected failure is what buys the line back.

Two further failures are not reported faithfully, and both are the language or
the adapter rather than this arm. A `Task` never runs: Swift's cooperative
executor needs a drain, an `@main async` performs one and a top-level file has
none, so an unobserved failing task is a turn recorded as a success. And
`exit(3)` is reported as an exit with a non-zero status, because the pinned
preview1 adapter lowers every non-zero status to the same failure before gg is
told. What that costs, and why gg names no number for it, is on
[the sandbox page](/gg/responses-as-code/sandbox/#stopping-the-process).

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`swift`, and `code-nothing-shown.hbs` through a clause naming `print`. Neither
writes a function name or a signature: every spelling they quote is resolved
from this arm's catalogue when the template renders. The segment states that the
reply is compiled verbatim as a whole Swift file, whose top-level statements are
the program, and that every module beyond the standard library is reached by
writing its `import`.

Each entry of the module list beside the segment carries `import gg` as the line
that brings that module into scope as a caseless `enum`, whose fully qualified
form always reaches gg's.

The arm names `swiftc` as its [checker](/gg/languages/compilation/), so the
shared body states that a program is compiled before it runs, that one `swiftc`
refuses comes back as diagnostics at the model's own line and column instead of
running, and that a call the run withheld compiles and fails when it runs. The
linked library set is reached through a compile failure rather than through the
prompt.

Source gg synthesizes for this arm is written in the same idiom, under the same
import line: `import gg` and then `try gg.views.openFile("src/main.swift")`,
with a window passed as the call's own `offset:` and `limit:` arguments.

## Code mask

The arm keeps one byte-level lexer, `swift.mask.rs`, shared by the
[code-module scan](#code-modules): which bytes of a source are code, plus the
identifier and declaration-keyword readers built on the same discipline. A `"`
string ends at its line's end while a `"""` string may carry a newline, a raw
string's `#` fence is counted rather than looked for, `\(…)` interpolations are
code down to their matching parenthesis, and block comments nest. A source that
does not lex cleanly declines the mask, and its readers decline with it.

## The idiomatic Swift surface

The argument label is Swift's defining feature, so a call reads as a sentence
and the label is part of the function's name.

```swift
import gg

try files.editFile("src/main.swift", replacing: "old", with: "new")
let built = try shell.run("swift build", timeout: 300)
try views.openText("build", body: built.output)
```

Every fallible call throws and `core.ApiError` is an ordinary Swift `Error`
carrying a `code`. Required arguments are positional and optional ones are default values.
A fixed choice is an `enum` and a choice that carries something is an `enum`
with an associated value, so a wrong value is a program that does not compile. A
three-way patch field is an `enum` whose default is `.keep`, and a span of turns
is a `ClosedRange`. A value a call hands back carries the calls that belong to
it, each catalogued as an alias of the module function it repeats. The arm
compiles full Swift, so Foundation, `Codable`, existentials and reflection are
all reachable.
