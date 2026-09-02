// progression/pool-held-weapons-below-max — a held base weapon below
// MAX_WEAPON_LEVEL is a candidate for a +1 level offer.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The candidate pool: the pool
// "holds: every held base weapon below MAX_WEAPON_LEVEL, and every held passive
// below its max level, each as a +1 level offer". MAX_WEAPON_LEVEL is 8 by the
// Slots table, so Taper at 3 and Ember at 7 are both below it.
// specs/instrumentation.md, Snapshot shape, reports the field: "pool | on
// levelup, the candidate pool of specs/progression.md computed from the slots
// as they stand".
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off, so no gem, kill, or spawn changes the slots between the pose and the
// read. Taper at 3 and Ember at 7 are placed through setWeapon, which "Puts
// weapon id ... at level in slot" and changes nothing else. The overlay is then
// opened the real way, by queueing a level-up and running the playing tick that
// ends with it queued (specs/progression.md, The level-up overlay), and the
// pool is read off that overlay.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** Taper's level: below MAX_WEAPON_LEVEL, so a +1 candidate. */
const TAPER_LEVEL = 3;

/** Ember's level: one below MAX_WEAPON_LEVEL, still a +1 candidate. */
const EMBER_LEVEL = MAX_WEAPON_LEVEL - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds taper and ember in the pool with them held at 3 and 7", async () => {
  isolate(h);
  holdWeapon(h, "taper", TAPER_LEVEL);
  holdWeapon(h, "ember", EMBER_LEVEL);

  const overlay = await openLevelUp(h, 1);
  captureStill(h, "pool");

  assertEqual(overlay.screen, "levelup", "the overlay the pool is read from");
  assertContains(overlay.run.pool, "taper", "Taper held at 3 in the pool");
  assertContains(overlay.run.pool, "ember", "Ember held at 7 in the pool");
});
