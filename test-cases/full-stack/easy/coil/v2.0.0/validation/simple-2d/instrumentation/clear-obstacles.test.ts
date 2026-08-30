/*
 * Coil validator: `instrumentation.clear-obstacles`. PLACEHOLDER.
 *
 * clearObstacles empties the course.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * clearObstacles leaves obstacles empty and the cleared cells ordinary: the
 * head crosses one safely and a pellet may spawn on it, while the wall border
 * is untouched.
 *
 * HOW:
 * clear the course, read the obstacle list back, then walk the head through a
 * cell the course held and confirm the round is still playing.
 *
 * MEDIA IT MUST CAPTURE: cleared (image).
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

test("instrumentation.clear-obstacles", () => {
  throw new Error(
    "validator not implemented: instrumentation/clear-obstacles.test.ts",
  );
});
