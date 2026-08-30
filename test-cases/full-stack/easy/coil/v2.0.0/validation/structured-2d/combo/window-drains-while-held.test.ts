/*
 * Coil validator: `combo.window-drains-while-held`. PLACEHOLDER.
 *
 * The window drains while the snake is held.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The window drains by TICK_SECONDS on every tick that resolves, whether or
 * not the snake travels or steers, so a round spent turning nothing still
 * lapses on schedule.
 *
 * HOW:
 * pose a full window with travel and steering off, run the ticks the window is
 * worth, and read it back.
 *
 * MEDIA IT MUST CAPTURE: held (replay).
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

test("combo.window-drains-while-held", () => {
  throw new Error(
    "validator not implemented: combo/window-drains-while-held.test.ts",
  );
});
