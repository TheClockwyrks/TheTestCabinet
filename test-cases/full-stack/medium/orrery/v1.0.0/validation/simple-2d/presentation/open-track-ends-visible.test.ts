// presentation/open-track-ends-visible — an open track's first and last cells are
// drawn apart from the cells between them.
//
// THE RULE. "A track's path reads as a path, with its two ends visible while it is
// open" (`specs/parts.md`, Presentation); `specs/assets.md` puts "A track's path,
// its ends, and whether it is closed" among the things the build draws in code.
//
// WHY THE ENDS ARE THE THING TO SEE. They are what the editor acts on — "A press
// on an end cell of an open track begins laying rather than moving"
// (`specs/editor.md`) — and what the simulation faults at: "on an open track
// moving past either end faults" (`specs/parts.md`), `track-end`. A player who
// cannot see which two cells are the ends can neither extend the path nor tell
// where an arm riding it will stop.
//
// THE PATH IS STRAIGHT, WHICH IS WHAT MAKES THE COMPARISON FAIR. Five cells in a
// row along `DIRS[0]`: the three interior cells are translates of one another by
// `HEX_PITCH` along one axis, each with a neighbour of the path on either side, so
// nothing but being an END distinguishes the first and the last from them. A bent
// path would have the corner cells differ from the straight ones for a reason
// `specs/` asks nothing about.
//
// THE BARE FIELD IS THE CONTROL. The same three squares are read on the empty
// field first, and what is required is that laying the track adds a difference
// between an end and the middle — so a build whose FIELD is drawn unevenly across
// those cells is not read as marking its ends, and one whose ends really are
// marked passes whatever the ground under them.
//
// THE VERDICT. Laying the track makes both the first cell and the last differ from
// an interior cell by more than the bare field already did, by at least
// `MIN_DISTINCT_SHARE` of a cell.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { at, hexCenter, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  differingShare,
  openChallengeDocument,
  partById,
  placeTrack,
  type Harness,
  type PixelRect,
} from "../harness";

/** Five cells in a straight run east, so the three interior cells are alike. */
const CELLS: readonly Hex[] = [
  at(-2, 0),
  at(-1, 0),
  at(0, 0),
  at(1, 0),
  at(2, 0),
];

/** The cell the two ends are read against: the middle of the run. */
const MIDDLE = 2;

/** Half the side of the square a cell is read over; inside its own hex. */
const HALF = 18;

/**
 * How much more an end must differ from the middle once the track is laid.
 *
 * Five times the case's figure for a mark being visibly distinct
 * (`editor/a-spent-entry-is-drawn-distinct`'s one percent of a rectangle), and
 * measured as the difference the TRACK added, so a field drawn unevenly under the
 * five cells neither passes this point nor fails it on its own.
 */
const MIN_DISTINCT_SHARE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

function square(hex: Hex): Promise<PixelRect> {
  const centre = hexCenter(hex);
  return h.pixelRect(centre.x - HALF, centre.y - HALF, 2 * HALF, 2 * HALF);
}

/** How far each end's cell is drawn from the middle cell, on the frame that drew. */
async function endsAgainstTheMiddle(): Promise<number[]> {
  const middle = await square(CELLS[MIDDLE] as Hex);
  const first = await square(CELLS[0] as Hex);
  const last = await square(CELLS[CELLS.length - 1] as Hex);
  return [differingShare(first, middle), differingShare(last, middle)];
}

it("draws an open track's two ends apart from its interior cells", async () => {
  await openChallengeDocument(h, BARE);
  await h.advance(1);
  const bare = await endsAgainstTheMiddle();

  const track = await placeTrack(h, CELLS, false);
  // The editor outlines the selected part's cells (`specs/editor.md`), which
  // would mark every cell of the path alike rather than its ends.
  await h.debug.setSelected(null);
  await h.advance(1);
  await captureStill(h, "ends");

  const laid = partById(await h.snapshot(), track);
  assertEqual(
    laid?.closed,
    false,
    "the track is open, which is the state specs/parts.md requires its two ends to be visible in",
  );
  assertEqual(
    laid?.cells?.length,
    CELLS.length,
    "the whole five-cell path is on the field, so the middle cell the ends are read against really has a neighbour on either side",
  );

  const drawn = await endsAgainstTheMiddle();
  for (const [which, name] of [
    [0, "first"],
    [1, "last"],
  ] as const) {
    assertGreaterThan(
      (drawn[which] as number) - (bare[which] as number),
      MIN_DISTINCT_SHARE,
      `laying the track draws its ${name} cell apart from an interior cell, so the ends a lay may start from are read off the field`,
    );
  }
});
