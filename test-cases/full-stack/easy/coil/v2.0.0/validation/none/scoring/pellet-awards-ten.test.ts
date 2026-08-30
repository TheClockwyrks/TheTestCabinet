/*
 * Coil validator: `scoring.pellet-awards-ten`. PLACEHOLDER.
 *
 * A pellet at one awards ten points.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * An eat resolving at an M of 1 raises the score by exactly PELLET_POINTS
 * (10).
 *
 * HOW:
 * pose a known score with a closed window, eat a pellet, and read the score.
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

test("scoring.pellet-awards-ten", () => {
  throw new Error(
    "validator not implemented: scoring/pellet-awards-ten.test.ts",
  );
});
