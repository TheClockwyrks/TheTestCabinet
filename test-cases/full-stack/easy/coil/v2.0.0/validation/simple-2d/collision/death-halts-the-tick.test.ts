/*
 * Coil validator: `collision.death-halts-the-tick`. PLACEHOLDER.
 *
 * A fatal tick runs no further steps.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * On the tick the head enters a fatal cell, steps 4 to 6 do not run: the chain
 * is exactly as it was, the score is unchanged, and the combo window has not
 * drained.
 *
 * HOW:
 * pose a live combo window and a head one cell from a wall, run the fatal
 * tick, and compare the chain, the score and the window against the values
 * before it.
 *
 * MEDIA IT MUST CAPTURE: halted (replay).
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

test("collision.death-halts-the-tick", () => {
  throw new Error(
    "validator not implemented: collision/death-halts-the-tick.test.ts",
  );
});
