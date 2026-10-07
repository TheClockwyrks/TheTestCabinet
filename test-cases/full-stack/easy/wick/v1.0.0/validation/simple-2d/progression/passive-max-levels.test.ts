// progression/passive-max-levels — a passive held at its own max level is not a
// candidate, at each of the ten maxes PASSIVES gives.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The candidate pool: the pool
// holds "every held passive below its max level ... each as a +1 level offer",
// and Slots: "a passive levels up to its own max level, given in
// specs/passives.md". The maxes are the PASSIVES rows of that file: 3 for
// Brass, 2 for Mirror, and 5 for each of the other eight. The new-item rule
// cannot put a maxed passive back, since it offers "every passive not held" and
// the passive under test is held.
//
// THE POSE. Ten isolated nights, one per passive: nothing on the field, every
// driver switch off, and the one passive placed at its max through setPassive,
// whose level runs "1 to the passive's maxLevel in PASSIVES". Nothing else is
// held, so five passive slots and every weapon slot stay free and the pool is
// large; the maxed passive's absence therefore rests on the rule and not on an
// empty pool. Each overlay is opened the real way, by queueing a level-up and
// running the playing tick that ends with it queued.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotContains } from "../assert";
import { PASSIVE_IDS, PASSIVES } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves each of the ten passives out of the pool when it is held at its max", async () => {
  for (const id of PASSIVE_IDS) {
    isolate(h);
    holdPassive(h, id, PASSIVES[id].maxLevel);

    const overlay = await openLevelUp(h, 1);

    assertEqual(overlay.screen, "levelup", `the overlay opened for ${id}`);
    assertGreaterThan(
      overlay.run.pool.length,
      0,
      `the pool the overlay computed for ${id}`,
    );
    assertNotContains(
      overlay.run.pool,
      id,
      `${id} at its max of ${PASSIVES[id].maxLevel} left out of the pool`,
    );
  }
  captureStill(h, "maxed");
});
