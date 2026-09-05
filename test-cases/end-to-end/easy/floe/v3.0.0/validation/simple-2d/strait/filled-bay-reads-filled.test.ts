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
// DIFFER, and nothing more: no colour, no distance and no palette enters into it,
// and how a build marks a filled bay is its own.
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
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleColor,
  startCrossing,
  type Harness,
} from "../harness";
import { BAY_PAIRS, ROW_BAYS, bayMouthX, mapCY } from "./harness";
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

  assertGreaterThan(
    colorDistance(filled, open),
    0,
    `the mouth of bay ${BAY} filled, read against the same point of the same ` +
      `bay open — a filled bay reads as filled (specs/overview.md), so ` +
      `something is drawn there that an open bay does not have`,
  );
});
