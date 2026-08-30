/*
 * Coil validator: `combo.window-open-at-27-ticks`. PLACEHOLDER.
 *
 * The window is still open after 27 ticks.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * 27 ticks after an eat the window is still open, so a pellet eaten on that
 * tick raises M rather than resetting it.
 *
 * HOW:
 * pose a full window at a known multiplier, run 27 ticks with the snake held
 * still, then eat and read the multiplier.
 *
 * MEDIA IT MUST CAPTURE: open (replay).
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

test("combo.window-open-at-27-ticks", () => {
  throw new Error(
    "validator not implemented: combo/window-open-at-27-ticks.test.ts",
  );
});
