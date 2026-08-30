/*
 * Coil validator: `scoring.best-rises-live`. PLACEHOLDER.
 *
 * BEST rises the instant the score passes it.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * During play, the tick on which the score passes the session best raises the
 * best to the score, rather than waiting for the round to end.
 *
 * HOW:
 * pose a best below the score a single eat will reach, eat, and read the best
 * on that same tick.
 *
 * MEDIA IT MUST CAPTURE: best (replay).
 *
 * It is a COMMON point, decided for every variant.
 *
 * The manifest declares this path, so the file must exist for the version to
 * resolve. It throws rather than passing, so a point whose suite has not been
 * written yet can never be mistaken for a point that passed. Replace the body:
 * pose the scenario through the debug surface alone, clearing everything the
 * claim is not about, run the real systems for a bounded span, assert the one
 * claim above through the shared assertion helpers, and capture the declared
 * media around the drive rather than around the arrangement.
 */
import { test } from "vitest";

test("scoring.best-rises-live", () => {
  throw new Error("validator not implemented: scoring/best-rises-live.test.ts");
});
