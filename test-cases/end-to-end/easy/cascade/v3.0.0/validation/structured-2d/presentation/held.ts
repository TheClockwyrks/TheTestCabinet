// presentation/held — putting a run already in hand at a chosen place.
//
// Two points in this group need the held run to sit at a KNOWN top-left: one
// asks what the pixels under it are, the other asks what is still visible of the
// pile beside it. Only they need it, so it lives here rather than in the shared
// harness next door, and like everything there it fixes ARRANGEMENT alone.
//
// HOW IT PLACES THE RUN, AND WHY THAT WAY. specs/controls.md has a held run
// follow the pointer, so moving the pointer by a delta moves the run by the same
// delta whatever offset the build kept between the two. The run's own top-left
// is reported by `snapshot().drag`, so the placement is: read where the run is,
// read where the pointer is, and move the pointer by the difference. Nothing
// here assumes the build grabs a card by its corner, by its centre, or by the
// point the press landed on — all three are the build's to choose, and all three
// land the run in the same place under this correction.

import { fail } from "../assert";
import { movePointerTo, type Harness } from "../harness";

/**
 * How far the run's top-left may sit from where it was asked for, in logical
 * units.
 *
 * Not a tolerance on the build's tracking: `handling` is what holds a build to
 * following the pointer. This is room for the fraction of a unit a build may
 * lose rounding its own position, and it is well under the tens of units a run
 * that does not follow the pointer misses by.
 */
const PLACED_TOLERANCE = 1;

/**
 * Move the pointer so the held run's leading card is drawn with its top-left at
 * `(x, y)`, and fail naming specs/controls.md if the run did not go there.
 */
export function placeRun(h: Harness, x: number, y: number): void {
  const before = h.snapshot();
  if (before.drag === null) {
    fail(
      "a run in hand, so it can be placed over the pile this point is about " +
        "(specs/controls.md: a press picks the run up on the press itself)",
      "snapshot().drag is null",
    );
    return;
  }
  movePointerTo(
    h,
    before.pointer.x + (x - before.drag.x),
    before.pointer.y + (y - before.drag.y),
  );

  const after = h.snapshot();
  const landed = after.drag;
  if (
    landed === null ||
    Math.abs(landed.x - x) > PLACED_TOLERANCE ||
    Math.abs(landed.y - y) > PLACED_TOLERANCE
  ) {
    fail(
      `the held run's top-left at (${String(x)}, ${String(y)}) after the ` +
        "pointer was moved by exactly that offset (specs/controls.md: a held " +
        "run follows the pointer)",
      landed === null ? "the run was dropped" : `(${landed.x}, ${landed.y})`,
    );
  }
}
