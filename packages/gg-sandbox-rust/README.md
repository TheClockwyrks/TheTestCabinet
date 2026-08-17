# `gg-sandbox-rust` — gg's Rust SDK and library set

The **Rust** arm of gg's
[responses-as-code](../../apps/docs/src/content/docs/gg/responses-as-code/overview.md)
capability. Under that capability a model answers a turn by writing a whole
**program** instead of a batch of tool calls; this arm compiles that program with a
real `rustc`, on the host, per turn — into the **wasm component that turn is
evaluated by**.

**Not a guest, and not merely a library either.** Every other arm ships a component
holding a language runtime: `gg-sandbox` bakes a JavaScript engine, `gg-sandbox-python`
a whole CPython, `gg-sandbox-ruby` an Opal. Rust has no runtime of that kind. `rustc`
does not produce a Rust interpreter that later runs a program — it produces the
program, and that module *is* the component. There is nothing of this language to
bake, which is why the seam grew a shape for it: a language may answer "no guest
component" and hand its bytes back from the preparation instead.

What this package **is** is the crate a program is compiled against — named `gg`,
because `rustc --extern gg=…` is what puts it in scope and so it is the first word of
every Rust program in the study. It carries the hand-written, idiomatic SDK a model
calls, the shell that answers gg's world and calls the model's own `main`, and the
generated bindings both are written against.

The SDK is **twelve capability modules** — `files`, `shell`, `board`, `tasks`,
`memories`, `views`, `docs`, `context`, `delegation`, `skills`, `programs`, `session` —
plus a thirteenth, `core`, which declares no function and holds the three types every other
module's signatures name. Each module owns the types it produces, so `gg::files::FileRead`
is at once the path a program writes and the key its documentation view is opened by, and
two modules are free to declare a type of the same name. There is no prelude and gg
imports nothing on a program's behalf: a program writes `gg::files::read_file(…)` in full,
or `use gg::files;` and then `files::read_file(…)`.

## What it produces

Nothing here is committed. Every file below is generated during an ordinary
`cargo build -p test-cabinet-gg` and `include_bytes!`d out of the build's own `OUT_DIR`:
[`build.sh`](build.sh) is run by `crates/gg-sandbox-artifacts/rust`, and
[`signatures.sh`](signatures.sh) by `crates/gg/build.rs`.

| Artifact | What it is |
| --- | --- |
| `rust.libraries.tar.gz`, in `$GG_ARTIFACTS_RUST` | Every `.rlib` a program links — this SDK and the curated set — gzipped. ~9.4 MB, `include_bytes!`d by the host and unpacked once per machine into a shared, sealed, read-only directory named on `rustc -L`. |
| `rust.adapter.wasm`, in `$GG_ARTIFACTS_RUST` | The pinned `wasi_snapshot_preview1` **reactor** adapter, 52 KB, which turns the preview1 core module `rustc` emits into the component gg's engine instantiates. `include_bytes!`d by the host and never written to disk. |
| `rust.toolchain.json`, in `$GG_ARTIFACTS_RUST` | What that set was built by — the compiler, the target, the `wit-bindgen` release, the adapter — and every crate in it, each marked with whether a **program** may name it. |
| `rust.signatures.json`, in the build's `OUT_DIR` | The signature catalogue: the whole of what a model is told about this surface, reflected out of this crate's own rustdoc by `signatures.sh`, which `crates/gg/build.rs` runs on every build. |

There is no `rust.component.wasm`: the component is the program, compiled per turn.

To put the artifacts somewhere you can open them, run `scripts/gg-artifacts.sh`; the catalogue's
equivalent is `scripts/gg-signatures.sh`.

## Why the set rides inside gg and the compiler does not

`rustc` with its `wasm32-wasip1` standard library is **~380 MB** and cannot ride
inside a single static `tcab` binary, so it is installed into the gg toolchain
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
builds with, so there is only one Rust release in the repository to keep in step. A bump
re-cuts the set on the next `cargo build` and cannot fail to: `rust-toolchain.toml` is in
this arm's artifact-crate rerun set, and `build.sh` refuses to run at all if the `rustc`
on `PATH` is not the pinned one, before it produces a single rlib. That check used to be
made from the other end, by a test comparing the compiler recorded in `rust.toolchain.json`
with the one on the machine; there is no longer an interval in which the two can differ.

## Layout

| Path | What it holds |
| --- | --- |
| `rust-version.sh` | The pins: the compiler (read out of `rust-toolchain.toml`), the target, the preview1 reactor adapter, and the `wit-bindgen` release. Sourced by every script here and by `containers/build.sh`. |
| `Cargo.toml` | Its own workspace on purpose — it is compiled for wasm and its output is a set of `.rlib` files, so a member of the repository's workspace would be built by every `cargo build --workspace` for no reason. |
| `src/lib.rs` | The crate's own front door: the capability modules with the gg module id each declares itself to be, and `log`. |
| `src/files.rs`, `src/shell.rs`, … | One file per capability module. Each declares its functions with the gg operation each binds, the types those functions hand back, and the gg tools they dispatch (`TOOLS`). |
| `src/core.rs` | The two types that belong to no module because they belong to all of them: `ToolError` and `ToolErrorCode`. |
| `src/wire.rs` | The bridge onto the generated bindings — the only part of this crate a model never reads. |
| `src/program.rs` | The shell: the type gg's world is exported on, the `export!` that makes a program a component, the call into the model's own `main`, the `Failure` type that `main` returns, and what `bound-tools` answers. |
| `signatures.sh`, `tools/` | The catalogue: `rustdoc` JSON in, `rust.signatures.json` out, into `$GG_SIGNATURES_OUT_DIR`. `tools/catalogue.py` holds the one thing the sources cannot say — which modules the surface is divided into and in what order a reader meets them — and `tools/signatures.py` is everything else. A function's gg operation id is written on the declaration itself, as `#[doc(alias = "ggop:files.read_file")]`, and a module's as `#[doc(alias = "ggmodule:files")]`. |
| `src/bindings.rs` | **Generated and not committed** — a pure function of `crates/gg/wit/gg-sandbox.wit` and the pinned `wit-bindgen`. `bindings.sh` writes it. |
| `bindings.sh` | Resolves the pinned `wit-bindgen` and generates `src/bindings.rs`. Its own script rather than a step of `build.sh` because both `build.sh` and `signatures.sh` need it, and folding it into `build.sh` would give the two one rerun set instead of two — see below. |
| `build.sh` | Generates the bindings, compiles the set for `wasm32-wasip1`, packs it with the pinned adapter and writes the manifest. |

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
is what `rustc --extern` puts in a program's extern prelude) and `tools/signatures.py`
groups the catalogue's library list by them. One declaration, two readers, so what a model
is told it may use and what the compile lets it name cannot drift.

