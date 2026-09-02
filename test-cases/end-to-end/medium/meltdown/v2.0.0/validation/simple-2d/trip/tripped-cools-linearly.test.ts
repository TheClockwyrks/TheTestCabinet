// Meltdown — trip/tripped-cools-linearly: a tripped tower bleeds to zero.
//
// specs/heat.md, The trip: a tripped emitter "bleeds its heat to `0` at
// `TRIP_HEAT / TRIP_TIME`, which is `20` per second, whatever its faces and
// whatever stands beside it." Two things at once: the rate is `20` a second, and
// it is LINEAR — the same `20` at heat `100` and at heat `40` — where every other
// way heat leaves a tower in this game is proportional to `H / 100` and so tails
// off as the tower cools.
//
// TWO TOWERS, BECAUSE "WHATEVER ITS FACES" IS HALF THE RULE. specs/towers.md
// gives the Stutter a 2x2 footprint with radiator faces N and E and mass `0.5`,
// and the Lance a 4x4 with radiator faces N and E and mass `2.8`. Standing alone
// on open floor the Stutter's eight edge-tiles shed `(3.6 * 4 + 1.1 * 4)` a
// second at heat `100`, which its mass turns into `37.6` a second of heat; the
// Lance's sixteen shed `(3.6 * 8 + 1.1 * 8)`, which its mass turns into `13.4`.
// Those are as far either side of `20` as the roster goes, so a build that leaves
// a tripped tower on its ordinary air cooling reads too fast on one of these
// towers and too slow on the other, and a build that bleeds them both at `20`
// has the rule. The two stand at anchors six tiles apart on both axes, so
// neither conducts with the other and neither lengthens a route.
//
// THE RATE IS MEASURED AGAINST THE GAME'S OWN CLOCK. `overWindow` brackets a
// stretch of the build's frames with one snapshot at each end, and `simTime` is
// what the simulation says it advanced by across them, so the reading is heat per
// second of GAME time rather than per frame.
//
// FOUR WINDOWS, BECAUSE ONE WOULD NOT TELL LINEAR FROM PROPORTIONAL. A single
// second from `100` is `20` under the specification and `18.4` under a Stutter's
// air cooling — close enough to argue about. By the fourth second the
// specification is still taking `20` while anything proportional to the heat left
// is taking a third of what it took first. Four windows also stop a second short
// of `TRIP_TIME`, so every reading is taken while the tower is still tripped.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { TRIP_HEAT, TRIP_TIME } from "../constants";
import {
  captureReplay,
  createHarness,
  overWindow,
  poseTrippedTower,
  startRun,
  ticksFor,
  towerOf,
  type Harness,
} from "../harness";
import { freeSite } from "./bench";
import type { TowerType } from "../harness";

/** The two emitters read, chosen for how far apart their air cooling is. */
const TOWERS: readonly TowerType[] = ["stutter", "lance"];

/** specs/heat.md: `TRIP_HEAT / TRIP_TIME`, which is 20 a second. */
const BLEED_RATE = TRIP_HEAT / TRIP_TIME;

/** The windows the bleed is read over, and how long each one is. */
const WINDOWS = 4;
const WINDOW_SECONDS = 1.0;

/**
 * How close each window's rate must come, as decimal places of heat per second.
 *
 * Two places is `0.005` of a heat point a second, a fortieth of one percent of
 * the `20` the specification states, and it is the figure all three engines' copies
 * of this point hold the rate to. The bleed is a per-frame subtraction of
 * `20 * dt` from a figure the case states exactly, so a conformant build has no
 * need of the room. What the bound excludes is every other reading of the rule:
 * a Stutter left on its air cooling sheds `37.6` a second at heat `100` and `7.5`
 * at heat `20`, a Lance `13.4` and `2.7`, and a tower that does not bleed at all
 * reads `0`.
 */
const RATE_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A tripped tower bleeds to zero", async () => {
  startRun(h);
  const ids = TOWERS.map((type, index) => {
    const at = freeSite(index);
    return poseTrippedTower(h, type, at.col, at.row, TRIP_HEAT);
  });

  // heat per second of game time, per tower, one entry per window.
  const rates = await captureReplay(h, "bleed", async () => {
    const measured: number[][] = [];
    for (let n = 0; n < WINDOWS; n += 1) {
      const window = await overWindow(h, ticksFor(WINDOW_SECONDS));
      measured.push(ids.map((id) => -window.heatChange(id) / window.clockGain));
    }
    return measured;
  });

  for (let n = 0; n < WINDOWS; n += 1) {
    TOWERS.forEach((type, index) => {
      assertCloseTo(
        rates[n][index],
        BLEED_RATE,
        RATE_DIGITS,
        `heat a tripped ${type} shed per second of game time over ` +
          `the ${n + 1}th second of its ${TRIP_TIME}s cooldown, from heat ` +
          `${TRIP_HEAT - n * BLEED_RATE}`,
      );
    });
  }

  TOWERS.forEach((type, index) => {
    assertCloseTo(
      towerOf(h.snapshot(), ids[index]).heat,
      TRIP_HEAT - WINDOWS * BLEED_RATE,
      RATE_DIGITS,
      `the heat a tripped ${type} is left at after ${WINDOWS}s`,
    );
  });
});
