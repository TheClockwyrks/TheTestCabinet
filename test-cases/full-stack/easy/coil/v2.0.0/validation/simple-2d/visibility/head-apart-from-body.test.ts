/*
 * Coil validator: `visibility.head-apart-from-body`. PLACEHOLDER.
 *
 * The head stands apart from the body.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The pixel at the head cell's center is more than 50/441 in RGB distance from
 * the pixel at a body cell's center, so the leading cell is never mistaken for
 * a segment.
 *
 * HOW:
 * pose a chain several cells long, render, and sample the head cell against a
 * middle body cell.
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

test("visibility.head-apart-from-body", () => {
  throw new Error(
    "validator not implemented: visibility/head-apart-from-body.test.ts",
  );
});