Two constraints decide what may be in it, and both are hard:

- **No proc macros, anywhere in the tree.** A proc macro is a host dynamic library, and an
  rlib whose metadata names one cannot be loaded on any other architecture (measured:
  `E0463`). That rules out `serde`'s `derive`, `thiserror` and `clap`; `build.sh` fails on
  one rather than trusting nobody adds it.
- **It must compile for `wasm32-wasip1`**, which the sandbox gives no clock, no filesystem,
  no sockets and no randomness. That rules out `rand`, `chrono` and `reqwest`. Reaching the
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

You never have to run `signatures.sh` for correctness: `crates/gg/build.rs` runs it on
every build of `test-cabinet-gg`, so a doc comment or a signature edited in `src/` reaches
the model's prompt on the next `cargo build`. It needs this checkout's own `rustdoc`, the
`wasm32-wasip1` standard library (`scripts/ci/install-rust-wasm.sh`) and
`src/bindings.rs`, which it generates with `bindings.sh` when it is missing. Run it by hand
— with `GG_SIGNATURES_OUT_DIR` set, or through `scripts/gg-signatures.sh` — when you want
to *read* the emitted JSON, which is where a reflector bug shows and nowhere else.

**`signatures.sh` writes the catalogue and nothing else, and that is why the bindings are
their own script.** Both halves are generated during `cargo build`, by two different crates
with two different rerun sets: `crates/gg-sandbox-artifacts/rust` runs `build.sh`, and
`crates/gg/build.rs` runs `signatures.sh`. A signature step that reached `build.sh` for its
bindings would collapse those two sets into one, so editing a doc comment would re-link
9.4 MB of rlibs — which is the whole inner-loop cost the artifact crates exist to avoid. It
is also the shape that makes a build script invalidate its own inputs, which is why
`crates/gg/build.rs` names this package's `src` and `tools` and never its `.build/`.

**The set is byte-reproducible across checkouts.** An `.rlib` records the absolute paths it
was compiled from and the directory `rustc` ran in, so `build.sh` remaps this package and
`CARGO_HOME` onto fixed logical roots. Cargo leaves the values of `--remap-path-prefix` out
of the unit hash it derives `-C metadata` from, so that does not itself put the path back;
verified by building at two roots and under two `$HOME`s and comparing every rlib's digest.
Nothing depends on that any more — the set is generated rather than committed, so there is
no second copy to diff against — but an artifact that changed when nothing did is one nobody
can reason about, so the property is kept.

## What a Rust program looks like

A **whole Rust program**: the `use` lines the model wrote and the `fn main` it declared,
compiled as a binary crate under the name `program`. gg writes nothing around it, so the
file `rustc` reads is the file the model sent and every diagnostic is already in the
model's own coordinates.

`fn main() -> Result<(), gg::Failure>` is the shape against a `Result`-returning SDK,
because it is what makes `?` compose. Anything implementing `std::error::Error` converts
into `Failure`; `gg::program::message("…")` is the constructor for a program that wants to
stop on a sentence of its own.

## How the shell reaches the model's `main`

`src/program.rs` is this arm's shell. It declares the type gg's world is exported on,
expands the `export!` that makes every program a component, and calls the model's `main`
through `__main_void` — the unmangled C entry symbol `rustc` emits for a **binary** crate
and asks `rust-lld` to export. A library crate type emits neither, since there the model's
`main` is dead code and the Rust-mangled symbol carries a `-C metadata` hash no `extern`
declaration can name.

`__main_void` is a wasi-libc convention rather than a stable ABI, so it is guarded by a
test rather than trusted: `rust.substrate.test.rs` compiles a `fn main()` program, drives
the `run` export and asserts both that the model's `main` ran and that a panicking one's
stderr reaches the host.

## How a failure reaches the model

By capture. Nothing here intercepts a failure: the program dies the way its runtime kills
it, and gg reads the standard error `wasm32-wasip1` gives it.

A panic writes `std`'s own `thread 'main' (1) panicked at program.rs:6:5:` — the model's
own file at the model's own line and column — and then aborts, which traps the store; gg
shows the trap with that stderr in front of it. A `main` returning `Err` has `std`'s
`Termination` write `Error: …` before the shell propagates the status.
`std::process::exit` is `proc_exit`, which reaches gg as an `I32Exit`. `-C strip=symbols`
costs none of it, since `Location` is static data rather than a symbol name.
