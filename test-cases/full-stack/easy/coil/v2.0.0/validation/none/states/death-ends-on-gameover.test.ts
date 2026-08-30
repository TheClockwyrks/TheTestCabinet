/*
 * Coil validator: `states.death-ends-on-gameover`. PLACEHOLDER.
 *
 * A death ends the round on the game-over screen.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The tick on which the head enters a fatal cell sets screen to gameover, with
 * the score the round ended on.
 *
 * HOW:
 * drive a real fatal collision and read the screen and the score.
 *
 * MEDIA IT MUST CAPTURE: gameover (image).
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

test("states.death-ends-on-gameover", () => {
  throw new Error(
    "validator not implemented: states/death-ends-on-gameover.test.ts",
  );
});
