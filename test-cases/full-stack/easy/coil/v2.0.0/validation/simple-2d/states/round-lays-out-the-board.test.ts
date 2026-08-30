/*
 * Coil validator: `states.round-lays-out-the-board`. PLACEHOLDER.
 *
 * A round opens on the board specs/board.md lays out.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * A round begun from the title opens with the chain at the three starting
 * cells head first, dir right, one live pellet on the board, a score of 0, and
 * M at 1 with a closed window.
 *
 * HOW:
 * start a round from the title and read the chain, the direction, the pellet,
 * the score and the combo back.
 *
 * MEDIA IT MUST CAPTURE: laid (image).
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

test("states.round-lays-out-the-board", () => {
  throw new Error(
    "validator not implemented: states/round-lays-out-the-board.test.ts",
  );
});
