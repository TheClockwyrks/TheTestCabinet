/*
 * Coil validator: `combo.window-lapses-at-28-ticks`. PLACEHOLDER.
 *
 * The window lapses after 28 ticks.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * 28 ticks after an eat the window has run out and M has returned to 1 on the
 * tick it lapsed.
 *
 * HOW:
 * pose a full window at a raised multiplier, run 28 ticks with the snake held
 * still, and read the multiplier and the window.
 *
 * MEDIA IT MUST CAPTURE: lapse (replay).
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

test("combo.window-lapses-at-28-ticks", () => {
  throw new Error(
    "validator not implemented: combo/window-lapses-at-28-ticks.test.ts",
  );
});
