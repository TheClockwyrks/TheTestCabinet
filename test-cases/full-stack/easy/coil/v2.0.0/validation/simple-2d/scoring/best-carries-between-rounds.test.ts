/*
 * Coil validator: `scoring.best-carries-between-rounds`. PLACEHOLDER.
 *
 * BEST carries from one round to the next.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * A best earned in one round is still the best when the next round of the same
 * session opens, while the score returns to 0.
 *
 * HOW:
 * reach a best, end the round, start another, and read the best and the score.
 *
 * MEDIA IT MUST CAPTURE: carried (image).
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

test("scoring.best-carries-between-rounds", () => {
  throw new Error(
    "validator not implemented: scoring/best-carries-between-rounds.test.ts",
  );
});
