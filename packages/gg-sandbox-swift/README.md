# `gg-sandbox-swift` — gg's Swift SDK, shell and library set

The **Swift** arm of gg's [responses as code] capability: the surface a model's program calls, the
shell it is compiled beside, the bridging header both are compiled against, the curated libraries it
may import, and the builds that commit all of it into gg's binary.

It is not an npm package and not a Cargo crate. It is a directory of sources and three scripts,
because what it produces is not a library anybody links from this repository — it is compile
*inputs* that ride inside `gg` and are unpacked next to a model's program once per machine.

[responses as code]: https://docs.testcabinet.ai/gg/responses-as-code/

## What this arm is

**A Swift program is compiled by `swiftc` into the wasm component that turn is evaluated by.**
There is no committed guest and no interpreter: this is the second arm of that shape, after
[Rust](../gg-sandbox-rust/), and the whole design is in
`crates/gg/src/sandbox/language/swift.compile.rs`.

Three things about it are worth knowing before reading anything here.

**A model's reply is compiled verbatim, as `main.swift`.** No wrapper, no prologue, no `import`
line and no line offset. That is forced rather than chosen: Swift refuses `extension`, `protocol`
and `import` inside a function body, so the wrapper every other statement-shaped arm uses would
forbid three things a Swift author writes without thinking. A top-level file is the only Swift
context that admits declarations and bare statements together — and `Sources/shell.swift` is a
second file of the *same module*, which is what lets it name the entry point Swift lowers that
file's statements into and call it from the sandbox world's `run` export.

**The SDK reaches that file through one line, and the line is `@_exported import gg`.** A Swift
`import` is file-scoped: written in the shell it would put `fs` in scope in the shell and nowhere
else, and the model's `main.swift` would still fail with `cannot find 'fs' in scope`. A re-export is
module-scoped, so every file of the program's module sees it. Both were measured; the alternative
was making a model write `import gg` on line 1 and paying a line offset on every diagnostic and every
located trap for the rest of the arm's life.

**Its failures are traps, and what a model is told about one comes out of the artifact's debug
information.** At `-Osize` Swift does not print `Fatal error: Index out of range` anywhere: the
optimiser replaces the report with a bare `unreachable` and encodes the message as the name of a
synthetic inlined frame. So the arm compiles with `-g` and gg's engine symbolicates the backtrace,
which is what gets both the message and the model's own line and column out.

## What is here

| | |
| --- | --- |
| `Sources/SDK/` | **The SDK a model writes against.** One file per capability module under `Modules/`, each carrying its functions and the types they produce, plus `Internal/` — the wire bridge and the two public functions that belong to no module. Compiled ahead of time into a module called `gg`. |
| `Sources/shell.swift` | gg's shell — the `@_exported import` that puts the SDK in the model's scope, the two exports the sandbox world declares, and the call into the model's own top-level code. Compiled beside every program, once per turn. |
| `Sources/gg-shell.h` | The bridging header: the generated WIT surface as C, `stdlib.h` for the allocator the canonical ABI's post-return frees with, and the one declaration that is not generated (the program's entry point). |
| `libraries.txt` | Every module a program may `import`, grouped as the catalogue renders them. One declaration, two readers: `tools/signatures.py` and a gg test that compiles a program importing all of them. |
| `swift-version.sh` | Every pin — the Swift release, the wasm SDK, the target triple, the `wasi_snapshot_preview1` adapter, the `wit-bindgen` release, the three vendored packages — and where gg looks for the toolchain. Sourced by everything below, by `containers/gg-toolchains/Dockerfile` and by `scripts/ci/install-swift.sh`. |
| `bindings.sh` | Generates the C bindings from `crates/gg/wit` with the pinned `wit-bindgen`. Its own script so no step that must write exactly one file has to reach the build. |
| `build.sh` | Compiles those bindings and the SDK for wasm, vendors and compiles the library set, cuts the two committed archives, fetches the adapter, and writes the manifest. |
| `signatures.sh`, `tools/` | The catalogue: a symbol graph in, `swift.signatures.json` out. `tools/catalogue.py` is the module table — gg's thirteen ids, the order a reader meets them in, and the Swift path each answers under — and `tools/signatures.py` is everything else. A function's gg operation id is not in either: it is a `- ggop:` line in the declaration's own doc comment. |

## What a Swift program looks like

An ordinary top-level Swift file with gg's whole surface already in scope:

```swift
let entries = try files.listDir("src")
let sources = entries.filter { $0.kind == .file }
let built = try shell.run("swift build")
try views.openText("build", body: built.output)
try session.finish("looked at \(sources.count) sources")
```

