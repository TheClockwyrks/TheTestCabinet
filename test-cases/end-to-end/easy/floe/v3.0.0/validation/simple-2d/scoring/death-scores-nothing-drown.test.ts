// scoring/death-scores-nothing-drown — a life lost to open water pays nothing.
//
// The first of `specs/progression.md`'s three ways a crossing ends badly, read
// for what `specs/scoring.md` pays for it: nothing. `scoring/death.ts` beside
// this file carries the reasoning the three share, the posed score, and the two
// readings each of them is decided on.
//
// THE WATER BAND IS EMPTIED FIRST, so the tile the critter is put on is open
// water rather than a floe: what is being read is a fall, and a floe under the
// critter would be a crossing that never ended.
//
// WHAT THIS DOES NOT DECIDE. That a drowning costs a life at all is
// `progression/drown-costs-life`; a crush and a catch are the two points beside
// this one. This point is the score, across a fall into open water.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { START_COL } from "../constants";
import { createHarness, startCrossing, type Harness } from "../harness";
import { POSED_SCORE, die, scoredNothing } from "./death";

/** The water row a fall is taken on: mid-band, mid-strait, and empty. */
const WATER_ROW = 5;

/** The one frame a fall needs. */
const ONE_TICK = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the score exactly as it stood through a drowning", async () => {
  startCrossing(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setCritterTile(START_COL, WATER_ROW);

  const before = h.snapshot();
  assertEqual(before.phase, "crossing", "a live crossing before the fall");
  assertEqual(
    before.floes.length,
    0,
    "an empty water band, so the tile below the critter is open water",
  );

  scoredNothing("a fall into open water", await die(h, "score", ONE_TICK));
});
