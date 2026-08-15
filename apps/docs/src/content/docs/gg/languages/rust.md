---
title: "Rust"
---

This arm does not keep the [invariants](/gg/responses-as-code/invariants/) yet,
and this page states what it does today. gg wraps the reply in a prologue and an
epilogue, declares the entry point itself and refuses a program that declares
`main`, writes `use ::gg::prelude::*;` above the model's first line so every
module is in scope with no line the model wrote, and moves a diagnostic back by
the prologue's line rather than reading a source map.

## Preparation

An agent whose responses-as-code capability names `rust` answers each turn with
a Rust program. The reply is wrapped in a one-line prologue and an epilogue,
written to `program.rs` in the preparation's own workspace, and compiled by one
`rustc` invocation to a `wasm32-unknown-unknown` core module. gg then encodes
that module into a WebAssembly component in process, validating it on the way
out. The component is what the turn evaluates.

This arm has no guest component: `guest_component()` answers `None`, the
compiled bytes ride on the prepared program, and the engine instantiates a fresh
component every turn. The prepared program carries no source.

## Program shape

A program is a sequence of statements, placed inside the body of
`fn __gg_program() -> Result<(), gg::Failure>`. Everything Rust admits in a
function body is admitted where the model wrote it, including `use`, `struct`,
`impl`, `fn`, `mod`, `const` and inner attributes. The prologue around it is
exactly one line, and a test asserts that. It writes
`use ::gg::prelude::*;`, declares the guest type the world is exported on, calls
`gg::program::begin` with the program's file name and the line offset, invokes
the model's body, and expands the `export!` macro that makes the crate a
component. The import is a glob so a program's own `use std::fs;` shadows gg's
module rather than colliding with it.

The epilogue opens with a `;` on its own line so a trailing expression on the
model's last line is a statement, then returns `Ok(())`. Diagnostics are moved
back by the prologue's one line, and no column moves at all.

A program that defines `fn main` is refused as `PrepareError::Unsupported`, at
the line, with a sentence saying to move the work to the top level. Nothing
calls a `main` here, so such a program would report a clean turn having done
nothing. The scan is shallow, matching a line whose own text begins the
definition.

## Toolchain and build artifacts

`rustc` is found at `TCAB_GG_RUSTC`, then `/opt/gg/toolchains/rust/bin`, then
`PATH`. gg sets `RUSTUP_TOOLCHAIN` to the pinned compiler version so a rustup
shim resolves the release the library set was built by. One invocation may take
60 seconds before it is killed and reported as a toolchain failure.

Both invocations pass `--edition 2024`, `--target wasm32-unknown-unknown`,
`-Cpanic=abort`, `-Awarnings` and `--error-format=json`, and name the library
set on `-L dependency=` and `--extern`. A program compiles as a `cdylib` named
`program`, with `-Copt-level=s` and `-Cstrip=symbols`. A code module compiles as
a `lib` with `--emit=metadata`, since everything its author is answerable for is
reported before code generation.

`crates/gg-sandbox-artifacts/rust` generates two artifacts into the build's own
output directory, reached as `GG_ARTIFACTS_RUST`. `rust.libraries.tar.gz` holds
every `.rlib` a program is compiled against, this arm's SDK among them. It is
embedded in the gg binary and unpacked once per machine into a shared read-only
directory, which is this arm's whole warm-up. `rust.toolchain.json` records the
compiler version, the target triple, and which crates are named on `--extern`.

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
declares no function and holds the types the other modules' signatures name. The
prelude re-exports the modules, `ToolError`, `ToolErrorCode`, `Failure` and
`log`, never the types inside a module. Every function carries gg's own key for
the operation it binds, except `shell.shell`, spelled `shell::run`.

- A call is a path, `files::read_file(path, files::ReadOptions::default())?`,
  and this arm's `member_separator` is `::`. Each module owns the types it
  produces, so `files::FileRead` is a path and two modules may declare a type of
  the same name.
- Every call returns `Result<_, ToolError>`, `ToolError` implements
  `std::error::Error`, and its `code` is an enum, so `?` composes a gg call with
  the standard library's own fallible operations.
- One optional argument is an `Option<T>` in that position; two or more are an
  options struct with a `Default`, filled in with functional update. A fixed
  choice is an `enum`, a three-way patch field is an `enum` with a `Default` arm
  (`TextEdit::Keep` / `Clear` / `Set`), a span of turns is a `RangeInclusive`,
  and a read of several shapes is a sum type narrowed by `match`.
- `board::wait_for_issue`, `memories::read_memory`, `views::close`,
  `delegation::send_message` and `programs::get` are also inherent methods on
  the value carrying their one argument, catalogued as aliases that count toward
  no coverage.
- `gg::log` is what the run's operator reads. The target has no standard output,
  so a `print!` is discarded and `views::open_text` is what reaches the model.

### Library set

A program reaches `std` plus five crates: `regex`, `serde_json`, `base64`,
`itertools` and `indexmap`, declared under machine-readable headings in
`packages/gg-sandbox-rust/Cargo.toml`. Both `build.sh` and the catalogue's
library list derive from that one declaration, so what a model is told it may
`use` and what the compile lets it name stay the same list. Only those crates
and the SDK are named on `--extern`; the closure under them is present for
linking and is not a name a program may write.

A crate may enter the set only if it compiles for `wasm32-unknown-unknown` and
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
order, under their own names.

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

A module's preparation compiles it alone, only to check it, and reads the public
items at its top level from the author's own source as the names its namespace
offers. It hands back source, because a module is an input to the program
compile that links it. Each module in scope is written beside the entry file and
declared below the program, where it moves no line of it.

## Failures

Every diagnostic `rustc` produces is `PrepareError::Compile`, since `rustc` has
no parse-only phase and does not mark a diagnostic as a parse failure. A model
is shown at most eight, each rendered with its children. A diagnostic is located
only when its primary span falls inside the model's own lines, after the
one-line offset is subtracted. One earned by gg's wrapper, its epilogue or the
library set is still shown, without a location. An invocation that emitted no
error-level diagnostic, could not be started, or exceeded the timeout is a
toolchain failure rather than the model's fault, reported as
[the compilation page](/gg/languages/compilation/) describes.

At run time the target has no unwinder, so a panic aborts and traps the store,
and a trap alone carries no message or location. `gg::program::begin` installs a
panic hook that completes `feedback.report-error` with the panic's message and
the model's own line and column, out of `std::panic::Location`. A location is
reported only for a panic the hook can place inside the model's own lines, after
the one-line offset is subtracted; a panic earned by gg's wrapper or by another
file is reported with its message alone. The host prefers
what the program reported over the trap that followed it, while a ceiling gg
imposed, such as a timeout, still wins. `-Cstrip=symbols` leaves `Location`
intact, since it is static data.

## Prompt segment

[`system-code.hbs`](/gg/prompts/) reaches this arm through a segment gated on
`rust`, and `code-nothing-shown.hbs` through a clause naming `println!`. The
segment states:

- the reply is the body of a function gg declares, with `use gg::prelude::*;`
  already written above its first line as a glob;
- every call returns `Result<_, ToolError>` and the body returns a `Result`, so
  `?` propagates a failure and a `match` on the `code` branches on one, and a
  failure of the program's own is built with `gg::program::message`;
- a call with one optional argument takes an `Option<T>`, a call with two or
  more takes an options struct with a `Default`, and a module is reached by its
  last segment through the prelude.

`gg::program::message` is the one name any segment writes. It binds no
capability, so no catalogue carries it and a documentation search cannot find
it, and a program that means to fail on its own terms has no other way to build
the failure its body returns.

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
