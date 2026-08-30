/*
 * Coil validator: `instrumentation.reset-restores`. PLACEHOLDER.
 *
 * reset restores the opening state.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * reset() returns every field the snapshot reports to its opening value: the
 * title screen, menuIndex 0, score and best 0, combo 1 with a closed window,
 * ticks and simTime 0, the starting chain of specs/board.md facing right, an
 * empty turn buffer, no live pellet, and all three driver switches on.
 *
 * HOW:
 * pose a thoroughly disturbed game (a moved snake, a score, a live combo, the
 * switches off), then reset and read every field of the snapshot back.
 *
 * MEDIA IT MUST CAPTURE: reset (image).
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

test("instrumentation.reset-restores", () => {
  throw new Error(
    "validator not implemented: instrumentation/reset-restores.test.ts",
  );
});
