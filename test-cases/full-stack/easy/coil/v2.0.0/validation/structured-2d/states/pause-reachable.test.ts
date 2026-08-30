/*
 * Coil validator: `states.pause-reachable`. PLACEHOLDER.
 *
 * A live round pauses.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * back pressed on the playing screen sets screen to paused, with the board
 * still behind it.
 *
 * HOW:
 * start a round, dispatch back, and read the screen.
 *
 * MEDIA IT MUST CAPTURE: paused (image).
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

test("states.pause-reachable", () => {
  throw new Error("validator not implemented: states/pause-reachable.test.ts");
});
