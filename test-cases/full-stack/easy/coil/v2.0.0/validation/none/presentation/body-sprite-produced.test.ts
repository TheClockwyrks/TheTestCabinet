/*
 * Coil validator: `presentation.body-sprite-produced`. PLACEHOLDER.
 *
 * The straight body sprite is produced.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * assets/snake/body.png exists, is CELL x CELL (32 x 32), and carries
 * non-transparent paint.
 *
 * HOW:
 * read the body PNG off the built workspace, check its dimensions, and count
 * its opaque pixels.
 *
 * MEDIA IT MUST CAPTURE: sprite (image).
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

test("presentation.body-sprite-produced", () => {
  throw new Error(
    "validator not implemented: presentation/body-sprite-produced.test.ts",
  );
});
