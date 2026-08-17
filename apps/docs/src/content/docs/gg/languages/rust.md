---
title: "Rust"
---

## Preparation

An agent whose responses-as-code capability names `rust` answers each turn with
a whole Rust program. The reply is written to `program.rs` in the preparation's
own workspace exactly as the model sent it and compiled by one `rustc`
invocation into a `wasm32-wasip1` core module. gg then encodes that module into
a WebAssembly component in process, with the pinned `wasi_snapshot_preview1`
reactor adapter, validating it on the way out. The component is what the turn
evaluates.

This arm has no guest component: `guest_component()` answers `None`, the
compiled bytes ride on the prepared program, and the engine instantiates a fresh
component every turn. The prepared program carries no source.

## Program shape

A program is a whole Rust program: the `use` lines the model wrote and the
`fn main` it declared. gg writes no prologue, no epilogue, no entry point and no
import, so the file `rustc` reads and the file the model sent are the same
bytes, and every diagnostic and every panic is already in the model's own
coordinates.

`fn main() -> Result<(), gg::Failure>` is the shape against a `Result`-returning
SDK, because it is what makes `?` compose. A program with no entry point is
`error[E0601]: main function not found in crate program`, which is `rustc`'s own
located diagnostic.

The crate type is `bin`, and that is what makes the model's `main` reachable.
`rustc` compiling a binary crate emits the unmangled C entry symbol wasi-libc
names `__main_void` beside the model's `main` and asks `rust-lld` to export it;
gg's SDK declares that symbol, calls it from the world's `run` export, and
propagates a non-zero status as an exit, so the turn fails. A library crate type
emits neither, since
there the model's `main` is dead code and the Rust-mangled symbol carries a
`-C metadata` hash no `extern` declaration can name.

`--extern gg=…` makes the SDK available and puts no name in a program's scope.
A program reaches a name in full, `gg::files::read_file(…)`, or under the
`use` line the catalogue states for that module. Since `rustc` links an
`--extern` crate only when the program's own text refers to it, and exports the
world's `run` only for a crate it linked, gg names the SDK archive to the linker
directly and asks for the world's two exports and the canonical ABI's two by
name, so a program which reaches nothing gg offers still runs.

## Toolchain and build artifacts

`rustc` is found at `TCAB_GG_RUSTC`, then `/opt/gg/toolchains/rust/bin`, then
`PATH`. gg sets `RUSTUP_TOOLCHAIN` to the pinned compiler version so a rustup
shim resolves the release the library set was built by. One invocation may take
60 seconds before it is killed and reported as a toolchain failure.

Both invocations pass `--edition 2024`, `--target wasm32-wasip1`,
`-Cpanic=abort`, `-Awarnings` and `--error-format=json`, and name the library
set on `-L dependency=` and `--extern`. A program compiles as a `bin` named
`program`, with `-Copt-level=s` and `-Cstrip=symbols`. A code module compiles as
a `lib` with `--emit=metadata`, since everything its author is answerable for is
reported before code generation and a file of items declares no `main`.

`crates/gg-sandbox-artifacts/rust` generates three artifacts into the build's
own output directory, reached as `GG_ARTIFACTS_RUST`. `rust.libraries.tar.gz`
holds every `.rlib` a program is compiled against, this arm's SDK among them. It
is embedded in the gg binary and unpacked once per machine into a shared
read-only directory, which is this arm's whole warm-up. `rust.adapter.wasm` is
the pinned reactor adapter the encode needs, held in memory rather than on disk.
`rust.toolchain.json` records the compiler version, the target triple, the
adapter release, and which crates are named on `--extern`.

The set must be built by the compiler the checkout pins, since an `.rlib` is a
compiler-version-private format, and `build.sh` fails by name when the shell's
`rustc` disagrees. It also remaps the package and `CARGO_HOME` to fixed logical
roots, so the same inputs produce the same archive anywhere.

## The SDK

`packages/gg-sandbox-rust` holds a hand-written SDK spelled the way Rust is
spelled, obeying the rules on
[the agent surface page](/gg/languages/agent-surface/). It is twelve capability
modules (`files`, `shell`, `board`, `tasks`, `memories`, `views`, `docs`,
`context`, `delegation`, `skills`, `programs`, `session`) plus `core`, which
declares no function and holds the types the other modules' signatures name. It
declares no prelude and gg imports nothing on a program's behalf. Every function
carries gg's own key for the operation it binds, except `shell.shell`, spelled
`shell::run`.

The SDK also carries this arm's shell, in `program.rs`: the type gg's world is
exported on, the `export!` that makes every program a component, and the
declaration of the entry symbol it calls the model's `main` through. No model
reads any of it, and no source gg compiles contains it.

- A call is a path, `files::read_file(path, files::ReadOptions::default())?`,
  and this arm's `member_separator` is `::`. Each module owns the types it
  produces, so `files::FileRead` is a path and two modules may declare a type of
  the same name.
- Every call returns `Result<_, gg::core::ApiError>`, `ApiError` implements
  `std::error::Error`, and its `code` is an enum, so `?` composes a gg call with
  the standard library's own fallible operations inside a `main` returning
  `Result<(), gg::Failure>`.
- One optional argument is an `Option<T>` in that position; two or more are an
  options struct with a `Default`, filled in with functional update. A fixed
  choice is an `enum`, a three-way patch field is an `enum` with a `Default` arm
  (`TextEdit::Keep` / `Clear` / `Set`), a span of turns is a `RangeInclusive`,
  and a read of several shapes is a sum type narrowed by `match`.
- `board::wait_for_issue`, `memories::read_memory`, `views::close`,
  `delegation::send_message` and `programs::get` are also inherent methods on
  the value carrying their one argument, catalogued as aliases that count toward
  no coverage.
