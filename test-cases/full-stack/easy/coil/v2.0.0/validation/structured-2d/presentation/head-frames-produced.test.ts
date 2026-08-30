/*
 * Coil validator: `presentation.head-frames-produced`. PLACEHOLDER.
 *
 * The head sheet ships four frames.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * assets/snake/head/0.png through 3.png all exist, are each CELL x CELL (32 x
 * 32), and each carries non-transparent paint.
 *
 * HOW:
 * read the four head PNGs off the built workspace, check their dimensions from
 * the image header, and count their opaque pixels.
 *
 * MEDIA IT MUST CAPTURE: sheet (image).
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

test("presentation.head-frames-produced", () => {
  throw new Error(
    "validator not implemented: presentation/head-frames-produced.test.ts",
  );
});
