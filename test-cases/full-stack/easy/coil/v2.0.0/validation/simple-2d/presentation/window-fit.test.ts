/*
 * Coil validator: `presentation.window-fit`. PLACEHOLDER.
 *
 * Window fit.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * Over surfaces wider than the stage, taller than it, and at a raised device
 * pixel ratio, the whole STAGE_W x STAGE_H (1280 x 720) stage is inside the
 * surface, its aspect ratio is preserved, and the letterboxing is even. The
 * fit is read on the first frame before any input.
 *
 * HOW:
 * build the game over several differently shaped surfaces and read back the
 * viewport the build derived, before any input reaches it.
 *
 * MEDIA IT MUST CAPTURE: fit (image).
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

test("presentation.window-fit", () => {
  throw new Error("validator not implemented: presentation/window-fit.test.ts");
});
