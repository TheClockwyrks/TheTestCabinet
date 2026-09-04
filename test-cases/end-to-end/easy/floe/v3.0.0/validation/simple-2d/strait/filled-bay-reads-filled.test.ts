// strait/filled-bay-reads-filled — a filled bay reads as filled, apart from the
// same bay open.
//
// specs/overview.md's legibility table: "a filled bay reads as filled".
// specs/bays.md gives a bay two states — open until a crossing ends in it,
// filled from then until the level is over — and this point is the second of
// them.
//
// THE OTHER HALF OF THAT SENTENCE IS ITS OWN POINT. That an open bay reads as an
// opening in the shore is `strait/bays-read-apart`; the two fail separately, so
// they are graded separately.
//
// THE COMPARISON IS A BAY AGAINST ITSELF. The same point of the same bay is read
// before and after the bay is filled, so the two pictures differ in the bay's
// state and in nothing else at all — same build, same tile, same frame boundary,
// same everything else on the strait. What is read is a distance, never a
// colour: Floe fixes no palette.
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
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleColor,
  startCrossing,
  type Harness,
} from "../harness";
import { BAY_PAIRS, ROW_BAYS, bayMouthX, mapCY } from "./harness";
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

/** The bay the filled half is read on: the middle of the five (specs/strait.md). */
const BAY = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a filled bay apart from the same bay open", async () => {
  // An emptied, live strait with nothing on it at all, and every bay open
  // (specs/bays.md: a level opens with every bay open).
  startCrossing(h);
  h.debug.removeCritter();
  await h.advance(1);

  const mouthX = bayMouthX(BAY_PAIRS[BAY]);
  const mouthY = mapCY(ROW_BAYS);
  const open = sampleColor(h, mouthX, mouthY);

  // The same bay, filled, and nothing else on the strait changed.
  h.debug.setBay(BAY, true);
  await h.advance(1);
  // Before the assertions, so a failing verdict leaves the picture that shows
  // one bay filled and the other four open beside it.
  captureStill(h, "scene");
  const filled = sampleColor(h, mouthX, mouthY);

  assertGreaterThanOrEqual(
    colorDistance(filled, open),
    FILLED_DIFFERS_MIN,
    `the mouth of bay ${BAY} filled, read against the same point of the same ` +
      `bay open — a filled bay reads as filled (specs/overview.md)`,
  );
});
