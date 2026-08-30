/*
 * Coil validator: `combo.eat-after-lapse-scores-single`. PLACEHOLDER.
 *
 * An eat after the lapse resolves at one.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * A pellet eaten once the window has lapsed resolves at an M of 1 and awards
 * PELLET_POINTS, rather than resuming from the multiplier the round had
 * reached.
 *
 * HOW:
 * raise the multiplier, let the window lapse with the snake held still, then
 * eat and read the multiplier and the points awarded.
 *
 * MEDIA IT MUST CAPTURE: after (replay).
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

test("combo.eat-after-lapse-scores-single", () => {
  throw new Error(
    "validator not implemented: combo/eat-after-lapse-scores-single.test.ts",
  );
});
