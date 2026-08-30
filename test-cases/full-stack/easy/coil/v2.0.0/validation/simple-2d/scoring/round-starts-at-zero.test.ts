/*
 * Coil validator: `scoring.round-starts-at-zero`. PLACEHOLDER.
 *
 * A fresh round opens at a score of zero.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * Starting a round from the title, or again from the game-over screen, opens
 * it at a score of 0.
 *
 * HOW:
 * play a round to a score, end it, start another, and read the score.
 *
 * MEDIA IT MUST CAPTURE: fresh (image).
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

test("scoring.round-starts-at-zero", () => {
  throw new Error(
    "validator not implemented: scoring/round-starts-at-zero.test.ts",
  );
});
