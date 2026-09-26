// Facet — the suite's assertions. CASE-PROVIDED, over the shared harness.
//
// SHARED FILE. Byte-identical in `validation/none/`, `validation/simple-2d/` and
// `validation/structured-2d/`. A failure a reviewer reads under one engine is
// worded exactly as its counterpart under another, which is what keeps the three
// suites textually parallel. Change it in one place and the other two are wrong.
//
// A RE-EXPORT, AND NOTHING ELSE. Every helper the roughly eighty checks beside
// this file assert through is the shared `@clockwyrks/case-harness` package's,
// staged in beside this file as `./case-harness/`.
//
// WHY THESE RATHER THAN `expect`. Because of where a failure ends up: the runner
// stores each failed check as an expected/actual pair and the console renders
// that pair to the reviewer. A chai message ("expected 12 to be less than or
// equal to 8", trailed by a stack) makes a poor pair; these helpers throw a
// message of exactly the shape the runner extracts —
//
//   Expected: at most 8
//   Actual: 12
//
// — so the reviewer reads the bound the case set beside the value the build
// produced, and nothing else.
//
// Every helper takes an optional trailing `context`: what a check that runs the
// same comparison many times over says to tell one failure from another
// (`cell (3,5): kind`), or what a harness reading names as the requirement the
// build missed. It lands on the `Expected:` line, after the bound, in
// parentheses:
//
//   Expected: "citrine" (cell (3,5): kind)
//   Actual: "ruby"
//
// so the pair stays two lines and the runner still reads it as one.
//
// WHY THE FILE STAYS AT ALL, now that it holds no code. Every suite in this
// directory imports its assertions `from "../assert"`, and that specifier is the
// one thing about them not worth rewriting eighty times over: an assertion is the
// vocabulary a check states its verdict in, not a package a check depends on.
//
// AND WHAT THE OLD HEADER SAID, CORRECTED. This file used to hold a full copy of
// the helpers, and the reason it gave was that the package "is staged only into
// an engineless project" — so that Facet's rule, a suite deciding one review item
// being the SAME TEXT under all three engines, forced `../assert` to be a
// hand-kept copy. THAT IS NO LONGER THE ARRANGEMENT: the package is staged into
// EVERY engine's validator project, so all three of these directories reach it by
// exactly the same relative specifier their suites already use for the harness.
// The copy was checked helper for helper against the package's before it was
// deleted — all twenty-two were identical, and the package carries four more
// besides — so it bought nothing but the chance to drift.
//
// A comparison a check here needs that the package does not carry is COMPOSED
// from the ones it does (a property's presence is `assertHasProperty`; a partial
// object match is `assertEqual` over the fields the check cares about), never
// added here — a helper that lived only in this file would be the drift the
// package exists to end, one file at a time.

export * from "./case-harness/assert";
