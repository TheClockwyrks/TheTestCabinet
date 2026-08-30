/*
 * Coil validator: `board.obstacles-fatal`. PLACEHOLDER.
 *
 * An obstacle is fatal like a wall.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The head advancing into an obstacle cell ends the round immediately as a
 * death, exactly as a wall cell does.
 *
 * HOW:
 * pose the head one cell from a course cell and facing it with the pellet
 * cleared, run one tick, and read the screen back.
 *
 * MEDIA IT MUST CAPTURE: obstacle (replay).
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

test("board.obstacles-fatal", () => {
  throw new Error("validator not implemented: board/obstacles-fatal.test.ts");
});
