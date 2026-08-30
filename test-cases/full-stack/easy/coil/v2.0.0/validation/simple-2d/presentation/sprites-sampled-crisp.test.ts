/*
 * Coil validator: `presentation.sprites-sampled-crisp`. PLACEHOLDER.
 *
 * The sprites are sampled without smoothing.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The sprites are painted with image smoothing off, so the produced pixel art
 * stays sharp at every scale the stage is fitted to.
 *
 * HOW:
 * render a live frame and read the smoothing state in force at each image draw
 * that paints a snake cell.
 *
 * MEDIA IT MUST CAPTURE: crisp (image).
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

test("presentation.sprites-sampled-crisp", () => {
  throw new Error(
    "validator not implemented: presentation/sprites-sampled-crisp.test.ts",
  );
});
