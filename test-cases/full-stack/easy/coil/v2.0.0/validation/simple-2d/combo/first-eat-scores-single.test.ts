/*
 * Coil validator: `combo.first-eat-scores-single`. PLACEHOLDER.
 *
 * The first pellet of a round meets a closed window.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The first pellet eaten in a fresh round resolves at an M of 1, because a
 * round opens with the combo window closed.
 *
 * HOW:
 * open a fresh round, place a pellet ahead of the head, eat it, and read the
 * multiplier and the score.
 *
 * MEDIA IT MUST CAPTURE: first (replay).
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

test("combo.first-eat-scores-single", () => {
  throw new Error(
    "validator not implemented: combo/first-eat-scores-single.test.ts",
  );
});
