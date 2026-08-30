/*
 * Coil validator: `board.obstacles-layout`. PLACEHOLDER.
 *
 * The board carries the fixed obstacle course.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * After a reset, obstacles is exactly the eighteen cells of OBSTACLE_CELLS,
 * the four bars specs/mode.md fixes, and none of them changes while the round
 * runs.
 *
 * HOW:
 * reset, read the obstacle list back as a set, compare it against the eighteen
 * cells, then run a stretch of play and read it again.
 *
 * MEDIA IT MUST CAPTURE: layout (image).
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

test("board.obstacles-layout", () => {
  throw new Error("validator not implemented: board/obstacles-layout.test.ts");
});