- `gg::log` is what the run's operator reads. gg attaches no standard output to
  the guest, so `views::open_text` is what reaches the model.

### Library set

A program reaches `std` plus five crates: `regex`, `serde_json`, `base64`,
`itertools` and `indexmap`, declared under machine-readable headings in
`packages/gg-sandbox-rust/Cargo.toml`. Both `build.sh` and the catalogue's
library list derive from that one declaration, so what a model is told it may
`use` and what the compile lets it name stay the same list. Only those crates
and the SDK are named on `--extern`; the closure under them is present for
linking and is not a name a program may write.

A crate may enter the set only if it compiles for `wasm32-wasip1` and
neither is nor depends on a proc macro, since a proc macro is a host `.so` and
an `.rlib` whose metadata names one cannot be loaded on another architecture.
`build.sh` fails on either.

## Signature catalogue

The catalogue is reflected out of the SDK's own rustdoc JSON by
`packages/gg-sandbox-rust/signatures.sh`, run as a step of building `crates/gg`,
written into that build's output directory and embedded from there. It is parsed
once per process and asserted to carry `rust` as its language. Reflection needs
the generated `src/bindings.rs`, cut by `bindings.sh`, which both
`signatures.sh` and `build.sh` call. Rust has no per-parameter doc slot, so a
signature taking *N* arguments documents *N* under a `# Arguments` heading, in
order, under their own names. A `# Errors` heading names the error types a
function declares, and the catalogue carries those types as that function's
`throws` list.

Each module states `use gg::<module>;` as the line a program writes to reach it
by its own name, composed by the reflector because rustdoc describes what a
crate declares rather than how another file reaches it. A documentation view
quotes that line.

- rustdoc runs under `RUSTC_BOOTSTRAP=1`, because its JSON output is unstable
  and this arm is documented by the same stable compiler that builds the library
  set. The format version is pinned in the script, so a compiler bump that moves
  it fails by name.
- The gg operation a function binds is written on the declaration as
  `#[doc(alias = "ggop:files.read_file")]`, and a module's identity as
  `#[doc(alias = "ggmodule:files")]`. Reflection fails on a public function in a
  catalogued module that names no operation; an id gg's operations table has no
  row for is caught the other way, by the registry gate over the catalogue this
  arm embedded.

## Code modules

A code skill's or memory's Rust is bound at `lib::<key>`, a path the compiler
resolves rather than a lookup on a value: a key or a name that does not exist is
a diagnostic on the turn that wrote it. Binding keys are lowered to ASCII
snake_case identifiers, since the key is a path segment.

A module's preparation compiles the author's own bytes alone, only to check
them, and reads the public items at its top level from that source as the names
its namespace offers. A module's author writes the same `use gg::<module>;`
lines a program does. It hands back source, because a module is an input to the
program compile that links it. Each module in scope is written beside the entry
file and declared below the program's last line, which moves no line of it. A
reply that ends mid-line is closed with a newline first, so a declaration never
lands inside a line the model wrote.

## Failures

Every diagnostic `rustc` produces is `PrepareError::Compile`, since `rustc` has
no parse-only phase and does not mark a diagnostic as a parse failure. A model
is shown at most eight, each rendered with its children. A diagnostic is located
only when its primary span falls inside the model's own lines, and its line and
column are reported exactly as `rustc` gave them. One earned by the library set
or by the module declarations below the program is still shown, without a
location. An invocation that emitted no error-level diagnostic, could not be
started, or exceeded the timeout is a toolchain failure rather than the model's
fault, reported as [the compilation page](/gg/languages/compilation/) describes.

At run time a failure reaches the model by capture. Nothing in this arm's SDK
intercepts one: the program dies the way its runtime kills it, and the model
reads what the runtime wrote to the standard error `wasm32-wasip1` gives it and
gg's membrane keeps.

A panic writes `std`'s own message, `thread 'main' (1) panicked at
program.rs:6:5:`, in the model's own file at the model's own line and column,
and then aborts, which traps the store; gg shows the trap with that stderr in
front of it. A `main` returning `Err` has `std`'s `Termination` write
`Error: …` before the shell propagates the status, so the turn fails rather
than reporting a program that did nothing. `std::process::exit` is `proc_exit`,
which reaches gg as an `I32Exit` carrying success or failure rather than the
status the program passed. `-Cstrip=symbols` leaves `Location` intact, since it
is static data.

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`rust`, and `code-nothing-shown.hbs` through a clause naming `println!`. The
segment states:

- the reply is compiled verbatim, as a whole Rust program that must define
  `main`, and the `use` lines are the program's to write;
- `main` returns `Result<(), gg::Failure>`, and a failure of the program's own is
  built with `gg::program::message`.

Each entry of the module list beside the segment carries that module's own `use`
line.

`gg::Failure` and `gg::program::message` are the two names any segment writes
that no catalogue carries. Neither binds a capability, so the reflection over the
SDK's capability modules does not report them and a documentation search does not
find them. They are in the segment because a program has no other way to declare
the return type its `main` composes `?` against, or to build a failure of its
own.

The arm names `rustc` as its [checker](/gg/languages/compilation/), so the
shared body states that a program is compiled before it runs, that one `rustc`
refuses is not executed, and that a call the run withheld compiles and fails
when it runs. The library set is carried by a compile failure rather than by the
prompt.

## Healing dialect

These are the lexical answers [healing](/gg/response-healing/) asks this arm
for. A `'` opens a character literal only when one character and a closing `'`
follow it, so `&'static str` is a lifetime and an apostrophe in prose is
punctuation. A string literal may span newlines, and a raw string carries its
own counted fence (`r"…"`, `r#"…"#`, with `b` and `c` prefixes). Rust has no
backtick in its grammar, so a lead-in written as an inline code span is
deletable.
