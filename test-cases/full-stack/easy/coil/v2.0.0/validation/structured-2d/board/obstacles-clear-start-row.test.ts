/*
 * Coil validator: `board.obstacles-clear-start-row`. PLACEHOLDER.
 *
 * The starting row is clear of the course.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * No cell of OBSTACLE_CELLS sits on row 8, the row the snake starts on, so the
 * opening chain has a clear runway ahead of it.
 *
 * HOW:
 * reset, read the obstacle list back, and confirm no cell of it sits on the
 * starting row.
 *
 * MEDIA IT MUST CAPTURE: runway (image).
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

test("board.obstacles-clear-start-row", () => {
  throw new Error(
    "validator not implemented: board/obstacles-clear-start-row.test.ts",
  );
});
