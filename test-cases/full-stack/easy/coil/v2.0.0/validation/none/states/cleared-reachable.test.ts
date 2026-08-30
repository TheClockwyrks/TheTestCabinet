/*
 * Coil validator: `states.cleared-reachable`. PLACEHOLDER.
 *
 * Clearing the board ends the round on cleared.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * A round in which step 5 finds no valid cell for the next pellet ends on the
 * cleared screen rather than crashing or placing a pellet on an occupied cell.
 *
 * HOW:
 * pose a chain filling every interior cell but the pellet's, eat that pellet,
 * and read the screen.
 *
 * MEDIA IT MUST CAPTURE: cleared (image).
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

test("states.cleared-reachable", () => {
  throw new Error(
    "validator not implemented: states/cleared-reachable.test.ts",
  );
});
