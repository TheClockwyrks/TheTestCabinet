// Kessler — the suite's assertions. CASE-PROVIDED, over the shared harness.
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
// The tolerance assertions come with them, and they matter here: this case
// states its tolerances as absolute spans rather than as decimal places — a
// radius within 0.5 units, an angle within 1 degree, a timer within 2 ticks — so
// `assertCloseTo` and `assertBetween` take the span directly and name it in the
// failure. Every bound a suite passes them comes from `constants.ts`, so the
// pair a reviewer reads is the case's own figure beside the build's.
//
// This file stays because the suites next door say `from "../assert"`, and that
// is the right thing for them to say: an assertion is the vocabulary a check
// states its verdict in, not a package a check depends on.

export * from "./case-harness/assert";

import { fail } from "./case-harness/assert";

/**
 * Calling `run` fails LOUDLY: it throws, or the promise it returns rejects.
 *
 * `specs/instrumentation.md` has no operation refuse quietly — "a call the
 * field has no state for ... fails loudly rather than passing quietly, so a
 * caller never reads a call that did nothing as a call that did" — so a check
 * whose requirement is that the game had nothing to act on grades a THROWN
 * error, and reads the unchanged field beside it rather than instead of it. A
 * build that returned quietly is the defect this catches.
 */
export async function assertFailsLoudly(
  run: () => unknown,
  context: string,
): Promise<void> {
  try {
    await run();
  } catch {
    return;
  }
  fail(`a thrown error — ${context}`, "the call returned, changing nothing");
}
