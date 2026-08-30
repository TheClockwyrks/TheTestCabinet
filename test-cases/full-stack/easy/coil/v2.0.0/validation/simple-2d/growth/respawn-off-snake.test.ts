/*
 * Coil validator: `growth.respawn-off-snake`. PLACEHOLDER.
 *
 * A respawned pellet never lands on the snake.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * Across a long run of eats no pellet the game places ever occupies a cell the
 * chain holds.
 *
 * HOW:
 * drive a long run of eats against a deliberately long chain and test every
 * placed pellet against the chain's cells.
 *
 * MEDIA IT MUST CAPTURE: clear (replay).
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

test("growth.respawn-off-snake", () => {
  throw new Error(
    "validator not implemented: growth/respawn-off-snake.test.ts",
  );
});
