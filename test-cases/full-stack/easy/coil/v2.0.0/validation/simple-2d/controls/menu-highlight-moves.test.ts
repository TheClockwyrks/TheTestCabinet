/*
 * Coil validator: `controls.menu-highlight-moves`. PLACEHOLDER.
 *
 * The highlight moves down the menu.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * down on a menu-bearing screen moves menuIndex on by one item.
 *
 * HOW:
 * open the title on its first item, dispatch down, and read the highlight.
 *
 * MEDIA IT MUST CAPTURE: moved (image).
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

test("controls.menu-highlight-moves", () => {
  throw new Error(
    "validator not implemented: controls/menu-highlight-moves.test.ts",
  );
});
