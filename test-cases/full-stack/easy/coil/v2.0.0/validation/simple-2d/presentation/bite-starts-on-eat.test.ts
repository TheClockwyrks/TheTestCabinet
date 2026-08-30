/*
 * Coil validator: `presentation.bite-starts-on-eat`. PLACEHOLDER.
 *
 * The head bites when the snake eats.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * On the ticks after a pellet is eaten the head cell is painted with an image
 * other than the resting frame, so the bite plays.
 *
 * HOW:
 * record the image painted on the head cell over the ticks around an eat and
 * compare it against the resting frame.
 *
 * MEDIA IT MUST CAPTURE: bite (replay).
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

test("presentation.bite-starts-on-eat", () => {
  throw new Error(
    "validator not implemented: presentation/bite-starts-on-eat.test.ts",
  );
});
