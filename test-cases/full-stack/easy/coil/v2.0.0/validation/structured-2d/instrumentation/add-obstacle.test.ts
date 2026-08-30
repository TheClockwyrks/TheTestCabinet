/*
 * Coil validator: `instrumentation.add-obstacle`. PLACEHOLDER.
 *
 * addObstacle lays one fatal cell.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * addObstacle places one obstacle at the named cell, which is then fatal to
 * the head and closed to a pellet spawn exactly as a cell of the laid course
 * is.
 *
 * HOW:
 * clear the course, add one obstacle ahead of the head, read the obstacle list
 * back, and drive the head into it.
 *
 * MEDIA IT MUST CAPTURE: added (replay).
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

test("instrumentation.add-obstacle", () => {
  throw new Error(
    "validator not implemented: instrumentation/add-obstacle.test.ts",
  );
});
