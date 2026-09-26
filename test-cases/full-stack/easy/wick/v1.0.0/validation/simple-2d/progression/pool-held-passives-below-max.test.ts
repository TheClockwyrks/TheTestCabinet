// progression/pool-held-passives-below-max — a held passive below its own max
// level is a candidate for a +1 level offer.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The candidate pool: the pool
// "holds: every held base weapon below MAX_WEAPON_LEVEL, and every held passive
// below its max level, each as a +1 level offer". Each passive's max is its
// PASSIVES row in specs/passives.md, 3 for Brass and 5 for Lure, so Brass at 2
// and Lure at 4 are each one short of theirs.
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off, so nothing changes the slots between the pose and the read. Brass at 2
// and Lure at 4 are placed through setPassive, which "Puts passive id ... at
// level in slot" and leaves hp untouched. The overlay is opened the real way,
// by queueing a level-up and running the playing tick that ends with it queued,
// and the pool is read off it.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { PASSIVES } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** Brass's level: one below its max of 3, so a +1 candidate. */
const BRASS_LEVEL = PASSIVES.brass.maxLevel - 1;

/** Lure's level: one below its max of 5, still a +1 candidate. */
const LURE_LEVEL = PASSIVES.lure.maxLevel - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds brass and lure in the pool with them held at 2 and 4", async () => {
  isolate(h);
  holdPassive(h, "brass", BRASS_LEVEL);
  holdPassive(h, "lure", LURE_LEVEL);

  const overlay = await openLevelUp(h, 1);
  captureStill(h, "pool");

  assertEqual(overlay.screen, "levelup", "the overlay the pool is read from");
  assertContains(overlay.run.pool, "brass", "Brass held at 2 in the pool");
  assertContains(overlay.run.pool, "lure", "Lure held at 4 in the pool");
});
