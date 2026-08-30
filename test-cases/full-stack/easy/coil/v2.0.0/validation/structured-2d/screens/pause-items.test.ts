/*
 * Coil validator: `screens.pause-items`. PLACEHOLDER.
 *
 * The pause screen draws its menu.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The paused frame draws every item of PAUSE_ITEMS: RESUME, RESTART and MENU.
 *
 * HOW:
 * pause a live round, read the frame's text draws, and capture the pause menu.
 *
 * MEDIA IT MUST CAPTURE: pause (image).
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

test("screens.pause-items", () => {
  throw new Error("validator not implemented: screens/pause-items.test.ts");
});
