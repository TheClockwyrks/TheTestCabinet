/*
 * Coil validator: `visibility.head-apart-from-board`. PLACEHOLDER.
 *
 * The head stands apart from the board.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The pixel at the head cell's center is more than 50/441 in RGB distance from
 * an empty interior cell.
 *
 * HOW:
 * pose the snake and the pellet on a known board, render, and sample the head
 * cell against an empty interior cell.
 *
 * MEDIA IT MUST CAPTURE: scene (image).
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

test("visibility.head-apart-from-board", () => {
  throw new Error(
    "validator not implemented: visibility/head-apart-from-board.test.ts",
  );
});
