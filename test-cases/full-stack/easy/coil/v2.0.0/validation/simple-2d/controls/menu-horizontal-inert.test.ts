/*
 * Coil validator: `controls.menu-horizontal-inert`. PLACEHOLDER.
 *
 * Left and right do nothing on a menu.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * left and right on a menu-bearing screen leave menuIndex and the screen
 * unchanged.
 *
 * HOW:
 * open a menu, dispatch left and right, and read the highlight and the screen.
 *
 * MEDIA IT MUST CAPTURE: inert (image).
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

test("controls.menu-horizontal-inert", () => {
  throw new Error(
    "validator not implemented: controls/menu-horizontal-inert.test.ts",
  );
});
