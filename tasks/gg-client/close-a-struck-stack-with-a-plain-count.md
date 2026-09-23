# Close a struck stack with a plain count

Close a stack trace gg has struck frames from with `… and N more frames
(external code)`, so the count line says what was removed in the fewest words.

## Current state

Two sites strike frames a model cannot open from a runtime error's stack and
close the stack with a count. `Locations::rewrite` in
`crates/gg/src/sandbox/locate.rs` strikes frames a source map resolves into
gg's own sources or into text a compiler emitted, and closes with `… and N more
frames, in code this program was compiled into rather than in code it
contains.` The ECMAScript guest in `packages/gg-sandbox/guest/src/lib.rs`
strikes the SDK's and the membrane's frames before the host sees the stack, and
closes with `… and N more frames, inside gg's SDK rather than in code this
program contains.` A PureScript runtime error carries both lines.

Each line spends a sentence on a distinction the model has no use for. The
count is the fact; where the frames were is one word.

## Design

Both sites close with `… and N more frames (external code)`, with `frame` for a
count of one, and the tests that assert the closing line read the new form.
The invariants page under `responses-as-code/` states the closing line's form
beside the rule that a struck frame is counted.

## Done when

- [ ] Both count lines read `… and N more frames (external code)`.
- [ ] The invariants page states the form.
- [ ] Gates green.
