/*
 * Coil validator: `combo.window-reopens-on-eat`. PLACEHOLDER.
 *
 * An eat reopens the window in full.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * An eat sets the combo window back to a full COMBO_WINDOW (3.5 seconds)
 * whatever was left on it.
 *
 * HOW:
 * pose a nearly spent window, eat a pellet, and read the seconds left on the
 * window.
 *
 * MEDIA IT MUST CAPTURE: reopen (replay).
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

test("combo.window-reopens-on-eat", () => {
  throw new Error(
    "validator not implemented: combo/window-reopens-on-eat.test.ts",
  );
});
