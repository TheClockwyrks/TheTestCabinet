# PureScript Signature Analysis Reads Unicode Spellings

A module's documentation page lists the parameters a signature declares, in
either spelling of the operators PureScript accepts.

## Current behaviour

`crates/gg/src/sandbox/language/purescript.modules.rs` reads a signature through
three functions that recognise the ASCII spelling alone. `arguments` splits on
`->`, `arrow` scans for the byte pair `-` `>`, and `unqualified` splits on `=>`.

PureScript accepts `→` and `⇒` for those operators. A signature spelled with
them reads as declaring no parameters:

```purescript
greet :: forall a. Show a => a -> String   -- lists one parameter
greet :: ∀ a. Show a ⇒ a → String          -- lists none
```

`unqualified` already strips a leading `∀` alongside `forall`, so the arm reads
one part of the Unicode spelling and not the rest.

The under-report is silent. The page shows a shorter signature than the module
declares, with nothing to say the analysis stopped early.

## Design

Teach `arguments`, `arrow` and `unqualified` both spellings of each operator.

## Done when

- [x] A signature spelled with `→` and `⇒` lists the parameters its ASCII twin lists.
- [x] Tests cover each operator in both spellings.
- [x] Gates green.
