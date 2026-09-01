// progression/pool-new-passives-with-free-slot — while a passive slot is free,
// every passive not held is a candidate.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The candidate pool: the pool
// holds, "when a passive slot is free, every passive not held, each as a new
// item". specs/passives.md lists the ten in PASSIVE_IDS, and Slots gives
// PASSIVE_SLOTS (6), so with none held all six are free and all ten are
// candidates.
//
// THE POSE. An isolated night with nothing on the field, no passive held, and
// every driver switch off, so nothing changes the slots between the pose and
// the read. The overlay is opened the real way, by queueing a level-up and
// running the playing tick that ends with it queued, and the pool is read off
// it.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { PASSIVE_IDS } from "../constants";
import {
  captureStill,
  createHarness,
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

it("holds all ten passives in the pool with none held", async () => {
  isolate(h);

  const overlay = await openLevelUp(h, 1);
  captureStill(h, "new");

  assertEqual(overlay.screen, "levelup", "the overlay the pool is read from");
  assertEqual(overlay.run.passives.length, 0, "no passive held");
  for (const id of PASSIVE_IDS) {
    assertContains(overlay.run.pool, id, `${id} offered as a new passive`);
  }
});
