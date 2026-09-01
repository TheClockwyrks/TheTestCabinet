// hunter/speed-scales-with-level — both of a bear's speeds rise 6% a level.
//
// specs/hunter.md:
//
//   bearIceSpeed(L)  = BEAR_ICE_SPEED  * BEAR_SPEED_STEP ^ (L - 1)
//   bearSwimSpeed(L) = BEAR_SWIM_SPEED * BEAR_SPEED_STEP ^ (L - 1)
//
// with `BEAR_SPEED_STEP` (1.06). The two rates are measured the way `ice-speed`
// and `swim-speed` measure them — across the median for ice, across a water row
// emptied of floes for swimming — at three levels rather than one.
//
// LEVELS 1, 4 AND 8 ARE THE DISTINGUISHING SET. `1.06^3` is `1.19` and `1.06^7` is
// `1.50`, so a build that never scales reads 96 at level 8 where 144 is required —
// a third low, sixteen times the allowance — and a build that scales by the wrong
// step reads a number between the two rather than either. Level 1 anchors the
// pair: a build with the right ratio and the wrong base fails there.
//
// The level is set by `startCrossing`, which sets it BEFORE it empties the strait:
// `setLevel` re-lays all sixteen lanes by design, so setting it afterwards would
// put the traffic back onto the row each rate is measured on.

import { afterEach, beforeEach, it } from "vitest";
import {
  ROW_MEDIAN,
  TILE,
  bearIceSpeed,
  bearSwimSpeed,
} from "../../src/constants";
import { assertBetween } from "../assert";
import {
  captureReplay,
  createHarness,
  poseBear,
  speedOverTicks,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { stepAcross } from "./harness";

/** The levels read: the base, one step up the curve, and the far end. */
const LEVELS = [1, 4, 8];

/** A row of the water band, and where each run starts. */
const WATER_ROW = 6;
const FROM_COL = 5;

/** The game time each rate is measured over. */
const MEASURE_SECONDS = 1;

/** The allowance the item states around each figure. */
const SPEED_TOLERANCE = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** One rate, in stage units a second, measured on one row at the posed level. */
async function rateOn(row: number, level: number): Promise<number> {
  startCrossing(h, level);
  const id = poseBear(h, FROM_COL, row, { sense: false, routing: false });
  const ticks = ticksFor(MEASURE_SECONDS);
  return speedOverTicks(await stepAcross(h, id, "right", ticks), ticks);
}

it("scales both of a bear's speeds by BEAR_SPEED_STEP each level", async () => {
  const ice: number[] = [];
  const swim: number[] = [];

  await captureReplay(h, "glide", async () => {
    for (const level of LEVELS) {
      ice.push(await rateOn(ROW_MEDIAN, level));
      swim.push(await rateOn(WATER_ROW, level));
    }
  });

  for (const [index, level] of LEVELS.entries()) {
    const onIce = bearIceSpeed(level) * TILE;
    assertBetween(
      ice[index],
      onIce * (1 - SPEED_TOLERANCE),
      onIce * (1 + SPEED_TOLERANCE),
      `stage units a second on ice at level ${level}`,
    );
    const swimming = bearSwimSpeed(level) * TILE;
    assertBetween(
      swim[index],
      swimming * (1 - SPEED_TOLERANCE),
      swimming * (1 + SPEED_TOLERANCE),
      `stage units a second swimming at level ${level}`,
    );
  }
});
