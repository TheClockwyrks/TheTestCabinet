// hopping/refuse-far-shore — the solid far shore refuses a hop, and costs
// nothing.
//
// specs/hopping.md (Refused hops): a hop is refused when its target tile "is on
// row `1` at a column no bay covers", and "a refused hop leaves everything as it
// was ... no life is lost". specs/strait.md fixes the bay row as five two-column
// bays — `(3,4)`, `(11,12)`, `(19,20)`, `(27,28)`, `(35,36)` — and "every column
// of row `1` outside those ten is solid far shore".
//
// The critter is posed on the top water row at column `SOLID_COL`, which lies
// between bay `0` and bay `1` and so is covered by no bay at any moment, and
// hops up. That is the only rule under test: the bays are all OPEN
// (`startCrossing` clears them), so a build that refuses on the strength of a
// FILLED bay — the neighbouring item — cannot pass here by accident, and one
// that treats the whole of row `1` as bays lets the critter onto solid shore.
//
// The water row it stands on carries a raft held still, because a bare water
// tile drowns the critter (specs/water.md) and this item is about what the hop
// does, not about what the water does. The reading is taken again a settling
// window later: a refusal costs no life, and a build that lets the critter into
// the shore and then kills it is exactly what that second reading catches.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, WATER_TOP } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  hop,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * A column of the bay row no bay covers: `8` falls between bay `0` (`3`, `4`)
 * and bay `1` (`11`, `12`), so the tile above it is solid far shore
 * (specs/strait.md).
 */
const SOLID_COL = 8;

/** The raft's left edge, so its three tiles cover `7`, `8` and `9`. */
const RAFT_COL = SOLID_COL - 1;

/** Frames watched after the refused press: half a second of game time. */
const SETTLE_FRAMES = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a hop up into the solid far shore and costs no life", async () => {
  startCrossing(h);
  poseLane(h, WATER_TOP, "raft3", [RAFT_COL]);
  h.debug.setCritterTile(SOLID_COL, WATER_TOP);

  const after = await captureReplay(h, "refuse", async () => {
    await hop(h, "up");
    await h.advance(SETTLE_FRAMES);
    return h.snapshot();
  });

  assertEqual(
    after.critter.row,
    WATER_TOP,
    `the row after a hop up at column ${SOLID_COL}`,
  );
  assertEqual(
    after.critter.col,
    SOLID_COL,
    `the column after a hop up at column ${SOLID_COL}`,
  );
  assertEqual(
    after.lives,
    START_LIVES,
    `lives after a hop up at column ${SOLID_COL}`,
  );
  assertEqual(
    after.phase,
    "crossing",
    `the phase after a hop up at column ${SOLID_COL}`,
  );
  assertTrue(
    after.critter.present,
    "the critter still in play after a refused hop",
  );
});
