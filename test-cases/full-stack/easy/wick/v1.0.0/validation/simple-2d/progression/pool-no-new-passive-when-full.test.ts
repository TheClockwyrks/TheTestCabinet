// progression/pool-no-new-passive-when-full — with every passive slot filled,
// no passive that is not held is a candidate.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The candidate pool: the new
// passives come from the pool only "when a passive slot is free", so with none
// free the pool holds no passive that is not held. Slots gives PASSIVE_SLOTS
// (6), and the six held here are all at level 1, below every max PASSIVES
// gives, so they are +1 candidates and the pool is not empty.
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off. Six passives are placed at level 1 through setPassive, filling every
// passive slot; every weapon slot is left free, so the base weapons are
// candidates and the pool is plainly computed. The overlay is opened the real
// way and the pool read off it.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotContains } from "../assert";
import { PASSIVE_IDS, PASSIVE_SLOTS, type PassiveId } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** Six passives at level 1, filling every passive slot; each a +1 candidate. */
const FULL_PASSIVES: readonly PassiveId[] = [
  "wick",
  "oil",
  "glass",
  "brass",
  "mirror",
  "bellows",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds no passive that is not held with all six passive slots filled", async () => {
  isolate(h);
  for (const id of FULL_PASSIVES) holdPassive(h, id, 1);

  const overlay = await openLevelUp(h, 1);
  captureStill(h, "full");

  assertEqual(overlay.screen, "levelup", "the overlay the pool is read from");
  assertEqual(overlay.run.passives.length, PASSIVE_SLOTS, "every slot filled");
  for (const id of PASSIVE_IDS) {
    if (FULL_PASSIVES.includes(id)) continue;
    assertNotContains(
      overlay.run.pool,
      id,
      `${id} left out with the slots full`,
    );
  }
});
