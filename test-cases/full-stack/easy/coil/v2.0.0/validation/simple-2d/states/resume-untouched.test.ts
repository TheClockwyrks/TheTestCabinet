/*
 * Coil validator: `states.resume-untouched`. PLACEHOLDER.
 *
 * Resuming returns the round untouched.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * confirm on RESUME sets screen back to playing with the chain, the direction,
 * the score and the combo window exactly as they stood at the pause.
 *
 * HOW:
 * pause a round mid-play, resume, and compare every field against the values
 * at the pause.
 *
 * MEDIA IT MUST CAPTURE: resumed (replay).
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

test("states.resume-untouched", () => {
  throw new Error("validator not implemented: states/resume-untouched.test.ts");
});
