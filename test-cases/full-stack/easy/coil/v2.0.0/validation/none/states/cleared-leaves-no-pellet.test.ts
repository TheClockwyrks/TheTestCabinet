/*
 * Coil validator: `states.cleared-leaves-no-pellet`. PLACEHOLDER.
 *
 * A cleared board carries no pellet.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * The round that ends on the cleared screen leaves pellet at null, because no
 * valid cell was found for the next one.
 *
 * HOW:
 * drive the board-cleared ending and read the snapshot's pellet.
 *
 * MEDIA IT MUST CAPTURE: empty (image).
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

test("states.cleared-leaves-no-pellet", () => {
  throw new Error(
    "validator not implemented: states/cleared-leaves-no-pellet.test.ts",
  );
});
