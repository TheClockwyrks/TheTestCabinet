# `gg-sandbox-rust` — gg's Rust SDK and library set

The **Rust** arm of gg's
[responses-as-code](../../apps/docs/src/content/docs/gg/responses-as-code.md)
capability. Under that capability a model answers a turn by writing a whole
**program** instead of a batch of tool calls; this arm compiles that program with a
real `rustc`, on the host, per turn — into the **wasm component that turn is
evaluated by**.

**Not a guest, and not merely a library either.** Every other arm ships a component
holding a language runtime: `gg-sandbox` bakes a JavaScript engine, `gg-sandbox-python`
a whole CPython, `gg-sandbox-ruby` an Opal. Rust has no runtime of that kind. `rustc`
does not produce a Rust interpreter that later runs a program — it produces the
program, and that module *is* the component. There is nothing of this language to
commit, which is why the seam grew a shape for it: a language may answer "no committed
component" and hand its bytes back from the preparation instead.

What this package **is** is the crate a program is compiled against — named `gg`,
because `rustc --extern gg=…` is what puts it in scope and so it is the first word of
every Rust program in the study. It carries the hand-written, idiomatic SDK a model
calls, the shell gg's generated entry file names, and the generated bindings both are
written against.

The SDK is **eleven capability modules** — `files`, `shell`, `board`, `tasks`,
`memories`, `views`, `context`, `delegation`, `skills`, `programs`, `session` — plus a
twelfth, `core`, which declares no function and holds the three types every other
module's signatures name. Each module owns the types it produces, so `gg::files::FileRead`
is at once the path a program writes and the key its documentation view is opened by, and
two modules are free to declare a type of the same name. `gg::prelude` re-exports the
**modules**, never the types inside them: that is what keeps a call qualified by the
module that documents it, which is the whole of how a model discovers one.

## What it commits

| Artifact | What it is |
| --- | --- |
| [`crates/gg/src/sandbox/checkers/rust.libraries.tar.gz`](../../crates/gg/src/sandbox/checkers/) | Every `.rlib` a program links — this SDK and the curated set — gzipped. ~9.4 MB, `include_bytes!`d by the host and unpacked once per machine into a shared, sealed, read-only directory named on `rustc -L`. |
| [`crates/gg/src/sandbox/checkers/rust.toolchain.json`](../../crates/gg/src/sandbox/checkers/) | What that set was built by — the compiler, the target, the `wit-bindgen` release — and every crate in it, each marked with whether a **program** may name it. |
| [`crates/gg/src/sandbox/guests/rust.signatures.json`](../../crates/gg/src/sandbox/guests/) | The signature catalogue: the whole of what a model is told about this surface, reflected out of this crate's own rustdoc by `signatures.sh`. |

There is no `rust.component.wasm`: the component is the program, compiled per turn.

## Why the set is committed and the compiler is not

`rustc` with its `wasm32-unknown-unknown` standard library is **~376 MB** and cannot
ride inside a single static `tcab` binary, so it is installed into the gg toolchain
image ([`containers/gg-toolchains/Dockerfile`](../../containers/gg-toolchains/Dockerfile))
and found on `PATH` at run time.

The library set goes the other way. It is 9.4 MB gzipped — most of it `regex`'s
`regex-syntax` and `regex-automata` — it carries this arm's SDK, and gg
is copied as a single file into an ephemeral run container whose image was built
separately — so a set that lived in the image could be a different vintage from the
binary reading it, which once the SDK is in it would mean a model shown one surface in
its prompt and compiled against another.

**The two halves are pinned to each other harder than any other arm's are.** An `.rlib`
is a compiler-version-private format: `rustc` refuses one built by another release
outright, with `E0514`. So this arm has **no compiler pin of its own** — it uses
[`rust-toolchain.toml`](../../rust-toolchain.toml)'s, the one every checkout already
builds with, so there is only one Rust release in the repository to keep in step. Bumping
it invalidates the committed set and `build.sh` must be re-run in the same commit;
`the_committed_library_set_was_built_by_this_checkouts_compiler` fails by name until it
is.

