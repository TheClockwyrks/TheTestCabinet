// Orrery — the suite's assertions. CASE-PROVIDED, over the shared harness.
//
// A RE-EXPORT, AND NOTHING ELSE. Every check in every one of Orrery's validator
// projects asserts through the shared validator harness's helpers
// (`@clockwyrks/case-harness`, staged beside this file as `./case-harness/`)
// rather than through vitest's `expect`, because of where a failure ends up: the
// runner stores each failed check as an expected/actual pair and the console
// renders that pair to the reviewer. A chai message ("expected 9.097… to be less
// than or equal to 8", trailed by a stack) makes a poor pair; the package's
// helpers throw a message of exactly the shape the runner extracts —
//
//   Expected: at most 8
//   Actual: 9.097252332435328
//
// — so the reviewer reads the bound the case set beside the value the build
// produced, and nothing else. That shape is the RUNNER's contract rather than
// this case's, which is why the vocabulary is not a case's to own: a case that
// wrote its own would be restating it, and one that drifted from it would report
// a verdict the console could not render.
//
// THIS FILE STAYS BECAUSE THE SUITES NEXT DOOR SAY `from "../assert"`, and that
// is the right thing for them to say: an assertion is the vocabulary a check
// states its verdict in, not a package a check depends on.
//
// AND IT IS ONE LINE IN ALL THREE PROJECTS, which is what Orrery's own rule
// wants. A suite deciding one review item is the SAME TEXT under all three
// engines, so `../assert` has to resolve to the same names, the same signatures
// and the same message shape whichever project a suite sits in — and three
// re-exports of one file satisfy that better than three copies of it could. The
// package is staged into EVERY engine's validator project, not only into an
// engineless one: `stage_case_harness` is called unconditionally from
// `stage_project` in `crates/core/src/vitest_validator.rs`, so
// `./case-harness/assert` resolves here exactly as it does under `none`.
//
// Every helper takes an optional trailing `context`: what a check that runs the
// same comparison many times over says to tell one failure from another
// (`part 2 at cycle 3: rotation`), or what a harness reading names as the
// requirement the build missed. It lands on the `Expected:` line, after the
// bound, in parentheses:
//
//   Expected: at most 0.01 (mote 4 at t=5/8: separation)
//   Actual: 0.4
//
// so the pair stays two lines and the runner still reads it as one.
//
// A comparison a suite needs that the package does not carry is COMPOSED from the
// ones it does (a property's presence is `assertHasProperty`; a partial object
// match is `assertEqual` over the fields the check cares about), never added
// here — a helper that lived only in this file would be exactly the drift the
// package exists to end.
export * from "./case-harness/assert";
