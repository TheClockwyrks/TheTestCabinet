/*
 * Coil validator: `board.pellet-avoids-obstacles`. PLACEHOLDER.
 *
 * A pellet never spawns on the course.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * Across a long run of eats no pellet the game places ever lands on an
 * obstacle cell, so the course counts against the valid set.
 *
 * HOW:
 * drive a long run of eats and test every placed pellet against the obstacle
 * cells.
 *
 * MEDIA IT MUST CAPTURE: avoid (replay).
 *
 * It is the `maze` variant's own point, decided only when that variant runs.
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

test("board.pellet-avoids-obstacles", () => {
  throw new Error(
    "validator not implemented: board/pellet-avoids-obstacles.test.ts",
  );
});
