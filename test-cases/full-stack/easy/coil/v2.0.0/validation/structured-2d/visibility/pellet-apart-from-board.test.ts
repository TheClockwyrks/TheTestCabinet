/*
 * Coil validator: `visibility.pellet-apart-from-board`. PLACEHOLDER.
 *
 * The pellet stands apart from the board.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The pixel at the pellet cell's center is more than 50/441 in RGB distance
 * from an empty interior cell.
 *
 * HOW:
 * place the pellet on a known cell, render, and sample it against an empty
 * interior cell.
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

test("visibility.pellet-apart-from-board", () => {
  throw new Error(
    "validator not implemented: visibility/pellet-apart-from-board.test.ts",
  );
});
