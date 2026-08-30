/*
 * Coil validator: `growth.respawn-interior`. PLACEHOLDER.
 *
 * A respawned pellet is always an interior cell.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * Across a long run of eats every pellet the game places sits inside the
 * interior specs/board.md fixes: col in [1, 28] and row in [1, 16].
 *
 * HOW:
 * drive a long run of eats and test every cell a pellet landed on against the
 * interior bounds.
 *
 * MEDIA IT MUST CAPTURE: interior (replay).
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

test("growth.respawn-interior", () => {
  throw new Error("validator not implemented: growth/respawn-interior.test.ts");
});
