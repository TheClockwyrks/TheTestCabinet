# Bound Compiler Error Output

A compile failure returns the compiler's diagnostics and a bounded amount of
supporting material. Every arm holds to the same bound.

## Current behaviour

`compiler_error_body` (`crates/gg/src/agent.code.rs`) appends an arm's library
set to a compile failure where its catalogue declares one. Measured on the
context messages of a PureScript run, a compile failure grows from 124 bytes to
roughly 5,010 bytes, and close to all of the addition is a flat alphabetical list
of module names. It is resent in full on every compile failure.

C# adds roughly four times its diagnostic. TypeScript declares no library set and
adds nothing.

## Design

Return the diagnostics. Where a diagnostic names an unresolved import, return the
candidates that match it rather than the whole library set.

Hold every arm to one bound on the supporting material a failure may carry, so
the per-failure cost of a compile error is comparable across arms.

## Done when

- [x] A compile failure carries diagnostics and matched candidates.
- [x] One bound on supporting material applies to every arm.
- [x] A gate asserts the bound holds for each arm that declares a library set.
- [x] Gates green.
