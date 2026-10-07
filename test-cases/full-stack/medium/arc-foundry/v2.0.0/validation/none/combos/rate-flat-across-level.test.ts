// combos/rate-flat-across-level — every tower's cadence is the same at both ends of the track.
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
// WHAT IS DECIDED HERE is the cadence alone: each of the twelve towers reports the
// `fireRate` its own row of `COMBOS` names at level `0`, and reports exactly that
// same figure at level `COMBO_MAX_LEVEL`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { COMBO_MAX_LEVEL, COMBOS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { blocksAtBothEnds } from "./flat";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds every tower's cadence across the whole level track", async () => {
  const reads = await blocksAtBothEnds(h);
  await captureStill(h, "flat");

  for (const tower of COMBOS) {
    const [low, high] = reads.get(tower.id)!;
    assertCloseTo(
      low!.fireRate,
      tower.fireRate,
      6,
      `${tower.name}: the rate its row names, at level 0`,
    );
    assertCloseTo(
      high!.fireRate,
      low!.fireRate,
      6,
      `${tower.name}: the same rate at level ${COMBO_MAX_LEVEL}`,
    );
  }
});
