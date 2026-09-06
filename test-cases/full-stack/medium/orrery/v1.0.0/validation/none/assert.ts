// Orrery — the suite's assertions. CASE-PROVIDED, over the shared harness.
//
// The assertions themselves are the shared validator harness's
// (`@clockwyrks/case-harness`), because what they are FOR is the runner's
// contract rather than this case's: the runner stores each failed check as an
// expected/actual pair and the console renders that pair to the reviewer, so
// every check in every engineless project throws a message of exactly the shape
// the runner extracts. A case that wrote its own would be restating that
// contract, and a case that drifted from it would report a verdict the console
// could not render.
//
// This file stays because the 1065 suites next door say `from "../assert"`, and
// that is the right thing for them to say: an assertion is the vocabulary a
// check states its verdict in, not a package a check depends on. The two ENGINE
// projects say the same one line over the same package — it is staged into every
// engine's validator project, not only into an engineless one — so a suite
// deciding one review item reads the same names, the same signatures and the
// same message shape whichever project it sits in, which is Orrery's rule.
//
// ONE NOTE ABOUT `assertAngleNear`, WHICH ORRERY BARELY USES. Nothing the
// snapshot reports is an angle: a part's rotation is a `DIRS` index `0` to `5`
// and is read for equality, and the only degrees `specs/` names are the `60 * t`
// a sweep covers (`specs/simulation.md`, Motion and carrying). The helper is
// here for a check that measures an angle off the CANVAS — the bearing of a
// drawn spoke, say — and has to compare it across the wrap.

export * from "./case-harness/assert";
