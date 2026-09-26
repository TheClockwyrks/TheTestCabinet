// Arc Foundry — the suite's assertions. CASE-PROVIDED, over the shared harness.
//
// The assertions themselves are the shared validator harness's
// (`@clockwyrks/case-harness`), because what they are FOR is the runner's
// contract rather than this case's: the runner stores each failed check as an
// expected/actual pair and the console renders that pair to the reviewer, so
// every check in every engineless project throws a message of exactly the shape
// the runner extracts —
//
//   Expected: at most 8
//   Actual: 9.097252332435328
//
// — and a case that wrote its own would be restating that contract, while a case
// that drifted from it would report a verdict the console could not render.
//
// Every helper takes an optional trailing `context`: what a check that runs the
// same comparison many times over says to tell one failure from another
// (`obstacle 1 at t=0.5: theta`), or what a harness reading names as the
// requirement the build missed. It lands on the `Expected:` line, after the
// bound, in parentheses, so the pair stays two lines and the runner still reads
// it as one:
//
//   Expected: at most 0.01 (obstacle 1 at t=0.5: theta)
//   Actual: 0.4
//
// This file stays, rather than the suites naming the package, because the suites
// next door say `from "../assert"` and that is the right thing for them to say:
// an assertion is the vocabulary a check states its verdict in, not a package a
// check depends on. Arc Foundry adds none of its own — a comparison that is not
// in the shared set is composed from the ones that are.

export * from "./case-harness/assert";
