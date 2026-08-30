/*
 * Coil validator: `hud.combo-shown-from-two`. PLACEHOLDER.
 *
 * The multiplier is drawn from two upward.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * At an M of 3 with an open window the HUD draws the multiplier as x3.
 *
 * HOW:
 * pose M at 3 with an open window, render a live frame, and find the
 * multiplier text draw.
 *
 * MEDIA IT MUST CAPTURE: shown (image).
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

test("hud.combo-shown-from-two", () => {
  throw new Error(
    "validator not implemented: hud/combo-shown-from-two.test.ts",
  );
});
