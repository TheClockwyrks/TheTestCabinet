# `gg-sandbox-swift`

The **Swift** arm of gg's [responses as code] capability: the shell a model's Swift program is
compiled beside, the bridging header it is compiled against, and the builds that commit both
into gg's binary.

It is not an npm package and not a Cargo crate. It is a directory of sources and three scripts,
because what it produces is not a library anybody links — it is ~31 KB of compile *inputs* that
ride inside `gg` and are unpacked next to a model's program once per machine.

[responses as code]: https://docs.testcabinet.ai/gg/responses-as-code/

## What this arm is

**A Swift program is compiled by `swiftc` into the wasm component that turn is evaluated by.**
There is no committed guest and no interpreter: this is the second arm of that shape, after
[Rust](../gg-sandbox-rust/), and the whole design is in
`crates/gg/src/sandbox/language/swift.compile.rs`.

Two things about it are worth knowing before reading anything here.

**A model's reply is compiled verbatim, as `main.swift`.** No wrapper, no prologue, no `import`
line and no line offset. That is forced rather than chosen: Swift refuses `extension`, `protocol`
and `import` inside a function body, so the wrapper every other statement-shaped arm uses would
forbid three things a Swift author writes without thinking. A top-level file is the only Swift
context that admits declarations and bare statements together — and `Sources/shell.swift` is a
second file of the *same module*, which is what lets it name the entry point Swift lowers that
file's statements into and call it from the sandbox world's `run` export.

**Its failures are traps, and what a model is told about one comes out of the artifact's debug
information.** At `-Osize` Swift does not print `Fatal error: Index out of range` anywhere: the
optimiser replaces the report with a bare `unreachable` and encodes the message as the name of a
synthetic inlined frame. So the arm compiles with `-g` and gg's engine symbolicates the
backtrace, which is what gets both the message and the model's own line and column out.

## What is here

| | |
| --- | --- |
| `Sources/shell.swift` | gg's shell — the two exports the sandbox world declares, and the call into the model's own top-level code. Compiled beside every program, once per turn. |
| `Sources/gg-shell.h` | The bridging header: the generated WIT surface as C, plus the one declaration that is not generated (the program's entry point). |
| `swift-version.sh` | Every pin — the Swift release, the wasm SDK, the target triple, the `wasi_snapshot_preview1` adapter, the `wit-bindgen` release — and where gg looks for the toolchain. Sourced by everything below, by `containers/gg-toolchains/Dockerfile` and by `scripts/ci/install-swift.sh`. |
| `bindings.sh` | Generates the C bindings from `crates/gg/wit` with the pinned `wit-bindgen`. Its own script so no step that must write exactly one file has to reach the build. |
| `build.sh` | Compiles those bindings for wasm, cuts the committed archive, fetches the adapter, and writes the manifest. |

## Why the bindings are C

`wit-bindgen` has no Swift generator, and this arm does not need one: Swift imports C natively.
The canonical ABI is generated once with the **C** generator, compiled to a wasm object at build
time (3,000 lines of generated C that never changes between programs is ~90 ms a turn that buys
nothing), and reached from Swift through the bridging header. Hand-writing the lowering in Swift
would have been a second implementation of a specification that drifts from `crates/gg/wit` on
its own schedule.

## What it commits, and why those and not the compiler

```
crates/gg/src/sandbox/checkers/swift.guest.tar.gz    31 KB — the compile inputs
crates/gg/src/sandbox/checkers/swift.adapter.wasm    52 KB — the preview1 reactor adapter
crates/gg/src/sandbox/checkers/swift.toolchain.json         — what built them, and what is in them
```

The split every compiled arm here has. The toolchain is ~835 MB even pruned, so it lives in the
gg run image (`containers/gg-toolchains/Dockerfile`). These go the other way because they are a
function of gg's own wire, and gg is copied as a single file into an ephemeral run container
whose image was built separately — so bindings that lived in the image could be a different
vintage from the binary reading them.

## Rebuilding

```sh
scripts/ci/install-swift.sh          # once; ~835 MB, pruned from 3.3 GB, and it verifies itself
packages/gg-sandbox-swift/build.sh   # after editing Sources/, or after crates/gg/wit changes
```

Commit the three artifacts with the change that needed them. `swift.compile.test.rs` fails by
name if the archive's copy of the shell or the header is not this checkout's, so an edit here
without a rebuild does not reach a model as a program compiled against the old one.

## What is not built

The **SDK** — the curated, idiomatic Swift surface a model actually writes against — and the
**registration** that makes `language: "swift"` a value an operator can configure. What exists
today is the execution substrate: the compile, the shell, and the proof that a real Swift program
runs through gg's real membrane. `crates/gg/src/sandbox/language/swift.rs` says what registering
it is blocked on.
