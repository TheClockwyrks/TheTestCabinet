// presentation/open-track-ends-visible — an open track's first and last cells are
// drawn differently from the way the same cell is drawn in a path's interior.
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
// ONE SQUARE, TWO POSES, WHICH IS WHAT MAKES THE READING FAIR. Two hexes far
// enough apart that neither reaches the other are read twice over. In the first
// pose a straight five-cell path along `DIRS[0]` puts each of them at an END of
// the path; in the second a straight seven-cell path along the same axis runs one
// cell further either way, so the same two hexes are INTERIOR cells with a
// neighbour of the path on both sides. Nothing else about either hex moved: the
// same cell, at the same stage position, on the same field, carrying a path in
// both poses. What can differ is whether the build marks an end.
//
// NOTHING IS ASKED OF HOW. `specs/ui.md` fixes no palette and `specs/` fixes no
// mark, so what is read is that the square CHANGED — a cap, a stub, a different
// outline, a lighter fill all pass, and how good the mark looks is the reviewer's.
//
// THE SELECTION IS CLEARED IN BOTH POSES, because "the selected part's cells" are
// outlined by the editor (`specs/editor.md`), which would mark every cell of a
// path alike rather than its ends.
//
// THE VERDICT. Each of the two hexes is drawn differently as an end of a path than
// as a cell inside one.

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

/** Five cells in a straight run east; the first and the last are its two ends. */
const ENDED: readonly Hex[] = [
  at(-2, 0),
  at(-1, 0),
  at(0, 0),
  at(1, 0),
  at(2, 0),
];

/** The same run one cell longer either way, so those two cells are interior. */
const CARRIED: readonly Hex[] = [
  at(-3, 0),
  at(-2, 0),
  at(-1, 0),
  at(0, 0),
  at(1, 0),
  at(2, 0),
  at(3, 0),
];

/** The two hexes read, which are `ENDED`'s ends and `CARRIED`'s interior cells. */
const READ: readonly Hex[] = [at(-2, 0), at(2, 0)];

/** Half the side of the square a cell is read over; inside its own hex. */
const HALF = 18;

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

/**
 * Lay one straight path, clear the selection, and read the two hexes' squares.
 *
 * `capture` names the output under the pose the point is about — the path whose
 * ends are the hexes read — and is null under the pose that carries them.
 */
async function laid(
  cells: readonly Hex[],
  capture: string | null,
): Promise<PixelRect[]> {
  await h.debug.clearMachine();
  const track = await placeTrack(h, cells, false);
  await h.debug.setSelected(null);
  await h.advance(1);
  if (capture !== null) await captureStill(h, capture);

  const path = partById(await h.snapshot(), track);
  assertEqual(
    path?.closed,
    false,
    "the track is open, which is the state specs/parts.md requires its two ends to be visible in",
  );
  assertEqual(
    path?.cells?.length,
    cells.length,
    "the whole path is on the field, so each hex read carries the neighbours this pose gives it",
  );

  const read: PixelRect[] = [];
  for (const hex of READ) read.push(await square(hex));
  return read;
}

it("draws an open track's two ends apart from a cell inside a path", async () => {
  await openChallengeDocument(h, BARE);
  await h.advance(1);

  const ends = await laid(ENDED, "ends");
  const inside = await laid(CARRIED, null);

  for (const [index, hex] of READ.entries()) {
    assertGreaterThan(
      differingShare(ends[index] as PixelRect, inside[index] as PixelRect),
      0,
      `(${hex.q}, ${hex.r}) is drawn differently as an end of the path than as a cell inside one, so the ends a lay may start from are read off the field`,
    );
  }
});
