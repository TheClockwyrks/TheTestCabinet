/*
 * Coil validator: `controls.menu-highlight-wraps`. PLACEHOLDER.
 *
 * The highlight wraps at the ends.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * down on the last item of a menu returns the highlight to the first, and up
 * on the first returns it to the last.
 *
 * HOW:
 * highlight the last item of a menu, dispatch down, then dispatch up from the
 * first item, reading the highlight each time.
 *
 * MEDIA IT MUST CAPTURE: wrapped (image).
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

test("controls.menu-highlight-wraps", () => {
  throw new Error(
    "validator not implemented: controls/menu-highlight-wraps.test.ts",
  );
});
