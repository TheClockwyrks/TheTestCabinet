/*
 * Coil validator: `states.pause-freezes-tick`. PLACEHOLDER.
 *
 * The tick freezes while paused.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * While paused, no tick resolves however much game time passes: ticks, the
 * chain and the combo window are unchanged.
 *
 * HOW:
 * pause a live round with a live combo window, advance far more game time than
 * the window is worth, and compare every field against the pause.
 *
 * MEDIA IT MUST CAPTURE: frozen (replay).
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

test("states.pause-freezes-tick", () => {
  throw new Error(
    "validator not implemented: states/pause-freezes-tick.test.ts",
  );
});
