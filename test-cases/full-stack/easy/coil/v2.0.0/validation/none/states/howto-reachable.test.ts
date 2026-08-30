/*
 * Coil validator: `states.howto-reachable`. PLACEHOLDER.
 *
 * How to play is reachable from the title.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * confirm on HOW TO PLAY sets screen to howto.
 *
 * HOW:
 * open the title, highlight HOW TO PLAY, dispatch confirm, and read the
 * screen.
 *
 * MEDIA IT MUST CAPTURE: howto (image).
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

test("states.howto-reachable", () => {
  throw new Error("validator not implemented: states/howto-reachable.test.ts");
});
