// Floe — hopping/faces-right: an accepted hop right leaves the critter facing right.
//
// `specs/hopping.md` gives an accepted hop four consequences, and this decides
// one of them in one direction: it "sets the critter's facing to the direction
// hopped". The facing is what `specs/assets.md` draws the crosser from, so a
// build that never turns the critter, or that turns it the wrong way, leaves a
// player facing the near shore for the whole crossing.
//
// THE FOUR DIRECTIONS ARE FOUR POINTS. A build that turns on some hops and not
// others must grade differently from one that never turns at all, and a single
// point over all four can only fail once. Each of the four poses its own facing
// and takes its own hop.
//
// THE POSED FACING IS NOT THE ONE THE HOP MUST PRODUCE. The critter is posed
// facing `left` first, so a build that simply keeps whatever facing it had cannot
// coast through this reading — the pose is the only way to make it decide
// anything, and it changes nothing else about the critter.
//
// THE HOP IS A REAL PRESS on an emptied ice band (`specs/strait.md`), where every
// tile is plain solid ice and every hop is accepted, so what is read is the
// game's own hop rather than a posed facing. That the hop was taken at all is
// asserted first, so a refusal reads as a refusal rather than as a facing that
// failed to change.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { START_COL } from "../constants";
import {
  captureReplay,
  createHarness,
  hop,
  startCrossing,
  type Facing,
  type Harness,
} from "../harness";

/** A row of the ice band, with a clear row above and below it. */
const ROW = 15;

/** The direction hopped, and the facing it must leave behind. */
const DIRECTION: Facing = "right";

/** The facing the critter is posed with, so the reading is a change. */
const POSED_FACING: Facing = "left";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports right as the critter's facing after a hop right", async () => {
  startCrossing(h);
  h.debug.addCritter(START_COL, ROW);
  h.debug.setCritterFacing(POSED_FACING);

  const posed = h.snapshot();
  assertEqual(
    posed.critter.facing,
    POSED_FACING,
    `the pose faced the critter ${POSED_FACING}, which the hop must change`,
  );

  const after = await captureReplay(h, "facing", async () => {
    await hop(h, DIRECTION);
    const settled = h.snapshot();
    assertEqual(
      `${settled.critter.col},${settled.critter.row}` ===
        `${posed.critter.col},${posed.critter.row}`,
      false,
      `the hop ${DIRECTION} to be taken, on a band of plain solid ice`,
    );
    return settled;
  });

  assertEqual(
    after.critter.facing,
    DIRECTION,
    `the critter facing ${DIRECTION}: an accepted hop sets its facing to the ` +
      `direction hopped (specs/hopping.md)`,
  );
});
