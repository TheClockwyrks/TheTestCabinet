// strait/filled-bay-reads-filled — a filled bay reads as filled, apart from the
// same bay open.
//
// specs/overview.md's legibility table: "a filled bay reads as filled".
// specs/bays.md gives a bay two states — open until a crossing ends in it,
// filled from then until the level is over — and this point is the second of
// them.
//
// WHAT AN OPEN BAY LOOKS LIKE AGAINST THE SHORE IS NOT DECIDED ANYWHERE, and is
// not meant to be: telling one drawn thing from another is appearance, which the
// reviewer's `presentation` rating judges. What a pixel can decide is that
// something was drawn where the specification says something is drawn, and that
// is the whole of this point.
//
// THE COMPARISON IS A BAY AGAINST ITSELF. The same point of the same bay is read
// before and after the bay is filled, so the two pictures differ in the bay's
// state and in nothing else at all — same build, same tile, same frame boundary,
// same everything else on the strait. What is asserted is that the two readings
// DIFFER, and nothing more: no colour, no distance and no share of the mouth
// enters into it, and how a build marks a filled bay is its own.
//
// THE MIDDLE BAY is the one it is read on: neither the leftmost nor the
// rightmost, and its two neighbours of solid shore are both well inside the
// strait rather than against an edge.
//
// THE BAY IS FILLED BY A POSE, NOT BY A CROSSING. What this point grades is how
// a filled bay is DRAWN, and `setBay(index, filled)` sets exactly that one field
// (specs/instrumentation.md) while a crossing that ended in the bay would also
// score, remove the bears and take the critter off the strait. Whether a bay
// fills when it should is `bays/fill-on-entry`, an item of its own.
//
// THE STRAIT IS EMPTIED AND THE CRITTER TAKEN OFF IT, so nothing is standing in
// the mouth when either reading is taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { BAYS, ROW_BAYS, TILE } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  tileCenter,
  type Harness,
} from "../harness";
/**
 * How far inside a tile's edges the pixels are read, in stage units.
 *
 * A build is free to rule the strait, and any such ruling runs along the tile
 * boundaries, so a box that reached the edges would read the ruling rather than
 * the bay. Four units of a `TILE` of `32` leaves a `24 x 24` box per tile.
 */
const INSET = 4;

/**
 * The bay the second half is read on: the middle one, columns `19` and `20`.
 *
 * One bay, because the reading is a comparison of two whole pictures. The middle
 * one is the mouth furthest from either edge of the strait, so a build that
 * clipped or wrapped its shore art at an edge is not what is being read.
 */
const FILLED_BAY = 2;

let open: Harness;
let filled: Harness;

beforeEach(async () => {
  open = await createHarness();
  filled = await createHarness();
});

afterEach(() => {
  open.dispose();
  filled.dispose();
});

/** An emptied strait with nothing standing on it, one frame drawn. */
async function drawEmptyStrait(h: Harness): Promise<void> {
  startCrossing(h);
  h.debug.removeCritter();
  await h.advance(1);
}

/** The device pixels inside tile `(col, ROW_BAYS)`, clear of its edges. */
function tilePixels(h: Harness, col: number): Uint8ClampedArray {
  const half = TILE / 2 - INSET;
  const centre = tileCenter(col, ROW_BAYS);
  const from = h.device(centre.x - half, centre.y - half);
  const to = h.device(centre.x + half, centre.y + half);
  return h.ctx.getImageData(
    from.x,
    from.y,
    Math.max(1, to.x - from.x),
    Math.max(1, to.y - from.y),
  ).data;
}

it("renders a filled bay apart from the same bay open", async () => {
  await drawEmptyStrait(open);

  startCrossing(filled);
  filled.debug.removeCritter();
  filled.debug.setBay(FILLED_BAY, true);
  await filled.advance(1);
  captureStill(filled, "scene");

  let differing = 0;
  for (const col of BAYS[FILLED_BAY]) {
    const before = tilePixels(open, col);
    const after = tilePixels(filled, col);
    for (let i = 0; i < before.length; i += 4) {
      if (
        before[i] !== after[i] ||
        before[i + 1] !== after[i + 1] ||
        before[i + 2] !== after[i + 2]
      ) {
        differing += 1;
      }
    }
  }

  assertGreaterThan(
    differing,
    0,
    `bay ${FILLED_BAY}, columns ${BAYS[FILLED_BAY][0]} and ` +
      `${BAYS[FILLED_BAY][1]}: the pixels of its own mouth that changed when ` +
      `it filled — a filled bay reads as filled (specs/overview.md, ` +
      `specs/bays.md), so something is drawn there that an open bay does not ` +
      `have`,
  );
});
