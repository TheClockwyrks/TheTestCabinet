/*
 * Coil validator: `presentation.head-drawn-from-sprite`. PLACEHOLDER.
 *
 * The head is drawn from a sprite.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * A live frame paints the head cell with an image draw rather than a shape
 * drawn in code.
 *
 * HOW:
 * pose the snake on known cells, render a frame, and confirm an image draw
 * covers the head cell.
 *
 * MEDIA IT MUST CAPTURE: head (image).
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

test("presentation.head-drawn-from-sprite", () => {
  throw new Error(
    "validator not implemented: presentation/head-drawn-from-sprite.test.ts",
  );
});
