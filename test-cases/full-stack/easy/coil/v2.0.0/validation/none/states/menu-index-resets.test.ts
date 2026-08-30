/*
 * Coil validator: `states.menu-index-resets`. PLACEHOLDER.
 *
 * Arriving at a menu screen highlights its first item.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * menuIndex is 0 on arrival at each of the title, howto, paused, gameover and
 * cleared screens, whatever was highlighted on the screen left behind.
 *
 * HOW:
 * move the highlight off the first item, leave for another menu-bearing
 * screen, and read the highlight on arrival.
 *
 * MEDIA IT MUST CAPTURE: reset (image).
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

test("states.menu-index-resets", () => {
  throw new Error(
    "validator not implemented: states/menu-index-resets.test.ts",
  );
});
