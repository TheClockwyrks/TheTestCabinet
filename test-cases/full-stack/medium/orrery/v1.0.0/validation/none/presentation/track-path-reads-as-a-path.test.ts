// presentation/track-path-reads-as-a-path — a laid track is drawn joined between
// each pair of cells it runs through.
//
// THE RULE. "A track's path reads as a path, with its two ends visible while it is
// open" (`specs/parts.md`, Presentation); `specs/assets.md` puts "A track's path,
// its ends, and whether it is closed" under "What stays drawn in code".
//
// WHAT A PATH IS. "A `track` is an ordered path of distinct hexes, `cells`, laid
// one hex at a time in the editor. Consecutive cells are adjacent"
// (`specs/parts.md`) — and what an arm mounted on it does is to run along that
// order, "to the next cell of the path" and "to the previous one". So the thing a
// player has to see is which cells run into which: the joins, one per consecutive
// pair, rather than five marks that happen to be near each other.
//
// WHERE A JOIN IS READ. Two adjacent hex centres are `HEX_PITCH` (`48`) apart and
// the edge they share is the perpendicular bisector of that segment, so the
// midpoint between them lies on the boundary the two cells share — which is
// exactly where a path drawn as a run is drawn and where five loose marks are not.
// A `20 x 20` square about that midpoint reaches neither centre.
//
// THE COMPARISON IS AGAINST THE SAME MIDPOINTS, BARE. The empty field is read
// first and the track laid after, so no colour, width, or shape is asked of the
// build — only that the boundary between two consecutive cells is no longer drawn
// as the bare field drew it.
//
// THE PATH BENDS, so the reading is not satisfied by a straight run of marks
// aligned by accident: two of its four joins turn a corner.
//
// THE VERDICT. Every one of the five-cell open track's four consecutive pairs is
// drawn joined, over at least `MIN_JOINED_SHARE` of the square about their shared
// boundary.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan } from "../assert";
import { at, hexCenter, type Hex, type StagePoint } from "../field";
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

/**
 * The five cells the track runs through, bending twice.
 *
 * Each is adjacent to the next by one of the `DIRS` of `specs/field.md`, which is
 * what `specs/parts.md` requires of a legal path, and all five are well inside the
 * field of radius `FIELD_R` (`5`).
 */
const CELLS: readonly Hex[] = [
  at(-2, 0),
  at(-1, 0),
  at(0, 0),
  at(0, 1),
  at(1, 1),
];

/** Half the side of the square a join is read over. */
const HALF = 10;

/** The least share of that square a drawn join must cover. */
const MIN_JOINED_SHARE = 0.05;

/** The point two adjacent cells share an edge at: the midpoint of their centres. */
function joinOf(a: Hex, b: Hex): StagePoint {
  const from = hexCenter(a);
  const to = hexCenter(b);
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

function square(point: StagePoint): Promise<PixelRect> {
  return h.pixelRect(point.x - HALF, point.y - HALF, 2 * HALF, 2 * HALF);
}

it("draws every consecutive pair of a laid track joined along the path", async () => {
  await openChallengeDocument(h, BARE);
  await h.advance(1);

  const bare: PixelRect[] = [];
  for (let index = 1; index < CELLS.length; index += 1) {
    bare.push(
      await square(joinOf(CELLS[index - 1] as Hex, CELLS[index] as Hex)),
    );
  }

  const track = await placeTrack(h, CELLS, false);
  // The editor outlines the selected part's cells (`specs/editor.md`); this point
  // is about the path, not about which part is in hand.
  await h.debug.setSelected(null);
  await h.advance(1);
  await captureStill(h, "track");

  assertDeepEqual(
    partById(await h.snapshot(), track)?.cells,
    CELLS.map((cell) => ({ q: cell.q, r: cell.r })),
    "the track really runs through the five cells in that order, so the joins read are the joins of the path that was laid",
  );

  for (let index = 1; index < CELLS.length; index += 1) {
    const from = CELLS[index - 1] as Hex;
    const to = CELLS[index] as Hex;
    assertGreaterThan(
      differingShare(
        bare[index - 1] as PixelRect,
        await square(joinOf(from, to)),
      ),
      MIN_JOINED_SHARE,
      `the boundary between (${from.q}, ${from.r}) and (${to.q}, ${to.r}) is drawn once the track runs through both, so the path reads as one ordered run of hexes rather than as loose marks`,
    );
  }
});
