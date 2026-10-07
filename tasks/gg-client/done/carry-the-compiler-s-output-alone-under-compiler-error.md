# Carry the compiler's output alone under Compiler error

Answer a rejected program with the compiler's own output and nothing else, so a
`Compiler error` message costs the next turn what the compiler said and gg's
processing of that output only ever removes.

## Current state

`compiler_error_body` in `crates/gg/src/agent.code.rs` appends supporting
material to every compile failure on an arm whose catalogue declares a library
set: `supporting` in `crates/gg/src/sandbox/language/diagnostics.rs` renders
the modules of the set that match the imports the diagnostic could not resolve,
or the whole set when it names none, under a `Libraries available to your
program` heading bounded at `diagnostics::SUPPORTING`. A PureScript type error
with no unresolved import is answered with the diagnostic followed by the
everyday group of the set and a closing `… and 184 more like these`, on every
rejection of the run.

The material is gg's, added after the diagnostic. Each arm reads the
unresolved names out of its own compiler's wording through
`ProgramLanguage::unresolved_imports`, `imports.rs` gates that reading per arm,
and the compilation, messages and agent-surface pages, with the per-arm pages,
describe the set as reached through a compile failure.

## Policy

Everything after the `Compiler error` heading is the compiler's output. gg's
processing of that output removes, as the diagnostic caps in `diagnostics.rs`
do, and adds nothing.

## Design

`compiler_error_body` returns the arm's rendered diagnostic. `supporting`,
`candidates`, the matching rule, `SUPPORTING`, `unresolved_imports` on
`ProgramLanguage` and every arm's implementation of it, and the `imports.rs`
gate go, with the tests that assert the material. The diagnostic caps and their
tests stay.

The catalogue's `libraries` section remains the record of an arm's library set,
as `agent-surface.md` describes it.

State the policy on `apps/docs/src/content/docs/gg/languages/compilation.md` in
place of the supporting material section, and bring the `Compiler error` row
and the fault paragraph of `responses-as-code/messages.md`, the language
segment paragraph of `languages/agent-surface.md`, and every per-arm page that
says the set is reached through a compile failure (`cpp.md`, `java.md`,
`kotlin.md`, `purescript.md`, `ruby.md`, `rust.md`, `swift.md`) onto it.

## Done when

- [x] A `Compiler error` message body is the arm's rendered diagnostic alone,
      on every arm.
- [x] The supporting material, its matching, its bound and its gates are
      removed.
- [x] The compilation page states the policy and the pages above describe the
      message as it is.
- [x] Gates green.
