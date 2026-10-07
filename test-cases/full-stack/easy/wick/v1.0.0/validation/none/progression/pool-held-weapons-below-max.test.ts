// progression/pool-held-weapons-below-max — the pool offers +1 level on held
// base weapons below max.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The candidate pool"):
// the pool holds "every held base weapon below `MAX_WEAPON_LEVEL` ... each as a
// `+1 level` offer". `MAX_WEAPON_LEVEL` is `8` under "Slots".
// specs/instrumentation.md reports the pool: "on `levelup`, the candidate pool
// of `specs/progression.md` computed from the slots as they stand, each id
// once". So a Taper at `3` and an Ember at `7`, both under `8`, are both in the
// pool the overlay computes.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held
// and nothing alive, and exactly two weapons held: one a few levels up and one
// on the last level before the cap, so a build that only offers a weapon well
// short of the cap fails on the Ember. The overlay is reached by the real path,
// a queued level-up and the tick that opens it (specs/progression.md: "A
// `playing` tick that ends with `pendingLevelUps` above `0` ... opens the
// overlay").
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

/** A held weapon a few levels up. */
const TAPER_LEVEL = 3;

/** A held weapon on the last level before the cap. */
const EMBER_LEVEL = MAX_WEAPON_LEVEL - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds both held base weapons below the cap", async () => {
  await isolate(h);
  await holdWeapon(h, "taper", TAPER_LEVEL);
  await holdWeapon(h, "ember", EMBER_LEVEL);

  const overlay = await openLevelUp(h);
  await captureStill(h, "pool");

  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertContains(overlay.run.pool, "taper", "the pool, for the Taper at 3");
  assertContains(overlay.run.pool, "ember", "the pool, for the Ember at 7");
});
