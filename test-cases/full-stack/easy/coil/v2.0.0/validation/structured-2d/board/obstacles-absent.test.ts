/*
 * Coil validator: `board.obstacles-absent`. PLACEHOLDER.
 *
 * The interior carries no obstacle.
 *
 * THE CLAIM THIS SUITE DECIDES:
 * After a reset, obstacles is empty, and the head advances safely across every
 * interior cell it is posed on, because this mode places no obstacle cell.
 *
 * HOW:
 * reset, read the obstacle list back, then walk the head across a long
 * interior run and confirm the round is still playing.
 *
 * MEDIA IT MUST CAPTURE: open (image).
 *
 * It is the `base` variant's own point, decided only when that variant runs.
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

test("board.obstacles-absent", () => {
  throw new Error("validator not implemented: board/obstacles-absent.test.ts");
});
