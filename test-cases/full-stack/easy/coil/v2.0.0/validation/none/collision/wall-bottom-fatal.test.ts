/*
 * Coil validator: `collision.wall-bottom-fatal`. PLACEHOLDER.
 *
 * The bottom wall is fatal.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The head advancing into row GRID_ROWS - 1 (17) ends the round immediately as
 * a death.
 *
 * HOW:
 * pose the head on row 16 facing down with the pellet cleared, run one tick,
 * and read the screen back.
 *
 * MEDIA IT MUST CAPTURE: bottom (replay).
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

test("collision.wall-bottom-fatal", () => {
  throw new Error(
    "validator not implemented: collision/wall-bottom-fatal.test.ts",
  );
});
