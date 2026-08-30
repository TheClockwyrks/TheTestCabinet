/*
 * Coil validator: `states.pause-restart`. PLACEHOLDER.
 *
 * Restarting from the pause menu opens a fresh round.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * confirm on RESTART sets screen to playing with the starting chain, a score
 * of 0, and M at 1.
 *
 * HOW:
 * pause a round that has scored and grown, confirm RESTART, and read the
 * chain, the score and the multiplier.
 *
 * MEDIA IT MUST CAPTURE: restarted (image).
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

test("states.pause-restart", () => {
  throw new Error("validator not implemented: states/pause-restart.test.ts");
});
