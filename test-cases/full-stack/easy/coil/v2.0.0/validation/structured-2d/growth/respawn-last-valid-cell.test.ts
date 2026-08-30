/*
 * Coil validator: `growth.respawn-last-valid-cell`. PLACEHOLDER.
 *
 * The last valid cell is still found.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * With the chain posed so that exactly one cell of the valid set
 * specs/board.md defines is left, the next eat places the pellet on that one
 * cell rather than failing or ending the round.
 *
 * HOW:
 * pose a chain covering every valid cell but one, eat the live pellet, and
 * read where the next one landed. The valid set excludes any obstacle the mode
 * lays, so the chain the scenario poses is the mode's, and the suite reads the
 * obstacle list back rather than assuming the interior is open.
 *
 * MEDIA IT MUST CAPTURE: last (image).
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

test("growth.respawn-last-valid-cell", () => {
  throw new Error(
    "validator not implemented: growth/respawn-last-valid-cell.test.ts",
  );
});