## Layout

| Path | What it holds |
| --- | --- |
| `rust-version.sh` | The pins: the compiler (read out of `rust-toolchain.toml`), the target, and the `wit-bindgen` release. Sourced by every script here and by `containers/build.sh`. |
| `Cargo.toml` | Its own workspace on purpose — it is compiled for wasm and its output is a set of `.rlib` files, so a member of the repository's workspace would be built by every `cargo build --workspace` for no reason. |
| `src/lib.rs` | The crate's own front door: the capability modules with the gg module id each declares itself to be, the `prelude` gg glob-imports into every program, and `log`. |
| `src/files.rs`, `src/shell.rs`, … | One file per capability module. Each declares its functions with the gg operation each binds, the types those functions hand back, the gg tools they dispatch (`TOOLS`), and the `list` every module carries. |
| `src/core.rs` | The three types that belong to no module because they belong to all of them: `ToolError`, `ToolErrorCode` and `FunctionSummary`. |
| `src/wire.rs` | The bridge onto the generated bindings — the only part of this crate a model never reads. |
| `src/directory.rs` | The one `list` declaration, expanded into every capability module by a macro so its documentation is written once. |
| `src/program.rs` | The shell gg's generated entry file names: the panic hook, the `Failure` type a program's body returns, and what `bound-tools` answers. |
| `signatures.sh`, `tools/` | The catalogue: `rustdoc` JSON in, `rust.signatures.json` out. `tools/catalogue.py` holds the one thing the sources cannot say — which modules the surface is divided into and in what order a reader meets them — and `tools/signatures.py` is everything else. A function's gg operation id is written on the declaration itself, as `#[doc(alias = "ggop:files.read_file")]`, and a module's as `#[doc(alias = "ggmodule:files")]`. |
| `src/bindings.rs` | **Generated and not committed** — a pure function of `crates/gg/wit/gg-sandbox.wit` and the pinned `wit-bindgen`. `bindings.sh` writes it. |
| `bindings.sh` | Fetches the pinned `wit-bindgen` and generates `src/bindings.rs`. Its own script rather than a step of `build.sh` because both `build.sh` and `signatures.sh` need it and only one of them may write a committed artifact — see below. |
| `build.sh` | Generates the bindings, compiles the set for `wasm32-unknown-unknown`, packs it and writes the manifest. |

## Why the bindings are generated by a CLI rather than by the macro

`wit_bindgen::generate!` is the ordinary way to do this and it does not work here. The
macro leaves a dependency on the `wit-bindgen-rust-macro` **proc macro** in the rlib's
metadata, and a proc macro is a *host* dynamic library — so `rustc` then refuses to load
the library set unless that `.so` is beside it, which would mean shipping one build of the
set per host architecture (measured: `E0463: can't find crate for wit_bindgen_rust_macro
which gg depends on`). Generating ahead of time leaves the set depending on nothing but the
`wit-bindgen` runtime crate, which is ordinary Rust and architecture-free.

Two generator options are load-bearing and neither is a default.
`--pub-export-macro` makes the generated `export!` macro reachable from outside this crate,
and `--default-bindings-module gg::bindings` makes it expand against these bindings — which
together are what let the *program*'s crate export the world while the bindings stay
prebuilt. Without them the whole strategy collapses back to recompiling the binding surface
on every turn.

## The curated library set

