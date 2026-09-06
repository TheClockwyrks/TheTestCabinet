// Meltdown — the suite's assertions. CASE-PROVIDED, over the shared harness.
//
// A RE-EXPORT, AND NOTHING ELSE. Every helper this project asserts through is the
// shared `@clockwyrks/case-harness` package's, staged in beside this file as
// `./case-harness/`. The package is staged into EVERY engine's validator project
// and not only into an engineless one, so an engine project reaches it by exactly
// the same relative specifier its suites already use for the harness.
//
// WHY THESE RATHER THAN `expect`. Because of where a failure ends up: the runner
// stores each failed check as an expected/actual pair and the console renders
// that pair to the reviewer. A chai message ("expected 9.097… to be less than or
// equal to 8", trailed by a stack) makes a poor pair; these helpers throw a
// message of exactly the shape the runner extracts —
//
//   Expected: at most 8
//   Actual: 9.097252332435328
//
// — so the reviewer reads the bound the case set beside the value the build
// produced, and nothing else.
//
// Every helper takes an optional trailing `context`: what a check that runs the
// same comparison many times over says to tell one failure from another
// (`the Arc at (12, 8): heat`). It lands on the `Expected:` line, after the bound,
// in parentheses, so the pair stays two lines and the runner still reads it as
// one.
//
// A comparison this suite needs that is not in the package is COMPOSED from the
// ones that are (a property's presence is `assertHasProperty`; a partial object
// match is `assertEqual` over the fields the check cares about), never added
// here — a helper that lived only in this file would be the drift the package
// exists to end.
export * from "./case-harness/assert";
