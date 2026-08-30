/*
 * Coil validator: `scoring.awards-updated-multiplier`. PLACEHOLDER.
 *
 * A pellet scores at the multiplier after the eat.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * An eat resolved at an M of 3 with an open window raises M to 4 and awards 40
 * points, PELLET_POINTS multiplied by the multiplier in force after the eat.
 *
 * HOW:
 * pose M at 3 with an open window and a known score, eat a pellet, and read
 * the multiplier and the points awarded.
 *
 * MEDIA IT MUST CAPTURE: award (replay).
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

test("scoring.awards-updated-multiplier", () => {
  throw new Error(
    "validator not implemented: scoring/awards-updated-multiplier.test.ts",
  );
});