`std` is free, and `Cargo.toml`'s `[dependencies]` declares five crates a program may
`use` with no manifest to edit: `regex`, `serde_json`, `base64`, `itertools` and
`indexmap`. They sit under `# --- heading ---` comments, and those headings are
**machine-readable**: `build.sh` marks exactly those crates `extern` in the manifest (which
is what `rustc --extern` puts in a program's prelude) and `tools/signatures.py` groups the
catalogue's library list by them. One declaration, two readers, so what a model is told it
may use and what the compile lets it name cannot drift.

Two constraints decide what may be in it, and both are hard:

- **No proc macros, anywhere in the tree.** A proc macro is a host dynamic library, and an
  rlib whose metadata names one cannot be loaded on any other architecture (measured:
  `E0463`). That rules out `serde`'s `derive`, `thiserror` and `clap`; `build.sh` fails on
  one rather than trusting nobody adds it.
- **It must compile for `wasm32-unknown-unknown`**, which has no clock, no filesystem, no
  sockets and no randomness. That rules out `rand`, `chrono` and `reqwest`. Reaching the
  world is what `gg::files` and `gg::shell` are for.

## Building it

```sh
packages/gg-sandbox-rust/build.sh      # the library set + the manifest
packages/gg-sandbox-rust/signatures.sh # the signature catalogue
packages/gg-sandbox-rust/bindings.sh   # src/bindings.rs (both of the above call it)
```

Run `build.sh` from a checkout (so `rustup` picks the pinned toolchain up) when
`crates/gg/wit/gg-sandbox.wit` changes, when this package's `src/` changes, or when
`rust-toolchain.toml` bumps the compiler. It fetches the pinned `wit-bindgen` from GitHub;
everything else is local.

Run `signatures.sh` whenever a doc comment or a signature in `src/` changes — which is
every time the surface changes. It needs this checkout's own `rustdoc`, the
`wasm32-unknown-unknown` standard library (`scripts/ci/install-rust-wasm.sh`) and
`src/bindings.rs`, which it generates with `bindings.sh` when it is missing;
`scripts/ci/contract-drift.sh` runs it and fails on a stale committed catalogue.

**`signatures.sh` writes the catalogue and nothing else, and that is why the bindings are
their own script.** The drift gate finishes by diffing everything committed under
`crates/gg/src/sandbox/checkers/` — which is what `build.sh` writes — so a signature step
that reached `build.sh` for its bindings would re-cut the library set on every CI run. It
would then fail on any checkout that is not the one the committed tarball was built on,
which is every CI run, over bytes nobody edited. The gate now asserts that too, right after
the last signature step.

**The set is byte-reproducible across checkouts.** An `.rlib` records the absolute paths it
was compiled from and the directory `rustc` ran in, so `build.sh` remaps this package and
`CARGO_HOME` onto fixed logical roots. Cargo leaves the values of `--remap-path-prefix` out
of the unit hash it derives `-C metadata` from, so that does not itself put the path back;
verified by building at two roots and under two `$HOME`s and comparing every rlib's digest.
Rebuild it and you should get the committed bytes back.

## What a Rust program looks like

A **sequence of statements**, as on every gg arm but PureScript, put inside the body of a
function gg declares on one line before them — so a diagnostic is reported against the line
the model wrote, minus that one. Everything Rust allows in a function body is allowed:
`use`, `struct`, `enum`, `trait`, `impl`, `fn`, `const`, `static`, `mod`, `#[derive(…)]`,
even an inner `#![allow(…)]`.

The body returns `Result<(), gg::Failure>`, which is what makes `?` the operator a Rust
author reaches for against a `Result`-returning SDK. Anything implementing
`std::error::Error` converts into `Failure`; `gg::program::message("…")` is the constructor
for a program that wants to stop on a sentence of its own.

One shape is refused by name: a program that defines `fn main` and expects gg to call it.
gg does not, so that program would have run nothing while reporting a clean turn.

## The panic hook, and why this arm needs one

`wasm32-unknown-unknown` has **no unwinder** — `panic = "unwind"` is not available on it —
so a panic aborts, and an abort traps the whole store. A trap carries no message, no class
and no location, so left alone this arm would have the worst error surface of any in the
study: every `unwrap` on `None`, every index out of bounds and every division by zero would
reach the model as "your program trapped".

A panic *hook* runs before the abort, on a live guest, and can make an ordinary synchronous
host call. `gg::program::begin` installs one that completes `feedback.report-error` carrying
the panic's own message and the model's own line and column, and gg's host half prefers what
the program said about itself over the trap that followed it. The location comes from
`std::panic::Location`, which is static data rather than a symbol name — which is why
`-C strip=symbols` can delete the whole name section without costing this anything.
