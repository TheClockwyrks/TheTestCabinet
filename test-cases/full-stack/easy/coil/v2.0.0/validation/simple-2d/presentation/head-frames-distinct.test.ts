/*
 * Coil validator: `presentation.head-frames-distinct`. PLACEHOLDER.
 *
 * The four head frames differ from one another.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * No two of the four head frames are the same image: each pair differs on a
 * measurable share of its pixels, so the sheet is four poses rather than one
 * frame repeated.
 *
 * HOW:
 * decode the four head PNGs and compare every pair pixel for pixel.
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

test("presentation.head-frames-distinct", () => {
  throw new Error(
    "validator not implemented: presentation/head-frames-distinct.test.ts",
  );
});
