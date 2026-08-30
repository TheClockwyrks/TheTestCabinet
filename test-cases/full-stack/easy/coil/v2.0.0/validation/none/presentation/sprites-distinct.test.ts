/*
 * Coil validator: `presentation.sprites-distinct`. PLACEHOLDER.
 *
 * The body, corner and tail sprites differ.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The straight, corner and tail sprites are three different images: each pair
 * differs on a measurable share of its pixels, so one sprite has not been
 * shipped three times.
 *
 * HOW:
 * decode the three body PNGs and compare every pair pixel for pixel.
 *
 * MEDIA IT MUST CAPTURE: sprites (image).
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

test("presentation.sprites-distinct", () => {
  throw new Error(
    "validator not implemented: presentation/sprites-distinct.test.ts",
  );
});
