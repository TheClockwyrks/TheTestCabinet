/*
 * Coil validator: `movement.advances-in-real-time`. PLACEHOLDER.
 *
 * The game advances itself in real time.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * On a real wall clock, with nothing stepping the game from outside, a live
 * round advances: simTime rises and the head cell changes over a stretch of
 * real time.
 *
 * HOW:
 * hand the build a real wall clock, start a round, let the loop run itself for
 * a stretch of real time, and confirm the head moved.
 *
 * MEDIA IT MUST CAPTURE: before (image), after (image).
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

test("movement.advances-in-real-time", () => {
  throw new Error(
    "validator not implemented: movement/advances-in-real-time.test.ts",
  );
});
