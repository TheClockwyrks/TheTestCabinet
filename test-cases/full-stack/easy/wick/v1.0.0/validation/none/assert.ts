// Wick — the suite's assertions. CASE-PROVIDED, over the shared harness.
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
// position within `1e-6` units, a timer within `1e-6` seconds, a drawn sprite
// within one unit — so `assertNear`, `assertNearFraction`, `assertAngleNear`
// and `assertEachIn` take the span directly and name it in the failure. Every
// bound a suite passes them comes from `constants.ts`, so the pair a reviewer
// reads is the case's own figure beside the build's.
//
// One assertion is this case's own. Every operation on `window.__wick` crosses
// into the page, so a call the specification says "throws" REJECTS on this
// side, and the shared `assertThrows` is synchronous. `assertRejects` is that
// helper for a promise, throwing the same two-line pair the others do.
//
// This file stays because the suites next door say `from "../assert"`, and that
// is the right thing for them to say: an assertion is the vocabulary a check
// states its verdict in, not a package a check depends on.

import { fail } from "./case-harness/assert";

export * from "./case-harness/assert";

/**
 * Calling `run` rejects, as an operation handed an argument outside its domain
 * must ("the call throws rather than guessing what was meant",
 * specs/instrumentation.md).
 */
export async function assertRejects(
  run: () => Promise<unknown>,
  context?: string,
): Promise<void> {
  try {
    await run();
  } catch {
    return;
  }
  fail(
    context === undefined ? "a thrown error" : `a thrown error (${context})`,
    "no error thrown",
  );
}

/** Calling `run` resolves without rejecting. */
export async function assertResolves(
  run: () => Promise<unknown>,
  context?: string,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    fail(
      context === undefined
        ? "no thrown error"
        : `no thrown error (${context})`,
      error instanceof Error ? error.message : error,
    );
  }
}
