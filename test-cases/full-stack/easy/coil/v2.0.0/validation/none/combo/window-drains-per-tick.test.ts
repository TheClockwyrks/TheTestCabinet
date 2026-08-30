/*
 * Coil validator: `combo.window-drains-per-tick`. PLACEHOLDER.
 *
 * The window drains a tick's worth each tick.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * Step 6 draws TICK_SECONDS (0.125 s) off the combo window on every tick, so a
 * window posed at 2.0 seconds reads 1.5 after four ticks.
 *
 * HOW:
 * pose a known window with the snake held still, run a counted number of
 * ticks, and read the seconds left.
 *
 * MEDIA IT MUST CAPTURE: drain (replay).
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

test("combo.window-drains-per-tick", () => {
  throw new Error(
    "validator not implemented: combo/window-drains-per-tick.test.ts",
  );
});
