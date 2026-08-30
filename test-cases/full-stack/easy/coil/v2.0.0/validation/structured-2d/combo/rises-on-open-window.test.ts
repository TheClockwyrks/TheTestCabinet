/*
 * Coil validator: `combo.rises-on-open-window`. PLACEHOLDER.
 *
 * The multiplier rises on an eat inside the window.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * An eat resolved while the combo window is open raises M by exactly one.
 *
 * HOW:
 * pose M at 2 with a part-spent window, place a pellet ahead of the head, eat
 * it, and read the multiplier.
 *
 * MEDIA IT MUST CAPTURE: rise (replay).
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

test("combo.rises-on-open-window", () => {
  throw new Error(
    "validator not implemented: combo/rises-on-open-window.test.ts",
  );
});
