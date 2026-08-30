/*
 * Coil validator: `presentation.corner-at-a-bend`. PLACEHOLDER.
 *
 * A bend is drawn with the corner sprite.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * In a chain holding both a straight run and a bend, the image painted on the
 * bend cell is not the image painted on the straight cell.
 *
 * HOW:
 * pose a chain that runs straight and then turns, render a frame, and compare
 * the image painted on the bend against the one painted on the straight run.
 *
 * MEDIA IT MUST CAPTURE: bend (image).
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

test("presentation.corner-at-a-bend", () => {
  throw new Error(
    "validator not implemented: presentation/corner-at-a-bend.test.ts",
  );
});
