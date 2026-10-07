// Volute — the suite's assertions. CASE-PROVIDED, over the shared harness.
//
// The assertions themselves are the shared validator harness's
// (`@clockwyrks/case-harness`), because what they are FOR is the runner's
// contract rather than this case's: the runner stores each failed check as an
// expected/actual pair and the console renders that pair to the reviewer, so
// every check in every validator project throws a message of exactly the shape
// the runner extracts. A case that wrote its own would be restating that
// contract, and a case that drifted from it would report a verdict the console
// could not render.
//
// The tolerance assertions come with them, and they matter here: this case states
// its tolerances as absolute spans rather than as decimal places — an arc
// position within 0.5 units, an angle within 1 degree, a duration within 2 ticks
// — so `assertNear`, `assertNearFraction`, `assertAngleNear` and `assertEachIn`
// take the span directly and name it in the failure. Every bound a suite passes
// them comes from `constants.ts`, so the pair a reviewer reads is the case's own
// figure beside the build's.
//
// This file stays because the suites next door say `from "../assert"`, and that
// is the right thing for them to say: an assertion is the vocabulary a check
// states its verdict in, not a package a check depends on.

export * from "./case-harness/assert";
