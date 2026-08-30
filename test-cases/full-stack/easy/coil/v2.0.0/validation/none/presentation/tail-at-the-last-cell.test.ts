/*
 * Coil validator: `presentation.tail-at-the-last-cell`. PLACEHOLDER.
 *
 * The last cell is drawn with the tail sprite.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * In a chain holding a straight run, the image painted on the last cell of the
 * chain is not the image painted on a middle cell of that run.
 *
 * HOW:
 * pose a straight chain, render a frame, and compare the image painted on the
 * last cell against the one painted on a middle cell.
 *
 * MEDIA IT MUST CAPTURE: tail (image).
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

test("presentation.tail-at-the-last-cell", () => {
  throw new Error(
    "validator not implemented: presentation/tail-at-the-last-cell.test.ts",
  );
});
