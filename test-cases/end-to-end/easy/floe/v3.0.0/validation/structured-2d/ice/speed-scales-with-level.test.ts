// Floe — ice/speed-scales-with-level: every ice lane runs about six per cent
// faster each level.
//
// specs/ice.md fixes the rule as arithmetic:
//
//     laneSpeed(row, L) = speed(row) * LEVEL_SPEED_STEP ^ (L - 1)
//
// with `LEVEL_SPEED_STEP` at `1.06`, and `setLevel(n)` "lays the strait out for
// it ... the sixteen lanes take level `n`'s speeds and gaps"
// (specs/instrumentation.md). So the reading is each lane's reported speed at
// three levels against that formula.
//
// LEVELS 1, 4 AND 8 ARE THE THREE THAT DISTINGUISH THE WRONG MODELS. Level 1 is
// the base figure, which a build that scaled from the wrong place gets wrong at
// once. Level 4 is `1.06^3` (`1.191`), where a build that scaled per THIRD level
// like the gaps do reads `1.06` and a build that added six per cent of the base
// each level reads `1.18` — both outside the bound below. Level 8 is the end of
// the run and `1.06^7` (`1.504`), where every one of those wrong models has
// drifted furthest from the right one.
//
// NOTHING IS POSED BUT THE LEVEL. A lane's speed is part of what laying a level
// out produces, so the strait is laid out and read; nothing is cleared and no
// speed is set.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertLessThanOrEqual } from "../assert";
import { ICE_LANES, laneSpeed } from "../../src/constants";
import {
  captureStill,
  createHarness,
  laneAt,
  type Harness,
  type LaneSnapshot,
} from "../harness";
import { layOutLevel } from "./harness";

/** The three levels read. */
const LEVELS = [1, 4, 8];

/**
 * How far a reported speed may sit from the formula's figure, as a fraction.
 *
 * The one per cent the item is stated at. The step itself is six per cent, so a
 * build that is one whole level out of step is six times this bound away, and
 * the closest pair of figures in the table — `1.5` and `1.6` on rows 17 and 14 —
 * stay six per cent apart at every level, which is again six times the bound.
 */
const SPEED_TOLERANCE_FRACTION = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("scales every ice lane's speed by 1.06 per level, at levels 1, 4 and 8", async () => {
  const read = new Map<number, (LaneSnapshot | undefined)[]>();
  for (const level of LEVELS) {
    const laid = await layOutLevel(h, level);
    read.set(
      level,
      ICE_LANES.map((lane) => laneAt(laid, lane.row)),
    );
  }
  captureStill(h, "scene");

  for (const level of LEVELS) {
    const lanes = read.get(level) ?? [];
    for (const [index, lane] of ICE_LANES.entries()) {
      const reported = lanes[index];
      assertDefined(
        reported,
        `level ${level}, row ${lane.row}: an ice lane on that row`,
      );
      if (reported === undefined) continue;
      const expected = laneSpeed(lane.row, level);
      assertLessThanOrEqual(
        Math.abs(reported.speed - expected),
        SPEED_TOLERANCE_FRACTION * expected,
        `level ${level}, row ${lane.row}: reported speed away from ` +
          `${expected} tiles a second, was ${reported.speed}`,
      );
    }
  }
});