Every capability module — `files`, `shell`, `board`, `tasks`, `memories`, `views`, `docs`,
`context`, `delegation`, `skills`, `programs`, `session`, and `core` for the types the rest
share — is a caseless `enum`, which is Swift's own namespace, so a call is a call on a namespace
and nothing is constructed first. Each owns the types it produces (`files.FileRead`, `board.IssueCreated`), so two
modules are free to declare a type of one name. The module names are gg's **identity** rather than
this SDK's spelling: they are the vocabulary every arm shares, and no language may rename them,
which is the one place this SDK departs from Swift's UpperCamelCase convention for types and the
reason it does.

A caseless `enum` rather than that many real Swift modules behind an `@_exported` umbrella. The
umbrella was measured and does re-export transitively, so that was not what decided it: a module of
its own would have to be called `GgFiles` where the vocabulary is `files`, and a program that
declares its own `files` shadows either shape equally. What answers the shadowing is the fully
qualified form — `gg.files.readFile(…)`, a real path in the module the SDK is compiled into, which
still resolves in a file that has taken the short name for itself. That is why it is the name the
catalogue publishes.

Everything else is Swift's own idiom:

- **Every call `throws`**, so `try` is the whole of the ceremony and `core.ToolError` is an
  ordinary `Error`. Catch what you expect
  (`catch let failure as core.ToolError where failure.code == .notFound`) and let the rest out.
- **Required arguments are positional; optional ones are default values.** There is no options
  record anywhere in this surface — `files.readFile("a.swift", limit: 40)` skips `offset:` because
  Swift lets it.
