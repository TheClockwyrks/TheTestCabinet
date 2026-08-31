// hopping/refuse-right-edge — a hop off the right edge is refused, and free.
//
// specs/hopping.md (Refused hops): a hop is refused when its target tile "is
// outside the grid: `inBounds(col, row)` is false", and "a refused hop leaves
// everything as it was ... no life is lost". specs/strait.md fixes `inBounds` as
// `0 <= c < 40`, so column `COLS` is off the strait and a hop RIGHT from the
// last column, `COLS - 1`, targets it.
//
// The mirror of hopping/refuse-left-edge, and its own item because a build can
// hold one edge and not the other — an off-by-one that clamps at `0` but tests
// the far side against `COLS` rather than `COLS - 1` fails here alone. As there,
// the edge is a refusal and not a death, so the reading is taken again a
// settling window later on a strait with nothing on it and every world gate
// shut.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, ROW_NEAR, START_LIVES } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  hop,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The rightmost column of the strait: `inBounds` ends here (specs/strait.md). */
const EDGE_COL = COLS - 1;

/** Frames watched after the refused press: half a second of game time. */
const SETTLE_FRAMES = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a hop right from the last column and costs no life", async () => {
  startCrossing(h);
  h.debug.setCritterTile(EDGE_COL, ROW_NEAR);

  const after = await captureReplay(h, "refuse", async () => {
    await hop(h, "right");
    await h.advance(SETTLE_FRAMES);
    return h.snapshot();
  });

  assertEqual(
    after.critter.col,
    EDGE_COL,
    `the column after a hop right from column ${EDGE_COL}`,
  );
  assertEqual(
    after.critter.row,
    ROW_NEAR,
    `the row after a hop right from column ${EDGE_COL}`,
  );
  assertEqual(
    after.lives,
    START_LIVES,
    `lives after a hop right from column ${EDGE_COL}`,
  );
  assertEqual(
    after.phase,
    "crossing",
    `the phase after a hop right from column ${EDGE_COL}`,
  );
  assertTrue(
    after.critter.present,
    "the critter still in play after a refused hop",
  );
});
