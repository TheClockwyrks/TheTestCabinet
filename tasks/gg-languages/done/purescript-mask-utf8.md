# PureScript Code Mask Handles Non-ASCII

`code_mask` in `crates/gg/src/sandbox/language/purescript.mask.rs` walks a source
by byte index and re-slices `src[index..]` to test for `{-` and `-}`. A
multi-byte character inside a block comment panics the scan.

The mask lexes author-supplied code modules so that
`crates/gg/src/sandbox/language/purescript.modules.rs` can list a module's
exports on its documentation page. It runs when a skill or memory is loaded.

A panic here reaches `prepare_module` and ends the run.

## Design

Walk characters rather than bytes, or test the byte pair directly instead of
re-slicing. The mask records one entry per byte, so the fix keeps byte-indexed
output while making every index a character boundary.

Cover the same shapes the arm already tests, with non-ASCII text in each: a
leading block comment, a nested block comment, a string, and a raw string.

## Done when

- [x] A code module carrying non-ASCII text in a comment or string lexes cleanly.
- [x] Tests cover non-ASCII text in each of the four lexer modes.
- [x] Gates green.
