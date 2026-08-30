// Refract — the suite's assertions. CASE-PROVIDED, over the shared harness.
//
// The assertions themselves are the shared validator harness's
// (`@test-cabinet/case-harness`), because what they are FOR is the runner's
// contract rather than this case's: the runner stores each failed check as an
// expected/actual pair and the console renders that pair to the reviewer, so
// every check in every engineless project throws a message of exactly the shape
// the runner extracts. A case that wrote its own would be restating that
// contract, and a case that drifted from it would report a verdict the console
// could not render.
//
// This file stays because the ~80 suites next door say `from "../assert"`, and
// that is the right thing for them to say: an assertion is the vocabulary a
// check states its verdict in, not a package a check depends on.

export * from "./case-harness/assert";
