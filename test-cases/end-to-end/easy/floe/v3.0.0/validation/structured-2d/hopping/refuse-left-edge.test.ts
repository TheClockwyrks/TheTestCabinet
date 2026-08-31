// hopping/refuse-left-edge — a hop off the left edge is refused, and free.
//
// specs/hopping.md (Refused hops): a hop is refused when its target tile "is
// outside the grid: `inBounds(col, row)` is false", and "a refused hop leaves
// everything as it was: the critter stays where it stands with the same facing,
// the cooldown is untouched, no life is lost". specs/strait.md fixes
// `inBounds(c, r)` as `0 <= c < 40` and `0 <= r < 20`, so column `-1` is off the
// strait and a hop LEFT from column `0` targets it.
//
// The strait's edge is a refusal, NOT a death: a build that lets the critter
// walk off the side and then drowns it for being out of the strait loses a life
// where the specification loses nothing, and that is the half of this item that
// costs a point. So the reading is taken after the press and again a settling
// window later, with the strait empty and the four world gates shut: over that
// window nothing but a mishandled edge can take a life or end the crossing.
//
// The critter stands on the near shore, solid across its whole width, so the
// only thing this check turns on is the edge.

import { afterEach, beforeEach, it } from "vitest";
import { ROW_NEAR, START_LIVES } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  hop,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The leftmost column of the strait: `inBounds` starts here (specs/strait.md). */
const EDGE_COL = 0;

/**
 * Frames watched after the refused press, half a second of game time: long
 * enough for a death a build takes a moment to resolve to show in `lives` or in
 * the phase, and short enough that nothing else could have happened on a strait
 * this quiet.
 */
const SETTLE_FRAMES = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a hop left from column 0 and costs no life", async () => {
  startCrossing(h);
  h.debug.setCritterTile(EDGE_COL, ROW_NEAR);

  const after = await captureReplay(h, "refuse", async () => {
    await hop(h, "left");
    await h.advance(SETTLE_FRAMES);
    return h.snapshot();
  });

  assertEqual(
    after.critter.col,
    EDGE_COL,
    "the column after a hop left from column 0",
  );
  assertEqual(
    after.critter.row,
    ROW_NEAR,
    "the row after a hop left from column 0",
  );
  assertEqual(after.lives, START_LIVES, "lives after a hop left from column 0");
  assertEqual(
    after.phase,
    "crossing",
    "the phase after a hop left from column 0",
  );
  assertTrue(
    after.critter.present,
    "the critter still in play after a refused hop",
  );
});