- **Argument labels carry the roles the function's name does not**: `files.editFile("a",
  replacing: "x", with: "y")`, `delegation.sendMessage("note", to: id)`,
  `tasks.setBlockedBy("t1", to: ["t0"])`.
- **A fixed choice is an `enum`**, never a string: `.done`, `.inProgress`, `.file`. A choice that
  carries something is an `enum` with an associated value, so a child's brief is `.prompt("…")` or
  `.issue("AUTH-1")` and "both" and "neither" are programs that do not compile.
- **A three-way field is `core.TextEdit`** — `.keep`, `.clear`, `.set("…")` — with `.keep` as the
  default, so leaving an argument out is what leaves the field alone.
- **A value carries the call that belongs to it**, through an `extension` in its own module:
  `handle.send(…)`, `view.close()`, `hit.read()`, `summary.source()`, `issue.wait()`. Each is a
  second spelling of a function the module also offers, and is catalogued as an alias of it.
- **A span of turns is a `ClosedRange`**: `try context.archiveThread([4...19])`.
- **`gg.log` reaches the run's operator**, and `views.openText` reaches you. `print` works and goes
  where `gg.log` goes; neither reaches your next prompt.

A program's own declarations **shadow** gg's, because the SDK is a different module: `enum files
{ … }` in a program is that program's, not a redeclaration error — and `gg.files.readFile(…)` is
how the same program still reaches the SDK it shadowed.

## The curated library set

`libraries.txt` is the whole claim, in three groups: three vendored packages (swift-collections,
swift-algorithms, swift-numerics), the modules the Swift SDK for WebAssembly ships beside the
standard library (Foundation and its companions, `RegexBuilder`, `Synchronization`, `Observation`,
`WASILibc`), and the standard library itself, which needs no import.

This is **full Swift, not Embedded Swift**, and that is a deliberate choice with a price. Embedded
Swift would produce artifacts one or two orders of magnitude smaller — this arm's 7.1 MB is almost
entirely the statically linked standard library — but it drops Foundation, `Codable`, existentials
(`any P`), most of reflection and much of the runtime a model would reach for without thinking. A
model whose `Date()` or `JSONSerialization` is a compile error is a model writing against a Swift
nobody else writes, which is exactly the confound a cross-language study cannot carry. The size is
paid once per turn as `compileWaitMs` and is recorded rather than hidden.

The vendored set is compiled into **one static archive**, and that is what makes it free: `lld`
pulls archive members, so an artifact for a program that imports none of them is byte for byte the
size of one built without the archive on the command line at all (measured; passing the objects
directly instead added ~2.7 MB to every artifact, used or not).

## What it commits, and why those and not the compiler

```
crates/gg/src/sandbox/checkers/swift.guest.tar.gz     182 KB — the compile inputs, SDK included
crates/gg/src/sandbox/checkers/swift.libraries.tar.gz 3.4 MB — the curated library set
crates/gg/src/sandbox/checkers/swift.adapter.wasm      52 KB — the preview1 reactor adapter
crates/gg/src/sandbox/checkers/swift.toolchain.json           — what built them, and what is in them
crates/gg/src/sandbox/guests/swift.signatures.json            — the catalogue a model is described by
```

The split every compiled arm here has. The toolchain is ~835 MB even pruned, so it lives in the
gg run image (`containers/gg-toolchains/Dockerfile`). These go the other way because they are a
function of gg's own wire and gg's own surface, and gg is copied as a single file into an ephemeral
run container whose image was built separately — so an SDK that lived in the image could be a
different vintage from the prompt describing it.

**The pin is hard now, and it was not before.** A `.swiftmodule` is a compiler-version-private
format, so the release that reads this arm's SDK must be the release that wrote it. Bumping
`GG_SWIFT_VERSION` invalidates the committed archives and `build.sh` must be re-run in the same
commit.

**This set is not byte-reproducible**, and that is `swiftc` rather than this script: every object it
emits carries a random 16-byte module hash no flag disables. `-file-prefix-map` is still applied, so
nothing records the path of the checkout it was built in; what varies is the hash alone. Re-run
`build.sh` only when something really changed, and expect the diff to be larger than what you edited.

## Why the bindings are C

`wit-bindgen` has no Swift generator, and this arm does not need one: Swift imports C natively.
The canonical ABI is generated once with the **C** generator, compiled to a wasm object at build
time (3,000 lines of generated C that never changes between programs is ~90 ms a turn that buys
nothing), and reached from Swift through the bridging header. Hand-writing the lowering in Swift
would have been a second implementation of a specification that drifts from `crates/gg/wit` on
its own schedule.

`Sources/SDK/Internal/Wire.swift` is the one file that touches it, and the one file a model never
reads.

## Why the catalogue comes out of a symbol graph

`swiftc -emit-symbol-graph` is the machinery DocC itself is built on, and it reads everything a
model is told about this surface: every doc comment verbatim, every parameter's label and internal
name, and every type the compiler resolved — with a mangled identifier that says which module each
came from, which is how the reflector tells a `TextEdit` from a `String` without a table of names.

Swift's per-parameter documentation is a **convention over the doc comment** rather than a slot in
the syntax (`- Parameter path:`, or a `- Parameters:` block), so `tools/signatures.py` reads the
convention and holds it to being a contract: a function that takes N arguments must document N, in
order, under the names a **call site** writes — which for a labelled argument is the label, because
that is what a model has to type.

**gg's identity for a call is written on the declaration, in the same comment.** Swift has no
user-defined declaration attribute short of a macro, so a function names the gg operation it binds
with a `- ggop: files.read_file` line, a second spelling of one with `- ggop-alias:`, and a namespace
says which of gg's modules it is with `- ggmodule:`. Measured against the pinned toolchain rather
than assumed: `swiftc` emits each as its own line of the symbol graph's `docComment`, unsplit, and
warns about nothing. The reflector strips them before any prose reaches a model, refuses a public
module function that names no operation, and `crates/gg/src/sandbox/language/register.rs` refuses an
id gg's own operations table has no row for — so the check runs in both directions and a capability
cannot be silently absent from a model's surface.

## Rebuilding

```sh
scripts/ci/install-swift.sh              # once; ~835 MB, pruned from 3.3 GB, and it verifies itself
packages/gg-sandbox-swift/build.sh       # after editing Sources/, or after crates/gg/wit changes
packages/gg-sandbox-swift/signatures.sh  # after any doc comment or signature in Sources/SDK/ changes
```

Commit the artifacts with the change that needed them. `swift.compile.test.rs` fails by name if the
archive's copy of the shell or the header is not this checkout's, so an edit here without a rebuild
does not reach a model as a program compiled against the old one — and `scripts/ci/contract-drift.sh`
runs `signatures.sh` on every CI run and fails on a stale committed catalogue.

**`signatures.sh` writes the catalogue and nothing else, and that is why the bindings are their own
script.** The drift gate finishes by diffing everything committed under
`crates/gg/src/sandbox/checkers/` — which is what `build.sh` writes — so a signature step that
reached `build.sh` for its bindings would re-cut the library set on every CI run and fail on bytes
nobody edited.

## What is not built

The **registration** that makes `language: "swift"` a value an operator can configure, and the
**code modules** it is blocked on. `crates/gg/src/sandbox/language/swift.rs` says what registering
it needs and what the plan for `lib.<key>` is on a language whose modules are linked.
