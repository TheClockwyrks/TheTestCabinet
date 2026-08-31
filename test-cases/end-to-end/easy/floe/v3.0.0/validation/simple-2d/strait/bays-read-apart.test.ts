// strait/bays-read-apart — an open bay reads as an opening in the far shore, and a
// filled one reads as filled.
//
// specs/overview.md's visual-design table: "An open bay reads as an opening in the
// far shore, distinct from the solid shore beside it, and a filled bay reads as
// filled." specs/strait.md puts the five two-column mouths in row `1` and makes
// every other column of that row solid far shore; specs/bays.md makes a bay open
// until a crossing ends in it and filled from then until the level is over.
//
// TWO READINGS, ONE REQUIREMENT EACH.
//
//   1. AN OPEN BAY AGAINST THE SHORE BESIDE IT. Read at the mouth's own centre —
//      the seam between the bay's two columns, which is a whole tile from either
//      end of the mouth and so the reading furthest from the solid shore on either
//      side — and against the tile of solid shore on each side of it. Both sides
//      are read separately, so a build that shaded one edge of its shore cannot
//      borrow that shading to clear the bar on the other.
//   2. A FILLED BAY AGAINST ITSELF, OPEN. The same point of the same bay, read
//      before and after the bay is filled, so the two pictures differ in the bay's
//      state and in nothing else at all — same build, same tile, same frame
//      boundary, same everything else on the strait.
//
// WHAT IS READ IS A DISTANCE, NEVER A COLOUR. Floe fixes no palette; every reading
// is between two things the build itself drew.
//
// BAY `2` (columns `19`, `20`) is the one read: the middle bay, so neither the
// leftmost nor the rightmost, and its two neighbours of solid shore (columns `18`
// and `21`) are both well inside the strait rather than against an edge.
//
// THE BAY IS FILLED BY A POSE, NOT BY A CROSSING. What this point grades is how a
// filled bay is DRAWN, and `setBay(index, filled)` sets exactly that one field
// (specs/instrumentation.md) while a crossing that ended in the bay would also
// score, remove the bears and take the critter off the strait. Whether a bay fills
// when it should is `bays/fill-on-entry`, an item of its own.
//
// THE STRAIT IS EMPTIED AND THE CRITTER TAKEN OFF IT, so nothing is standing in
// the mouth or on the shore when either reading is taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleColor,
  startCrossing,
  type Harness,
  type Rgb,
} from "../harness";
import { BAY_PAIRS, ROW_BAYS, bandColor, bayMouthX, mapCY } from "./harness";

/**
 * How far an open bay must read from the solid shore beside it, as an RGB distance
 * out of about `441`.
 *
 * The item's own figure: `60` is about a seventh of the cube's longest diagonal.
 * It is higher than the `40` the five BANDS are held to
 * (`strait/bands-read-apart`) because a bay is a two-tile notch cut into the band
 * beside it rather than a band-sized expanse — a player has to pick it out of the
 * shore at a glance while aiming a hop at it, and a separation that reads between
 * two large expanses does not read between a small one and its surround.
 */
const BAY_APART_MIN = 60;

/**
 * How far a filled bay must read from the same bay open, as an RGB distance.
 *
 * The item asks only that a filled bay render DIFFERENTLY from an open one —
 * specs/overview.md asks that it "reads as filled", not that it contrast with the
 * shore the way an open mouth must — so this bar is deliberately the lower one.
 * `20` is about a twenty-second of the cube's longest diagonal: far above the two
 * or three units a build's own dithering, texture or one frame of drift can move a
 * flat reading by, and low enough that a build which marks a filled bay with the
 * critter resting in it, a plug of ice, or a change of tint clears it easily. A
 * build that draws a filled bay exactly as it draws an open one reads `0`.
 */
const FILLED_DIFFERS_MIN = 20;

/** The bay read: the middle of the five (specs/strait.md). */
const BAY = 2;

/** The two columns of solid far shore either side of that bay's mouth. */
const SHORE_COLUMNS: readonly { col: number; side: string }[] = [
  { col: BAY_PAIRS[BAY][0] - 1, side: "to its left" },
  { col: BAY_PAIRS[BAY][1] + 1, side: "to its right" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws an open bay apart from the shore beside it, and a filled bay apart from an open one", async () => {
  // An emptied, live strait with nothing on it at all, and all five bays open
  // (specs/bays.md: a level opens with every bay open).
  startCrossing(h);
  h.debug.removeCritter();
  await h.advance(1);

  const mouthX = bayMouthX(BAY_PAIRS[BAY]);
  const mouthY = mapCY(ROW_BAYS);
  const open = sampleColor(h, mouthX, mouthY);
  const shore: { side: string; col: number; read: Rgb }[] = SHORE_COLUMNS.map(
    ({ col, side }) => ({ side, col, read: bandColor(h, col, ROW_BAYS) }),
  );

  // The same bay, filled, and nothing else on the strait changed.
  h.debug.setBay(BAY, true);
  await h.advance(1);
  // Before the assertions, so a failing verdict leaves the picture that shows
  // one bay filled and the other four open beside it.
  captureStill(h, "scene");
  const filled = sampleColor(h, mouthX, mouthY);

  for (const sample of shore) {
    assertGreaterThanOrEqual(
      colorDistance(open, sample.read),
      BAY_APART_MIN,
      `the mouth of bay ${BAY} (columns ${BAY_PAIRS[BAY][0]} and ` +
        `${BAY_PAIRS[BAY][1]}), ` +
        `open, read against the solid far shore at column ${sample.col} ` +
        `${sample.side} — an open bay reads as an opening in the far shore, ` +
        `distinct from the solid shore beside it (specs/overview.md)`,
    );
  }

  assertGreaterThanOrEqual(
    colorDistance(filled, open),
    FILLED_DIFFERS_MIN,
    `the mouth of bay ${BAY} filled, read against the same point of the same ` +
      `bay open — a filled bay reads as filled (specs/overview.md)`,
  );
});
