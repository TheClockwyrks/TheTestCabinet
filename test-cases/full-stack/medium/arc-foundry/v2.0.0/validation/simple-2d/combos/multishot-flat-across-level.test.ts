// combos/multishot-flat-across-level — a multishot's N does not move with the level.
//
// specs/combinations.md: "Fire rate and every ability parameter are flat across
// level, so a tower scales through its damage alone." The level scaling table
// underneath it moves two figures and no others: damage by
// `COMBO_DAMAGE_MULT[level]` and range by `COMBO_RANGE_BONUS[level]`.
//
// FOUR POINTS READ THAT SENTENCE. A build that scales one ability parameter with
// the level must not cost itself the same single point as one that scales every
// parameter and the cadence too, so the cadence, the reported ability block, the
// slow and burn a struck unit carries, and a multishot's `N` are each decided by
// name. `combos/flat.ts` holds what they share.
//
// WHAT IS DECIDED HERE is a multishot's `N`, which no reading reports: it is read
// off a Fork Array's cadence with five units in range, at each end of the track.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { ENDS, SHOAL_N, SHOAL_TOWER, WAVE, volley } from "./flat";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds a multishot's N across the whole level track", async () => {
  openYard(h, { wave: WAVE });

  for (const level of ENDS) {
    assertEqual(
      await volley(h, level),
      SHOAL_N,
      `${SHOAL_TOWER.name} at level ${level}: multishot(${SHOAL_N})`,
    );
  }
  captureStill(h, "flat");
});
