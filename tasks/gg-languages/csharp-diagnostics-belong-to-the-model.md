# C# Compile Failures Belong To The Model

A compile failure returned to the model describes the program the model wrote.
Two paths on the C# arm return gg's own failures instead.

## A code module's diagnostic

`csharp.compile.rs` classifies a module compile through `classify()`, which
returns `Program(Syntax|Compile)` or `Toolchain`. The arm never constructs
`PrepareFailure::Lowering`, so a diagnostic in a loaded module reaches the model
as a compile error naming a file it did not write.

The PureScript arm routes this to `Lowering`, and
`apps/docs/src/content/docs/gg/languages/compilation.md` states the rule: a model
is never asked to rewrite a program gg accepted.

## Unlocated Roslyn diagnostics

`is_error` accepts bare unlocated `error CS` lines. `CS2001`, `CS0006` and
`CS2012` describe gg's own arrangement, since gg writes the source file, supplies
every reference and owns the output path. Each becomes `PrepareError::Compile`
and reaches the model as its own failure over a message it cannot act on.

The response file is written without quoting (`csharp.compile.rs`), and Roslyn's
parser splits on whitespace. Paths come from `std::env::temp_dir()` and
`$HOME/.local/share/tcab/gg-dotnet`, so a `TMPDIR` or `$HOME` holding a space
produces exactly those diagnostics on every turn. The run image is safe; a
developer machine is exposed.

## Design

Route a code module's diagnostic to `PrepareFailure::Lowering`.

Classify the arrangement diagnostics as `Toolchain`. Quote the response file's
arguments so a path holding a space reaches Roslyn intact.

## Done when

- [ ] A diagnostic in a loaded module is reported as gg's failure.
- [ ] `CS2001`, `CS0006` and `CS2012` are reported as toolchain failures.
- [ ] The response file quotes its arguments, and a path holding a space compiles.
- [ ] Gates green.
