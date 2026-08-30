/*
 * Coil validator: `visibility.obstacle-apart-from-snake`. PLACEHOLDER.
 *
 * An obstacle stands apart from the snake.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The pixel at an obstacle cell's center is more than 50/441 in RGB distance
 * from the pixels at the head cell and at a body cell, so an obstacle is never
 * mistaken for a segment.
 *
 * HOW:
 * pose the snake beside the course, render, and sample an obstacle cell
 * against the head and a body cell.
 *
 * MEDIA IT MUST CAPTURE: scene (image).
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

test("visibility.obstacle-apart-from-snake", () => {
  throw new Error(
    "validator not implemented: visibility/obstacle-apart-from-snake.test.ts",
  );
});
